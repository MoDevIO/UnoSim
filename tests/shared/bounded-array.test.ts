import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { boundedArray } from "../../shared/bounded-array";
import { compileRequestSchema, clientToServerWSMessageSchema } from "../../shared/schema";
import { tutorDialogRequestSchema, tutorQuestionRequestSchema } from "../../shared/tutor";

/**
 * An array schema validates every element of an array that is too long, unless the length is checked
 * first: an oversized array of invalid elements then costs one issue per element (a 1 MiB body gave
 * 500 000 to 700 000 issues and several hundred MiB of heap under Zod 3; GHSA-mrhx-c7xc-m3w5 describes
 * the pattern). `boundedArray` checks the length first and keeps that independent of the Zod release.
 */
const issuesOf = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues;
};
const repeat = (element: unknown, count: number) => Array.from({ length: count }, () => element);

describe("boundedArray", () => {
  const item = z.string().min(1);

  it("answers an oversized array with the issue z.array().max() reports, with the same message and path", () => {
    const plain = z.object({ list: z.array(item).max(3) });
    const bounded = z.object({ list: boundedArray(item, 3) });
    const value = { list: ["a", "b", "c", "d"] };

    expect(issuesOf(bounded, value)).toEqual(issuesOf(plain, value));
    expect(issuesOf(bounded, value)[0]?.message).toBe("Too big: expected array to have <=3 items");
  });

  it("checks no element of an oversized array", () => {
    let checked = 0;
    const counting = z.string().refine(() => { checked++; return false; });

    const issues = issuesOf(z.object({ list: boundedArray(counting, 3) }), { list: repeat("x", 100_000) });

    expect(checked).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "too_big", path: ["list"], maximum: 3, origin: "array" });
  });

  it("reports the invalid elements of an array within the limit as before", () => {
    const plain = z.array(item).max(3);
    const bounded = boundedArray(item, 3);
    const value = ["a", "", 7];

    expect(issuesOf(bounded, value)).toEqual(issuesOf(plain, value));
    expect(issuesOf(bounded, value)).toHaveLength(2);
  });

  it("keeps the minimum, the type check, optional and default as they were", () => {
    for (const [bounded, plain] of [[boundedArray(item, 3, 1), z.array(item).min(1).max(3)], [boundedArray(item, 3), z.array(item).max(3)]] as const) {
      for (const value of [[], "text", null, undefined, { 0: "a" }]) expect(issuesOf(bounded, value)).toEqual(issuesOf(plain, value));
    }
    expect(boundedArray(item, 3).optional().safeParse(undefined).success).toBe(true);
    expect(boundedArray(item, 3).default([]).parse(undefined)).toEqual([]);
    expect(boundedArray(item, 3).parse(["a"])).toEqual(["a"]);
    expect(z.object({ list: boundedArray(item, 3) }).safeParse({}).success).toBe(false);
  });

  it("never lets a refinement see the unchecked elements of an oversized array", () => {
    const seen: unknown[] = [];
    const unique = boundedArray(z.object({ name: z.string() }), 2).refine((list) => { seen.push(list); return true; });

    expect(unique.safeParse([{}, {}, {}]).success).toBe(false);
    expect(seen).toEqual([]);
  });

  it("lets a refinement on the array see the validated elements", () => {
    const unique = boundedArray(item, 3).refine((list) => new Set(list).size === list.length, "unique");

    expect(unique.safeParse(["a", "b"]).success).toBe(true);
    expect(issuesOf(unique, ["a", "a"])[0]?.message).toBe("unique");
  });
});

describe("requests with oversized arrays of invalid elements", () => {
  const MIB = 1024 * 1024;
  const cheap = (schema: z.ZodType, value: unknown) => {
    const started = performance.now();
    const issues = issuesOf(schema, value);
    return { issues, ms: performance.now() - started };
  };

  it("are refused with one issue by the compile request (libraries and headers)", () => {
    const libraries = cheap(compileRequestSchema, { code: "x", libraries: repeat(1, MIB / 2) });
    const headers = cheap(compileRequestSchema, { code: "x", headers: repeat({}, MIB / 3) });

    expect(libraries.issues).toHaveLength(1);
    expect(libraries.issues[0]).toMatchObject({ code: "too_big", path: ["libraries"] });
    expect(headers.issues).toHaveLength(1);
    expect(headers.issues[0]).toMatchObject({ code: "too_big", path: ["headers"] });
    expect(Math.max(libraries.ms, headers.ms)).toBeLessThan(100);
  });

  it("are refused with one issue by the Tutor requests (headers, history, mastered topics)", () => {
    const base = { code: "x", question: "q", answer: "a" };

    const history = cheap(tutorDialogRequestSchema, { ...base, history: repeat({}, MIB / 3) });
    const headers = cheap(tutorDialogRequestSchema, { ...base, history: [], headers: repeat(1, MIB / 2) });
    const question = cheap(tutorQuestionRequestSchema, { code: "x", headers: repeat({}, MIB / 3) });

    for (const { issues } of [history, headers, question]) expect(issues).toHaveLength(1);
    expect(history.issues[0]).toMatchObject({ code: "too_big", path: ["history"] });
    expect(Math.max(history.ms, headers.ms, question.ms)).toBeLessThan(100);
  });

  it("are refused by the WebSocket start message", () => {
    const started = performance.now();
    const parsed = clientToServerWSMessageSchema.safeParse({ type: "start_simulation", code: "x", headers: repeat({}, 80_000) });

    expect(parsed.success).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("array limits in the schemas of the application", () => {
  const root = join(__dirname, "../..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return path.endsWith(".ts") ? [path] : [];
    });

  it("go through boundedArray: no z.array(...).max(...) outside it, so no oversized array is validated element by element", () => {
    const plainLimited = /z\.array\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)(?:\.min\([^)]*\))?\.max\(/;
    const offenders = [...sources(join(root, "shared")), ...sources(join(root, "server"))]
      .filter((file) => !file.endsWith("bounded-array.ts"))
      .filter((file) => plainLimited.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));

    expect(offenders).toEqual([]);
  });
});
