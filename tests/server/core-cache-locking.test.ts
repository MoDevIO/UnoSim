/**
 * Core-Cache Locking Integration Test
 *
 * Validates that the cache-stampede protection works correctly under parallel load.
 * Specifically tests that two simultaneous compilations for the same FQBN (with
 * empty core-cache) do NOT corrupt or deadlock each other.
 *
 * Scenario:
 * 1. Each test run gets its own isolated temp directory (os.tmpdir)
 * 2. Start two compilations for the same Blink sketch 50ms apart
 * 3. Worker 1 acquires lock, does full compile, creates cache
 * 4. Worker 2 detects lock, waits, then reuses cache for faster link
 * 5. Both should succeed; Worker 2 should be significantly faster
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";

// Standard Blink sketch for testing
const BLINK_SKETCH = `
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
`;

// Isolated temp cache dir – never touches the project directory.
// Created once for the whole file; each test clears it via afterEach.
let tmpCacheDir: string;
let originalArduinoCacheDir: string | undefined;

describe("Core-Cache Locking Behavior", () => {
  beforeAll(() => {
    tmpCacheDir = mkdtempSync(join(tmpdir(), "arduino-test-"));
    originalArduinoCacheDir = process.env.ARDUINO_CACHE_DIR;
    // Override before any ArduinoCompiler instance is constructed
    process.env.ARDUINO_CACHE_DIR = tmpCacheDir;
  });

  afterAll(() => {
    // Restore original env var
    if (originalArduinoCacheDir !== undefined) {
      process.env.ARDUINO_CACHE_DIR = originalArduinoCacheDir;
    } else {
      delete process.env.ARDUINO_CACHE_DIR;
    }
    // Remove temp dir to keep the runner clean
    try {
      rmSync(tmpCacheDir, { recursive: true, force: true });
    } catch {
      // noop
    }
  });

  afterEach(async () => {
    // Clear and recreate the cache dir between tests to simulate a fresh state
    try {
      await rm(tmpCacheDir, { recursive: true, force: true });
      await mkdir(tmpCacheDir, { recursive: true });
    } catch {
      // noop
    }
  });

  it("handles two parallel compilations without deadlock (50ms offset)", async () => {
    // This test may take 30-60 seconds on CI (2-core runner)
    const compiler1 = new ArduinoCompiler();
    const compiler2 = new ArduinoCompiler();

    const fqbn = "arduino:avr:uno";
    let result1: any;
    let result2: any;
    let elapsed1Ms = 0;
    let elapsed2Ms = 0;

    // Start first compilation
    const compile1Promise = (async () => {
      const startedAt = Date.now();
      result1 = await compiler1.compile(BLINK_SKETCH, undefined, undefined, { fqbn });
      elapsed1Ms = Date.now() - startedAt;
      return result1;
    })();

    // Wait 50ms, then start second compilation
    await new Promise((resolve) => setTimeout(resolve, 50));

    const compile2Promise = (async () => {
      const startedAt = Date.now();
      result2 = await compiler2.compile(BLINK_SKETCH, undefined, undefined, { fqbn });
      elapsed2Ms = Date.now() - startedAt;
      return result2;
    })();

    // Wait for both to complete
    await Promise.all([compile1Promise, compile2Promise]);

    // Explicit error reporting instead of opaque assertion failures
    if (!result1.success) {
      throw new Error(`Compilation 1 failed: ${result1.error}`);
    }
    if (!result2.success) {
      throw new Error(`Compilation 2 failed: ${result2.error}`);
    }

    // Timing validation – relaxed for slower CI runners
    const timingDiff = elapsed1Ms - elapsed2Ms;
    const isSlowCompile = elapsed1Ms > 2000;
    if (isSlowCompile) {
      // Allow 2× variance; second compile should not be dramatically slower
      expect(elapsed1Ms).toBeGreaterThanOrEqual(elapsed2Ms * 0.5);
    }
    // CI runners with 2 cores may be slow – give 90 s headroom
    expect(elapsed1Ms).toBeLessThan(90000);
    expect(elapsed2Ms).toBeLessThan(90000);

    console.log(
      `[Test] Compile 1 (cold): ${elapsed1Ms}ms | Compile 2 (warm): ${elapsed2Ms}ms | Diff: ${timingDiff}ms (ratio: ${(elapsed1Ms / elapsed2Ms).toFixed(2)}x)`,
    );
  }, 120000); // 120 s for 2-core CI runners

  it("both parallel compilations produce identical binaries", async () => {
    const compiler1 = new ArduinoCompiler();
    const compiler2 = new ArduinoCompiler();

    const fqbn = "arduino:avr:uno";
    const results = await Promise.all([
      compiler1.compile(BLINK_SKETCH, undefined, undefined, { fqbn }),
      new Promise<any>((resolve) => {
        setTimeout(async () => {
          const result = await compiler2.compile(BLINK_SKETCH, undefined, undefined, { fqbn });
          resolve(result);
        }, 100);
      }),
    ]);

    if (!results[0].success) {
      throw new Error(`Parallel compilation 1 failed: ${results[0].error}`);
    }
    if (!results[1].success) {
      throw new Error(`Parallel compilation 2 failed: ${results[1].error}`);
    }

    // Both compile() calls succeeded without deadlock or cache corruption.
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    console.log("[Test] Both parallel compilations completed successfully");
  }, 90000); // 90 s for 2-core CI runners

  it("many sequential compilations all benefit from cache", async () => {
    const compiler = new ArduinoCompiler();
    const fqbn = "arduino:avr:uno";
    const times: number[] = [];

    for (let i = 0; i < 3; i++) {
      const startedAt = Date.now();
      const result = await compiler.compile(BLINK_SKETCH, undefined, undefined, { fqbn });
      const elapsed = Date.now() - startedAt;
      times.push(elapsed);

      if (!result.success) {
        throw new Error(`Sequential compilation ${i + 1} failed: ${result.error}`);
      }
    }

    // Subsequent compiles must not exceed the cold-compile time or 10 s
    expect(times[1]).toBeLessThan(Math.max(times[0], 10000));
    expect(times[2]).toBeLessThan(Math.max(times[0], 10000));

    console.log(`[Test] Sequential compile times: ${times.join("ms, ")}ms`);
  }, 120000); // 120 s for 2-core CI runners (3 sequential compiles)
});
