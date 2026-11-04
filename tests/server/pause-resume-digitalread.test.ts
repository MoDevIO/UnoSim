import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { outputRecorder } from "../utils/serial-test-helper";
import { waitFor, within } from "../utils/wait";

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

const onError = (err: string) => {
  if (err.includes("[[PIN_") || err.includes("[[STDIN_RECV")) return;
  console.error("Stderr:", err);
};

maybeDescribe("Pause/Resume - digitalRead after Resume", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await runner.stop();
    expect(runner.hasPendingContainerCleanup).toBe(false);
  });

  it("should read pin value correctly BEFORE pause", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() {
          Serial.begin(9600);
          pinMode(2, INPUT);
          Serial.println("START");
        }
        void loop() {
          Serial.print("PIN2=");
          Serial.println(digitalRead(2));
          delay(100);
        }
      `,
      onOutput: output.onOutput,
      onError,
      onExit: () => {},
      timeoutSec: 10,
    });

    // The first output shows the process is up and reads its input.
    await waitFor(() => output.lines().includes("START"), 60_000, "the START line");
    runner.setPinValue(2, 1);
    await waitFor(() => output.lines().includes("PIN2=1"), 15_000, () => `a PIN2=1 line (got: ${output.text()})`);
    expect(output.lines()).toContain("PIN2=1");
  }, 75_000);

  it("should handle multiple pin changes after resume", async () => {
    const output = outputRecorder();
    await runner.runSketch({
      code: `
        void setup() {
          Serial.begin(9600);
          pinMode(2, INPUT);
          pinMode(3, INPUT);
          Serial.println("READY");
        }
        void loop() {
          Serial.print("P2=");
          Serial.print(digitalRead(2));
          Serial.print(" P3=");
          Serial.println(digitalRead(3));
          delay(150);
        }
      `,
      onOutput: output.onOutput,
      onError,
      onExit: () => {},
      timeoutSec: 30,
    });
    await waitFor(() => output.lines().includes("P2=0 P3=0"), 30_000, "a first complete reading P2=0 P3=0");

    expect(runner.pause()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed pause")).toBe(true);
    expect(runner.resume()).toBe(true);
    expect(await within(runner.controlResult, 10_000, "the confirmed resume")).toBe(true);

    // Each change set after the resume must show up in a fresh, complete reading of both pins.
    const afterResume = output.lines().length;
    const freshReading = (reading: string) =>
      waitFor(() => output.lines().slice(afterResume).includes(reading), 10_000, () => `a fresh reading "${reading}" after the resume (got: ${output.lines().slice(afterResume).join(" | ")})`);
    runner.setPinValue(2, 1);
    await freshReading("P2=1 P3=0");
    runner.setPinValue(3, 1);
    await freshReading("P2=1 P3=1");
    expect(output.lines().slice(afterResume)).toContain("P2=1 P3=1");
  }, 60_000);
});
