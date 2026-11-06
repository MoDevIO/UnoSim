import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { clockSamples, expectSteadyClock } from "../utils/clock-samples";
import { outputRecorder } from "../utils/serial-test-helper";
import { sleep, waitFor, within } from "../utils/wait";

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

const PAUSE_WINDOW_MS = 600;
/** Largest clock step between two readings that a 20 ms loop may show on a loaded machine. */
const MAX_CLOCK_STEP_MS = 300;

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
    // The clock goes on from the frozen value: the paused time is not added, and nothing drops back.
    await waitFor(() => times().length >= atPause.length + 5, 15_000, "five TIME lines after the resume");
    const frozen = times().at(atPause.length - 1)!;
    const afterResume = times().slice(atPause.length, atPause.length + 5);
    expect(afterResume[0]).toBeGreaterThanOrEqual(frozen);
    expect(afterResume[0] - frozen).toBeLessThan(PAUSE_WINDOW_MS / 2);
    for (let i = 1; i < afterResume.length; i++) expect(afterResume[i]).toBeGreaterThanOrEqual(afterResume[i - 1]);
  });

  it("keeps millis() and micros() continuous across repeated and rapid pauses", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() {
          Serial.begin(115200);
          Serial.print("BITS:");
          Serial.println(sizeof(unsigned long) * 8);
        }
        void loop() {
          unsigned long us = micros();
          unsigned long ms = millis();
          Serial.print("T:");
          Serial.print(ms);
          Serial.print(":");
          Serial.println(us);
          delay(20);
        }
      `,
      onOutput: output.onOutput,
      onError: () => {},
      timeoutSec: 30,
    });
    const samples = () => clockSamples(output.lines());
    const bitsLine = await waitFor(() => output.lines().find((line) => line.startsWith("BITS:")), 30_000, "the BITS line");
    const bits = Number(bitsLine.slice("BITS:".length));
    const moreSamples = (count: number, label: string) => {
      const target = samples().length + count;
      return waitFor(() => samples().length >= target, 15_000, () => `${count} clock samples ${label} (got ${samples().length})`);
    };
    const confirmed = async (control: () => boolean, label: string) => {
      expect(control()).toBe(true);
      expect(await within(runner.controlResult, 10_000, label)).toBe(true);
    };
    await moreSamples(5, "before the first pause");

    for (let pause = 1; pause <= 3; pause++) {
      await confirmed(() => runner.pause(), `pause ${pause}`);
      await sleep(PAUSE_WINDOW_MS);
      await confirmed(() => runner.resume(), `resume ${pause}`);
      await moreSamples(5, `after resume ${pause}`);
    }
    for (let pause = 1; pause <= 3; pause++) {
      await confirmed(() => runner.pause(), `rapid pause ${pause}`);
      await confirmed(() => runner.resume(), `rapid resume ${pause}`);
      await moreSamples(3, `after rapid resume ${pause}`);
    }

    // Each pause lasted at least PAUSE_WINDOW_MS, so a step of that size means the paused time leaked into the clock.
    const largestStep = expectSteadyClock(samples(), bits, MAX_CLOCK_STEP_MS);
    expect(largestStep).toBeLessThan(PAUSE_WINDOW_MS);
  });

  it("lets delay() and delayMicroseconds() wait their full simulated time when a pause interrupts them", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() { Serial.begin(115200); }
        void loop() {
          unsigned long t0 = millis();
          delay(500);
          Serial.print("D:");
          Serial.println(millis() - t0);
          unsigned long u0 = micros();
          for (int i = 0; i < 50; i++) delayMicroseconds(10000);
          Serial.print("U:");
          Serial.println(micros() - u0);
        }
      `,
      onOutput: output.onOutput,
      onError: () => {},
      timeoutSec: 30,
    });
    const waits = (kind: "D" | "U") => output.lines().flatMap((line) => line.startsWith(`${kind}:`) ? [Number(line.slice(2))] : []);
    const nextLine = (kind: "D" | "U") => {
      const target = waits(kind).length + 1;
      return waitFor(() => waits(kind).length >= target, 15_000, `the next ${kind} line`);
    };
    const pauseFor = async (ms: number) => {
      expect(runner.pause()).toBe(true);
      expect(await within(runner.controlResult, 10_000, "the confirmed pause")).toBe(true);
      await sleep(ms);
      expect(runner.resume()).toBe(true);
      expect(await within(runner.controlResult, 10_000, "the confirmed resume")).toBe(true);
    };

    // A D line starts the delayMicroseconds() loop, a U line starts delay(): each pause lands in one of them.
    await nextLine("D");
    await pauseFor(PAUSE_WINDOW_MS);
    await nextLine("U");
    await pauseFor(PAUSE_WINDOW_MS);
    await nextLine("D");
    await pauseFor(0);
    await nextLine("U");
    await pauseFor(0);
    await nextLine("D");
    await nextLine("U");

    // Before the fix both slept in wall-clock time, so the paused time counted as waiting: a wait cut by a
    // 600 ms pause ended almost at once after the resume (e.g. "delay: 169" for delay(1000)).
    for (const ms of waits("D")) expect(ms).toBeGreaterThanOrEqual(500);
    for (const us of waits("U")) expect(us).toBeGreaterThanOrEqual(500_000);
    // Nor does a pause make them wait longer than the requested time plus the loop's own overhead.
    for (const ms of waits("D")) expect(ms).toBeLessThan(500 + PAUSE_WINDOW_MS / 2);
    for (const us of waits("U")) expect(us).toBeLessThan((500 + PAUSE_WINDOW_MS / 2) * 1_000);
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
