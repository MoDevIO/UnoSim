import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SandboxRunner } from "../../server/services/sandbox-runner";

const skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = skipHeavy ? describe.skip : describe;

maybeDescribe("Timing - delay() accuracy", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (runner.isRunning) {
      runner.stop();
    }
  });

  it("should measure delay(1000) timing in loop()", async () => {
    // Sketch that prints timestamp before and after delay(1000)
    const code = `
      void setup() {
        Serial.begin(115200);
      }
      
      void loop() {
        unsigned long start = millis();
        delay(1000);
        unsigned long end = millis();
        unsigned long elapsed = end - start;
        
        Serial.print("Elapsed: ");
        Serial.print(elapsed);
        Serial.println("ms");
        
        // Exit after 3 measurements
        static int count = 0;
        count++;
        if (count >= 3) {
          delay(5000); // Prevent infinite loop
        }
      }
    `;

    const output: string[] = [];
    const measurements: number[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Timeout waiting for output"));
      }, 20000);

      runner.runSketch(
        code,
        (line) => {
          output.push(line);
          console.log(`Output: ${line}`);
          
          // Parse "Elapsed: 1000ms" pattern
          const match = line.match(/Elapsed:\s*(\d+)ms/);
          if (match) {
            const elapsed = parseInt(match[1], 10);
            measurements.push(elapsed);
            console.log(`Measured delay: ${elapsed}ms`);
            
            // We expect 3 measurements
            if (measurements.length >= 3) {
              clearTimeout(timeout);
              runner.stop();
              resolve();
            }
          }
        },
        (err) => {
          // Ignore pin state messages
          if (err.includes("[[PIN_")) return;
          console.error(`Error: ${err}`);
        }
      );
    });

    console.log("\n=== TIMING TEST RESULTS ===");
    console.log(`Measurements: ${measurements.join(", ")}`);
    
    expect(measurements.length).toBeGreaterThanOrEqual(3);
    
    // Calculate average and variance
    const average = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    console.log(`Average delay: ${average}ms (expected ~1000ms)`);
    
    // Each measurement should be within ±200ms of target
    // This is the tolerance to detect the 1200ms vs 1000ms issue
    measurements.forEach((delay, idx) => {
      console.log(`  Measurement ${idx + 1}: ${delay}ms (${delay >= 1000 ? '+' : ''}${delay - 1000}ms)`);
      
      // Current issue: delay is ~1200ms instead of ~1000ms
      // We expect this test to FAIL with current code, showing ~1200ms
      expect(delay).toBeLessThanOrEqual(1100);  // Should be <= 1100ms ideally
    });
    
    // The average should be close to 1000ms (within 100ms tolerance)
    expect(average).toBeLessThan(1100);
  }, 30000);

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

    const output: string[] = [];
    const measurements: number[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Timeout waiting for measurements"));
      }, 20000);

      runner.runSketch(
        code,
        (line) => {
          output.push(line);
          console.log(`Output: ${line}`);
          
          // Parse "Delay N: 500ms" pattern
          const match = line.match(/Delay\s+\d+:\s*(\d+)ms/);
          if (match) {
            const elapsed = parseInt(match[1], 10);
            measurements.push(elapsed);
            console.log(`Measured delay: ${elapsed}ms`);
            
            // After 3 consecutive delays, we're done
            if (measurements.length >= 3) {
              clearTimeout(timeout);
              runner.stop();
              resolve();
            }
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
          console.error(`Error: ${err}`);
        }
      );
    });

    console.log("\n=== CONSECUTIVE DELAYS TEST ===");
    console.log(`Measurements: ${measurements.join(", ")}`);
    
    expect(measurements.length).toBeGreaterThanOrEqual(3);
    
    const average = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    console.log(`Average delay: ${average}ms (expected ~500ms)`);
    
    // Each delay(500) should be within ±100ms tolerance
    measurements.forEach((delay, idx) => {
      console.log(`  Delay ${idx + 1}: ${delay}ms (${delay >= 500 ? '+' : ''}${delay - 500}ms)`);
      expect(delay).toBeLessThanOrEqual(600); // Should be <= 600ms
      expect(delay).toBeGreaterThanOrEqual(400); // Should be >= 400ms
    });
  }, 30000);
});
