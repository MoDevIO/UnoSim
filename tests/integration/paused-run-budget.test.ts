/**
 * Integration Test: pause budget of a real, frozen Docker sandbox
 *
 * `docker pause` freezes every process of the container, including the
 * `timeout --signal=KILL` hard lifetime, so a paused sandbox would otherwise
 * live (and hold its runner and admission) as long as its WebSocket does. The
 * backend's pause budget must end the run and remove the frozen container.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";

const run = promisify(execFile);
const skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = skipHeavy ? describe.skip : describe;
const PAUSE_BUDGET_MS = 3_000;

const SKETCH = String.raw`
void setup() { Serial.begin(115200); }
void loop() { Serial.println("tick"); delay(100); }
`.trim();

async function containerStatus(name: string): Promise<string> {
  const { stdout } = await run("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Status}}"]);
  return stdout.trim();
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

maybeDescribe("paused run budget (real Docker)", () => {
  let runner: SandboxRunner | undefined;

  afterEach(async () => {
    await runner?.stop();
  });

  test("ends a paused run after its pause budget and removes the frozen container", async () => {
    runner = new SandboxRunner({ maxPausedMs: PAUSE_BUDGET_MS });
    const outputs: string[] = [];
    let exitCode: number | null | undefined;
    const ready = await runner.runSketch({
      code: SKETCH,
      onOutput: (line) => outputs.push(line),
      onError: () => {},
      onExit: (code) => { exitCode = code; },
      onCompileError: (error) => { throw new Error(`compile failed: ${error}`); },
      timeoutSec: 60,
    });
    expect(ready).toBe(true);
    const containerName = (runner as unknown as { executionState: { currentContainerName: string } })
      .executionState.currentContainerName;
    await waitFor(() => outputs.join("").includes("tick"), 15_000, "serial output");

    expect(runner.pause()).toBe(true);
    expect(await runner.controlResult).toBe(true);
    expect(await containerStatus(containerName)).toContain("Paused");
    const pausedAt = Date.now();

    await waitFor(() => exitCode !== undefined, PAUSE_BUDGET_MS + 15_000, "end of the paused run");
    expect(Date.now() - pausedAt).toBeGreaterThanOrEqual(PAUSE_BUDGET_MS - 100);
    expect(outputs.join("")).toContain("paused longer than");
    // The caller's onExit releases the run; this mirrors what the WebSocket session does.
    await runner.stop();
    await waitFor(async () => (await containerStatus(containerName)) === "", 15_000, "container removal");
  }, 90_000);
});
