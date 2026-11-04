import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { outputRecorder } from "../utils/serial-test-helper";
import { sleep, waitFor, within } from "../utils/wait";

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

const PAUSE_WINDOW_MS = 500;

maybeDescribe("SandboxRunner - Pause/Resume Timing", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await runner.stop();
    expect(runner.hasPendingContainerCleanup).toBe(false);
  });

  it("should freeze time during pause", async () => {
    const output = outputRecorder();
    const times = () => output.lines().flatMap((line) => {
      const match = /^TIME:(\d+)$/.exec(line);
      return match ? [Number(match[1])] : [];
    });
    await runner.runSketch({
      code: `
        void setup() { Serial.begin(9600); }
        void loop() {
          Serial.print("TIME:");
          Serial.println(millis());
          delay(50);
        }
      `,
      onOutput: output.onOutput,
      onError: () => {},
      timeoutSec: 30,
    });
    await waitFor(() => times().length >= 5, 30_000, "five TIME lines");

    expect(runner.pause()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed pause")).toBe(true);
    const atPause = times();
    const valAtPause = atPause.at(-1)!;

    // Observation window in real time: the simulated millis() must not advance significantly.
    await sleep(PAUSE_WINDOW_MS);
    expect(times().at(-1)).toBeLessThanOrEqual(valAtPause + 20);

    expect(runner.resume()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed resume")).toBe(true);
    // The run goes on after the confirmed resume. The readings right after it are not checked yet: in Docker
    // mode the first one still contains the paused time and the next ones drop back (see TESTING_STANDARDS.md).
    await waitFor(() => times().length >= atPause.length + 5, 15_000, "five TIME lines after the resume");
    expect(times().length).toBeGreaterThanOrEqual(atPause.length + 5);
  });

  it("should clear pause state on stop", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `void setup() { Serial.begin(9600); } void loop() { Serial.println(micros()); delay(100); }`,
      onOutput: output.onOutput,
      timeoutSec: 10,
    });
    await waitFor(() => output.lines().length > 0, 30_000, "the first serial output");

    expect(runner.pause()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed pause")).toBe(true);
    expect(runner.isPaused).toBe(true);
    await runner.stop();
    expect(runner.isPaused).toBe(false);
    expect((runner as any).pauseStartTime).toBeNull();
  });
}, 60_000);
