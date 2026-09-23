import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

async function startWorkerPoolProbe(): Promise<{ code: number | null; output: string }> {
  const directory = await mkdtemp(join(tmpdir(), "unosim-worker-probe-"));
  const scriptPath = join(directory, "probe.mjs");
  const poolPath = resolve(process.cwd(), "server/services/compilation-worker-pool.ts");
  await writeFile(scriptPath, [
    `import { getCompilationPool } from ${JSON.stringify(poolPath)};`,
    "const pool = getCompilationPool();",
    "await new Promise((resolve) => setTimeout(resolve, 1200));",
    'console.log(JSON.stringify({ operational: pool.isOperational(), workers: pool.getStats().activeWorkers }));',
    "await pool.shutdown();",
  ].join("\n"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        "--import",
        "tsx/esm",
        scriptPath,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          UNOSIM_SERVER_MODE: "docker",
          UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
          WORKER_COUNT: "1",
          LOG_LEVEL: "error",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("CompilationWorkerPool startup", () => {
  it("initializes a worker under the direct tsx ESM runtime", async () => {
    const result = await startWorkerPoolProbe();
    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain("[ERROR][CompilationWorkerPool]");
    const output = result.output.trim().split("\n").map((line) => {
      try { return JSON.parse(line) as { operational?: boolean }; } catch { return null; }
    }).find((line) => line && "operational" in line);
    expect(output, result.output).toMatchObject({ operational: true });
  }, 10_000);
});
