// sandbox-stress.test.ts
// Phase 5 Stress Tests: Validate architectural robustness under extreme conditions

import { SandboxRunner } from "../server/services/sandbox-runner";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import type { IOPinRecord } from "@shared/schema";

// Helper type for callback options
interface RunSketchCallbacks {
  onOutput?: (line: string, isComplete?: boolean) => void;
  onError?: (line: string) => void;
  onExit?: (code: number | null) => void;
  onCompileError?: (error: string) => void;
  onCompileSuccess?: () => void;
  onPinState?: (pin: number, type: "mode" | "value" | "pwm", value: number) => void;
  onIORegistry?: (registry: IOPinRecord[], baudrate: number) => void;
}

// Helper to call runSketch with object-style callbacks
function runSketchHelper(
  runner: SandboxRunner,
  code: string,
  callbacks: RunSketchCallbacks,
  timeoutSec?: number
) {
  return runner.runSketch(
    code,
    callbacks.onOutput || (() => {}),
    callbacks.onError || (() => {}),
    callbacks.onExit || (() => {}),
    callbacks.onCompileError,
    callbacks.onCompileSuccess,
    callbacks.onPinState,
    timeoutSec,
    callbacks.onIORegistry
  );
}

describe("SandboxRunner Stress Tests - Phase 5", () => {
  let tempDir: string;
  let activeRunners: SandboxRunner[] = [];

  beforeAll(async () => {
    tempDir = join(process.cwd(), "temp");
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Stop all active runners
    for (const runner of activeRunners) {
      try {
        await runner.stop();
      } catch (err) {
        // Ignore stop errors during cleanup
      }
    }
    activeRunners = [];
    
    // Aggressive cleanup after each test
    try {
      const entries = readdirSync(tempDir);
      for (const entry of entries) {
        const fullPath = join(tempDir, entry);
        await rm(fullPath, { recursive: true, force: true });
      }
    } catch (error) {
      // Cleanup failures are not critical for stress tests
    }
  });

  describe("Test 1: Data Flood - Output Size Limit", () => {
    it("should abort when maxOutputBytes (100MB) is exceeded", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      // Sketch that floods output with Serial.println in infinite loop
      const floodSketch = `
void setup() {
  Serial.begin(9600);
}

void loop() {
  // Generate ~500 bytes per iteration (reduced from 1KB to prevent heap overflow)
  Serial.println("FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA_FLOOD_DATA");
  
  // Also flood digitalWrite to stress RegistryManager
  digitalWrite(13, HIGH);
  digitalWrite(13, LOW);
}
      `.trim();

      let outputBytesSeen = 0;
      let errorTriggered = false;
      let processExited = false;

      const result = await new Promise<{ 
        aborted: boolean; 
        memoryLeak: boolean;
        outputSize: number;
      }>((resolve) => {
        runSketchHelper(
          runner,
          floodSketch,
          {
            onOutput: (line) => {
              outputBytesSeen += Buffer.byteLength(line, "utf8");
            },
            onError: (error) => {
              if (error.includes("Output size limit exceeded")) {
                errorTriggered = true;
              }
            },
            onExit: () => {
              processExited = true;
              
              // Check for memory leaks in RegistryManager
              // The registry should not grow unbounded despite thousands of digitalWrite calls
              const memoryLeak = process.memoryUsage().heapUsed > 200 * 1024 * 1024; // 200MB threshold
              
              resolve({
                aborted: errorTriggered && processExited,
                memoryLeak,
                outputSize: outputBytesSeen,
              });
            },
          },
          3000 // 3 second timeout (should abort sooner via size limit)
        );
      });

      // Assertions
      expect(result.aborted).toBe(true); // Should abort due to maxOutputBytes
      expect(result.memoryLeak).toBe(false); // No memory leak in registry
      expect(result.outputSize).toBeGreaterThan(10 * 1024 * 1024); // At least 10MB collected
      expect(result.outputSize).toBeLessThanOrEqual(100 * 1024 * 1024); // But not exceed limit

      // Cleanup
      await runner.stop();
    }, 30000); // 30s test timeout

    it("should maintain RegistryManager debouncing during data flood", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      // Sketch that rapidly toggles pins without delay
      const rapidToggleSketch = `
void setup() {
  pinMode(13, OUTPUT);
  pinMode(12, OUTPUT);
}

void loop() {
  // Toggle 2 pins 1000 times per loop iteration
  for (int i = 0; i < 1000; i++) {
    digitalWrite(13, i % 2);
    digitalWrite(12, (i + 1) % 2);
  }
}
      `.trim();

      let pinStateUpdateCount = 0;
      let registrySent = false;

      await new Promise<void>((resolve) => {
        runSketchHelper(
          runner,
          rapidToggleSketch,
          {
            onIORegistry: () => {
              registrySent = true;
            },
            onPinState: () => {
              pinStateUpdateCount++;
            },
            onExit: () => {
              resolve();
            },
          },
          2000 // 2 second run
        );
      });

      // The debouncer (200ms) should drastically reduce updates
      // With 2000ms runtime, we expect ~10 debounced updates (200ms each)
      // NOT thousands from raw digitalWrite calls
      expect(registrySent).toBe(true);
      expect(pinStateUpdateCount).toBeLessThan(50); // Should be ~10, but allow 50 for variance
      expect(pinStateUpdateCount).toBeGreaterThan(3); // At least some updates happened

      await runner.stop();
    }, 30000);
  });

  describe("Test 2: Rapid State Jitter - Pause/Resume Stress", () => {
    it("should maintain state consistency with 20 rapid pause/resume cycles", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      // Sketch with visible output to track execution
      const timerSketch = `
void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.println("TICK");
  delay(100);
}
      `.trim();

      let tickCount = 0;
      let stateErrors: string[] = [];

      await new Promise<void>((resolve) => {
        runSketchHelper(
          runner,
          timerSketch,
          {
            onOutput: (line) => {
              if (line.includes("TICK")) {
                tickCount++;
              }
            },
            onError: (error) => {
              stateErrors.push(error);
            },
            onExit: () => {
              resolve();
            },
          },
          10000 // 10 second total runtime
        );
      });

      // Wait for sketch to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Perform 20 rapid pause/resume cycles
      const pauseResults: boolean[] = [];
      const resumeResults: boolean[] = [];

      for (let i = 0; i < 20; i++) {
        // Random delay between 10ms and 100ms
        const pauseDelay = 10 + Math.random() * 90;
        await new Promise((resolve) => setTimeout(resolve, pauseDelay));

        const pauseSuccess = await runner.pause();
        pauseResults.push(pauseSuccess);

        const resumeDelay = 10 + Math.random() * 90;
        await new Promise((resolve) => setTimeout(resolve, resumeDelay));

        const resumeSuccess = await runner.resume();
        resumeResults.push(resumeSuccess);
      }

      // Stop and wait for exit
      await runner.stop();

      // Assertions
      const successfulPauses = pauseResults.filter(Boolean).length;
      const successfulResumes = resumeResults.filter(Boolean).length;

      expect(successfulPauses).toBeGreaterThan(15); // Most pauses should succeed
      expect(successfulResumes).toBeGreaterThan(15); // Most resumes should succeed
      expect(stateErrors.length).toBe(0); // No state transition errors
      expect(tickCount).toBeGreaterThan(10); // Some execution happened
    }, 30000);

    it("should correctly calculate remaining time with pause jitter", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      const basicSketch = `
void setup() {
  Serial.begin(9600);
  Serial.println("START");
}

void loop() {
  delay(100);
}
      `.trim();

      let processStartTime = 0;
      let totalPausedTime = 0;
      let pauseTimestamps: number[] = [];
      let resumeTimestamps: number[] = [];

      await new Promise<void>((resolve) => {
        runSketchHelper(
          runner,
          basicSketch,
          {
            onOutput: (line) => {
              if (line.includes("START")) {
                processStartTime = Date.now();
              }
            },
            onExit: () => {
              resolve();
            },
          },
          5000 // 5 second timeout
        );
      });

      // Wait for start
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 5 pause/resume cycles with timing tracking
      for (let i = 0; i < 5; i++) {
        const pauseStart = Date.now();
        await runner.pause();
        pauseTimestamps.push(pauseStart);

        await new Promise((resolve) => setTimeout(resolve, 200)); // Pause for 200ms

        const resumeStart = Date.now();
        await runner.resume();
        resumeTimestamps.push(resumeStart);

        totalPausedTime += resumeStart - pauseStart;
      }

      // Wait a bit then stop
      await new Promise((resolve) => setTimeout(resolve, 500));
      await runner.stop();

      // Verify: Pause durations should sum to ~1000ms (5 x 200ms)
      expect(totalPausedTime).toBeGreaterThan(900); // Allow 10% margin
      expect(totalPausedTime).toBeLessThan(1500); // But not excessive drift

      // Verify: All pause/resume timestamps are ordered
      for (let i = 0; i < pauseTimestamps.length; i++) {
        expect(resumeTimestamps[i]).toBeGreaterThan(pauseTimestamps[i]);
        if (i > 0) {
          expect(pauseTimestamps[i]).toBeGreaterThan(resumeTimestamps[i - 1]);
        }
      }
    }, 30000);
  });

  describe("Test 3: Concurrency & Cleanup - Multi-Instance Stress", () => {
    it("should handle 5 concurrent simulations with isolated temp directories", async () => {
      const runners = [
        new SandboxRunner(),
        new SandboxRunner(),
        new SandboxRunner(),
        new SandboxRunner(),
        new SandboxRunner(),
      ];
      activeRunners.push(...runners);

      // Each sketch has unique output to distinguish them
      const createSketch = (id: number) => `
void setup() {
  Serial.begin(9600);
  Serial.println("RUNNER_${id}");
}

void loop() {
  Serial.print("ID_${id}_TICK_");
  Serial.println(millis());
  delay(100);
}
      `.trim();

      // Track outputs per runner
      const outputs: Map<number, string[]> = new Map();
      runners.forEach((_, i) => outputs.set(i, []));

      // Start all 5 simulations concurrently
      const promises = runners.map((runner, index) =>
        new Promise<void>((resolve) => {
          runSketchHelper(
            runner,
            createSketch(index),
            {
              onOutput: (line) => {
                outputs.get(index)?.push(line);
              },
              onExit: () => {
                resolve();
              },
            },
            3000 // 3 second runtime
          );
        })
      );

      // Wait for all to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check temp directory isolation
      const tempEntries = readdirSync(tempDir);
      const sketchDirs = tempEntries.filter((e) => {
        const fullPath = join(tempDir, e);
        return existsSync(join(fullPath, "sketch.ino"));
      });

      // Should have 5 separate sketch directories
      expect(sketchDirs.length).toBeGreaterThanOrEqual(5);

      // Stop all concurrently
      await Promise.all(runners.map((r) => r.stop()));

      // Wait for all exit callbacks
      await Promise.all(promises);

      // Verify outputs are isolated (no crosstalk)
      for (let i = 0; i < 5; i++) {
        const lines = outputs.get(i) || [];
        const hasOwnId = lines.some((l) => l.includes(`RUNNER_${i}`));
        const hasOtherIds = lines.some((l) => {
          for (let j = 0; j < 5; j++) {
            if (j !== i && l.includes(`RUNNER_${j}`)) {
              return true;
            }
          }
          return false;
        });

        expect(hasOwnId).toBe(true); // Should see own ID
        expect(hasOtherIds).toBe(false); // Should NOT see other IDs
      }

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check cleanup: .cleanup directories should exist, or all cleaned
      const afterCleanup = readdirSync(tempDir);
      const remainingSketchDirs = afterCleanup.filter((e) => {
        const fullPath = join(tempDir, e);
        return !e.endsWith(".cleanup") && existsSync(join(fullPath, "sketch.ino"));
      });

      expect(remainingSketchDirs.length).toBe(0); // All sketch dirs should be cleaned/renamed
    }, 60000); // 60s timeout for concurrency test

    it("should cleanup temp directory after rapid start/stop cycles", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      const simpleSketch = `
void setup() {
  Serial.begin(9600);
}

void loop() {
  delay(100);
}
      `.trim();

      // Perform 10 rapid start/stop cycles
      for (let i = 0; i < 10; i++) {
        const exitPromise = new Promise<void>((resolve) => {
          runSketchHelper(
            runner,
            simpleSketch,
            {
              onExit: () => {
                resolve();
              },
            },
            5000
          );
        });

        // Wait briefly then stop
        await new Promise((resolve) => setTimeout(resolve, 200));
        await runner.stop();
        await exitPromise;
      }

      // Wait for cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Count remaining directories
      const entries = readdirSync(tempDir);
      const nonCleanupDirs = entries.filter((e) => !e.endsWith(".cleanup"));

      // Should have minimal residual directories (ideally 0)
      expect(nonCleanupDirs.length).toBeLessThan(3); // Allow max 2 stragglers
    }, 60000);

    it("should prevent resource leaks with memory usage check", async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      const runners = Array.from({ length: 10 }, () => new SandboxRunner());
      activeRunners.push(...runners);

      const sketch = `
void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 1000; i++) {
    Serial.println(i);
  }
}

void loop() {
  delay(1000);
}
      `.trim();

      // Run all 10 simulations sequentially
      for (const runner of runners) {
        await new Promise<void>((resolve) => {
          runSketchHelper(
            runner,
            sketch,
            {
              onExit: () => {
                resolve();
              },
            },
            1000
          );
        });
        await runner.stop();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory should not grow excessively (allow 50MB growth max)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    }, 90000);
  });

  describe("Edge Cases: State Machine Validation", () => {
    it("should reject invalid state transitions", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      // Try to pause when STOPPED (invalid)
      const pauseResult = await runner.pause();
      expect(pauseResult).toBe(false);

      // Try to resume when STOPPED (invalid)
      const resumeResult = await runner.resume();
      expect(resumeResult).toBe(false);

      // Start a sketch
      const sketch = `void setup() {} void loop() { delay(100); }`;
      await new Promise<void>((resolve) => {
        runSketchHelper(
          runner,
          sketch,
          {
            onExit: () => {
              resolve();
            },
          },
          5000
        );
      });

      // Wait for RUNNING state
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Valid pause
      const validPause = await runner.pause();
      expect(validPause).toBe(true);

      // Try to pause again (invalid when PAUSED)
      const doublePause = await runner.pause();
      expect(doublePause).toBe(false);

      // Valid resume
      const validResume = await runner.resume();
      expect(validResume).toBe(true);

      // Stop
      await runner.stop();
    }, 30000);

    it("should handle stop() during STARTING phase", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      const sketch = `void setup() {} void loop() { delay(100); }`;

      // Start sketch
      runSketchHelper(
        runner,
        sketch,
        {
          onExit: () => {},
        },
        5000
      );

      // Immediately stop (might still be in STARTING)
      await runner.stop();

      // Should transition cleanly to STOPPED
      // Verify by trying another run
      let exitCalled = false;
      await new Promise<void>((resolve) => {
        runSketchHelper(
          runner,
          sketch,
          {
            onExit: () => {
              exitCalled = true;
              resolve();
            },
          },
          1000
        );
      });

      await runner.stop();
      expect(exitCalled).toBe(true);
    }, 30000);
  });
});
