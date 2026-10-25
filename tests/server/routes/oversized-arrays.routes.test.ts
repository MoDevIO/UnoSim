import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INPUT_LIMITS } from "../../../shared/input-limits";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";

/**
 * A request body of up to 1 MiB made of invalid array elements is refused with the usual answer, without
 * a service call. (The cost of the refusal, one issue instead of one per element, is in tests/shared/bounded-array.test.ts.)
 */
let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function start() {
  const compile = vi.fn().mockResolvedValue({ success: true, output: "ok", errors: [], arduinoCliStatus: "success" });
  const tutor = { generateQuestion: vi.fn(), generateDialogResponse: vi.fn() };
  const app = express();
  app.use(express.json({ limit: INPUT_LIMITS.rest.maxBodyBytes }));
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
    next();
  });
  registerCompilerRoutes(app, {
    compiler: { compile },
    compilationCache: new Map() as never,
    hashCode: (code: string) => `hash:${code}`,
    CACHE_TTL: 60_000,
    setLastCompiledCode: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    disableRateLimit: true,
  });
  registerTutorRoutes(app, { service: tutor as never, disableRateLimit: true, logger: { warn: vi.fn(), error: vi.fn() } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: string) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { post, compile, tutor };
}

const jsonWithArray = (fields: string, key: string, element: string) => {
  const count = Math.floor((INPUT_LIMITS.rest.maxBodyBytes - 200) / (element.length + 1));
  return `{${fields}"${key}":[${Array(count).fill(element).join(",")}]}`;
};

describe("oversized arrays of invalid elements in requests", () => {
  it("are refused by POST /api/compile as before", async () => {
    const { post, compile } = await start();

    const libraries = await post("/api/compile", jsonWithArray('"code":"x",', "libraries", "1"));
    const headers = await post("/api/compile", jsonWithArray('"code":"x",', "headers", "{}"));

    expect(libraries).toEqual({ status: 400, body: { error: "Invalid compile request" } });
    expect(headers).toEqual({ status: 400, body: { error: "Invalid compile request" } });
    expect(compile).not.toHaveBeenCalled();
  });

  it("are refused by the Tutor routes as before", async () => {
    const { post, tutor } = await start();
    const dialog = '"code":"x","credential":"secret","question":"q","answer":"a",';

    const history = await post("/api/tutor/dialog", jsonWithArray(dialog, "history", "{}"));
    const headers = await post("/api/tutor/question", jsonWithArray('"code":"x","credential":"secret",', "headers", "1"));

    expect(history.status).toBe(400);
    expect(history.body).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(headers.status).toBe(400);
    expect(tutor.generateDialogResponse).not.toHaveBeenCalled();
    expect(tutor.generateQuestion).not.toHaveBeenCalled();
  });
});
