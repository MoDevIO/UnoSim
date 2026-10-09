/**
 * Integration Test: runtime text output storm (real Docker sandbox)
 *
 * A sketch that writes plain text to stderr in a tight loop must not make the
 * backend forward or log every line: the client receives a bounded number of
 * diagnostics and the log stays aggregated, independent of the line count.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { Logger } from "../../shared/logger";

const skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = skipHeavy ? describe.skip : describe;

const FLOOD_SECONDS = 2;
const FLOOD_SKETCH = String.raw`
#include <cstdio>
#include <cstdlib>

void setup() {}

void loop() {
  static unsigned long start = millis();
  if (millis() - start > ${FLOOD_SECONDS * 1000}) {
    fputs("FLOOD_END\n", stderr);
    exit(0);
  }
  for (int i = 0; i < 2000; i++) fputs("flood\n", stderr);
}
`.trim();

maybeDescribe("runtime output storm", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await runner.stop();
  });

  test("forwards and logs a bounded number of lines while a sketch floods stderr", async () => {
    const logCalls: string[] = [];
    for (const level of ["warn", "info", "error"] as const) {
      const original = Logger.prototype[level];
      vi.spyOn(Logger.prototype, level).mockImplementation(function (this: Logger, message: string) {
        logCalls.push(message);
        return original.call(this, message);
      });
    }
    const errors: string[] = [];
    const exited = new Promise<void>((resolve) => {
      void runner.runSketch({
        code: FLOOD_SKETCH,
        onOutput: () => {},
        onError: (line) => errors.push(line),
        onExit: () => resolve(),
        onCompileError: (error) => {
          errors.push(`COMPILE: ${error}`);
          resolve();
        },
        timeoutSec: 30,
      });
    });
    await exited;

    expect(errors.some((line) => line.startsWith("COMPILE:"))).toBe(false);
    const floodLines = errors.filter((line) => line === "flood").length;
    // Without a budget every one of the >100 000 lines reached the client.
    expect(floodLines).toBeGreaterThan(0);
    expect(floodLines).toBeLessThan(1_000);
    expect(errors.filter((line) => line.includes("Runtime output rate limit"))).toHaveLength(1);
    // Without aggregation every line produced its own diagnostic log entry.
    expect(logCalls.filter((message) => message.includes("STDERR")).length).toBe(0);
    expect(logCalls.length).toBeLessThan(200);
  }, 90_000);
});
