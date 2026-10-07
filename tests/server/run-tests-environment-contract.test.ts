import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// run-tests.sh must clear every runtime variable that server/config.ts rejects as removed. A variable
// exported in the caller's terminal otherwise fails the pipeline at the first Unit Tests step.

const repository = process.cwd();

function removedRuntimeVariables(): string[] {
  const source = readFileSync(path.join(repository, "server", "config.ts"), "utf8");
  const block = /const removedRuntimeVariables = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1] as string);
}

function unsetStatement(): string {
  const script = readFileSync(path.join(repository, "run-tests.sh"), "utf8");
  const start = script.indexOf("\nunset ");
  expect(start).toBeGreaterThan(-1);
  const lines = script.slice(start + 1).split("\n");
  const statement: string[] = [];
  for (const line of lines) {
    statement.push(line);
    if (!line.trimEnd().endsWith("\\")) break;
  }
  return statement.join("\n");
}

describe("run-tests.sh environment hygiene", () => {
  it("reads the removed runtime variables from server/config.ts", () => {
    expect(removedRuntimeVariables().length).toBeGreaterThanOrEqual(7);
  });

  it("clears every removed runtime variable before the pipeline starts", () => {
    const variables = removedRuntimeVariables();
    const result = spawnSync("bash", ["-c", `${unsetStatement()}\nenv`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...Object.fromEntries(variables.map((name) => [name, "1"])) },
    });

    expect(result.status).toBe(0);
    const remaining = variables.filter((name) => new RegExp(`^${name}=`, "m").test(result.stdout));
    expect(remaining).toEqual([]);
  });
});
