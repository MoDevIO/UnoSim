import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { outputRecorder } from "../utils/serial-test-helper";
import { waitFor } from "../utils/wait";

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

maybeDescribe("Timing - delay() accuracy", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await runner.stop();
    expect(runner.hasPendingContainerCleanup).toBe(false);
  });

  it("should measure multiple consecutive delays accurately", async () => {
    const code = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        for (int i = 0; i < 3; i++) {
          unsigned long start = millis();
          delay(500);
          unsigned long elapsed = millis() - start;
          
          Serial.print("Delay ");
          Serial.print(i + 1);
          Serial.print(": ");
          Serial.print(elapsed);
          Serial.println("ms");
        }
        
        // Longer delay to prevent too many iterations
        delay(10000);
      }
    `;

    const output = outputRecorder();
    const delays = () => output.lines().flatMap((line) => {
      const match = /^Delay\s+\d+:\s*(\d+)ms$/.exec(line);
      return match ? [Number.parseInt(match[1], 10)] : [];
    });
    await runner.runSketch({
      code,
      onOutput: output.onOutput,
      onError: (err) => {
        if (err.includes("[[PIN_")) return;
        console.error(`Error: ${err}`);
      },
    });
    await waitFor(() => delays().length >= 3, 20_000, () => `three delay measurements (got: ${output.text()})`);
    const measurements = delays();

    console.log("\n=== CONSECUTIVE DELAYS TEST ===");
    console.log(`Measurements: ${measurements.join(", ")}`);
    
    expect(measurements.length).toBeGreaterThanOrEqual(3);
    
    const average = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    console.log(`Average delay: ${average}ms (expected ~500ms)`);
    
    // Each delay(500) should be within a reasonable jitter window (±150ms).
    measurements.forEach((delay, idx) => {
      console.log(`  Delay ${idx + 1}: ${delay}ms (${delay >= 500 ? '+' : ''}${delay - 500}ms)`);
      expect(delay).toBeGreaterThanOrEqual(350);
      expect(delay).toBeLessThanOrEqual(650);
    });
  }, 30000);
});
