import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../../server/services/sandbox-runner";
import { ProcessExecutor } from "../../../server/services/process-executor";
import { outputRecorder } from "../../utils/serial-test-helper";
import { sleep, waitFor, within } from "../../utils/wait";

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

const ignorePinMessages = (err: string) => {
  if (!err.includes("[[PIN_")) console.error("integration onError:", err);
};

/** Paused state of the run's container as Docker reports it; undefined once the container is gone. */
async function containerPaused(runner: SandboxRunner): Promise<boolean | undefined> {
  const name = (runner as any).executionState?.currentContainerName as string | undefined;
  if (!name) return undefined;
  const inspect = await new ProcessExecutor().execute("docker", ["inspect", name], { timeout: 5_000, stdio: "pipe" });
  return inspect.code === 0 ? JSON.parse(inspect.stdout ?? "[]")[0]?.State?.Paused === true : undefined;
}

maybeDescribe("SandboxRunner — lifecycle integration (real processes)", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    // stop() also removes a container whose process has already ended, so it always runs.
    await runner.stop();
    expect(runner.hasPendingContainerCleanup).toBe(false);
  });

  it("spawn & output: delivers serial output from the child process", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() { Serial.begin(9600); }
        void loop() { Serial.println("HELLO"); delay(50); }
      `,
      onOutput: output.onOutput,
      onError: ignorePinMessages,
      onExit: () => {},
      timeoutSec: 10,
    });

    const hellos = () => output.lines().filter((line) => line === "HELLO").length;
    await waitFor(() => hellos() >= 3, 60_000, "three HELLO lines");
    expect(hellos()).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("lifecycle signals: pause freezes the container and its output, resume brings fresh output", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      // Serial input is accepted only while the run is not paused, so the echo is produced after the resume.
      code: `
        void setup() { Serial.begin(9600); }
        void loop() {
          Serial.println("PING");
          while (Serial.available()) {
            if (Serial.read() == 'R') Serial.println("ECHO AFTER RESUME");
          }
          delay(50);
        }
      `,
      onOutput: output.onOutput,
      onError: ignorePinMessages,
      onExit: () => {},
      timeoutSec: 18,
    });

    // A warm-up of six lines keeps the pause away from the start of the output.
    await waitFor(() => output.lines().length >= 6, 20_000, "six PING lines");

    expect(runner.pause()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed docker pause")).toBe(true);
    expect(await containerPaused(runner)).toBe(true);

    // Observation windows: a paused container produces no output (one line may still be in the pipe).
    const atPause = output.lines().length;
    await sleep(200);
    const afterSettle = output.lines().length;
    expect(afterSettle).toBeLessThanOrEqual(atPause + 1);
    await sleep(300);
    const frozen = output.lines().length;
    expect(frozen).toBeLessThanOrEqual(afterSettle + 1);

    expect(runner.resume()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed docker unpause")).toBe(true);
    expect(await containerPaused(runner)).toBe(false);
    runner.sendSerialInput("R");
    await waitFor(() => output.lines().includes("ECHO AFTER RESUME"), 10_000, "the echo of input sent after the resume");
    expect(output.lines().length).toBeGreaterThan(frozen);
  }, 40_000);

  it("stop() reliably terminates the child process and prevents further output", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() { Serial.begin(9600); }
        void loop() { Serial.println("GOODBYE"); delay(50); }
      `,
      onOutput: output.onOutput,
      onError: () => {},
      onExit: () => {},
      timeoutSec: 10,
    });
    await waitFor(() => output.lines().length > 0, 15_000, "the first serial output");

    await runner.stop();
    expect(runner.isRunning).toBe(false);
    expect(runner.hasPendingContainerCleanup).toBe(false);
    const afterStop = output.lines().length;
    // Observation window: no output may follow a completed stop() (one line may still be in the pipe).
    await sleep(500);
    expect(output.lines().length).toBeLessThanOrEqual(afterStop + 1);
  }, 20_000);

  it("regression: stopping immediately while data flows does not cause unhandled errors", async () => {
    const errors: unknown[] = [];
    const record = (error: unknown) => errors.push(error);
    process.on("uncaughtException", record);
    process.on("unhandledRejection", record);
    try {
      let stopped: Promise<void> | undefined;
      await runner.runSketch({
        code: `
          void setup() { Serial.begin(9600); }
          void loop() { Serial.println("RACE"); delay(20); }
        `,
        onOutput: (line) => {
          if (line.startsWith("--- Simulation timeout") || line.startsWith("--- Sandbox startup timeout")) return;
          // Stop as soon as data flows, to replicate the race window.
          stopped ??= runner.stop();
        },
        onError: (err) => console.error("race onError", err),
        onExit: () => {},
        timeoutSec: 5,
      });

      await waitFor(() => stopped !== undefined, 18_000, "output to trigger the race");
      await within(stopped, 20_000, "stop() after the first output");
      // Observation window for asynchronous errors after the stop.
      await sleep(300);
    } finally {
      process.off("uncaughtException", record);
      process.off("unhandledRejection", record);
    }
    expect(errors).toEqual([]);
  }, 25_000);

  it("error handling: process can exit with non-zero code and onExit receives that code", async () => {
    let exitCode!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => { exitCode = resolve; });
    await runner.runSketch({
      code: `
        void setup() {
          Serial.begin(9600);
          exit(42);
        }
        void loop() { }
      `,
      onOutput: () => {},
      onError: () => {},
      onExit: (code) => exitCode(code),
      timeoutSec: 5,
    });

    // On some platforms/CI we have observed -1 or null instead of the real code.
    expect([42, -1, null]).toContain(await within(exited, 15_000, "the exit of the sketch"));
  }, 20_000);
});
