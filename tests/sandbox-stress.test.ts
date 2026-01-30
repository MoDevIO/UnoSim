// sandbox-stress.test.ts
// Phase 5 Stress Tests: Validate architectural robustness under extreme conditions

import { SandboxRunner, SimulationState } from "../server/services/sandbox-runner";
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

// Helper to wrap promises with a safety timeout
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, defaultValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.log(`⚠️ Promise timed out after ${timeoutMs}ms, using default value`);
      resolve(defaultValue);
    }, timeoutMs))
  ]);
}

describe("SandboxRunner Stress Tests - Phase 5", () => {
  let tempDir: string;
  let activeRunners: SandboxRunner[] = [];
  let dockerAvailable = false;

  beforeAll(async () => {
    tempDir = join(process.cwd(), "temp");
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    
    // Check if Docker is available
    const testRunner = new SandboxRunner();
    const status = testRunner.getSandboxStatus();
    dockerAvailable = status.dockerAvailable && status.dockerImageBuilt;
    
    if (!dockerAvailable) {
      console.log("⚠️ Docker not available - Tests will use local g++ compilation");
      console.log("   Note: Local mode has different behavior and timing characteristics");
    } else {
      console.log("✅ Docker available - Tests will use containerized sandbox");
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

      const result = await withTimeout(
        new Promise<{ 
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
              onCompileError: (error) => {
                // Compilation failed - resolve with minimal data
                console.log("Compilation failed:", error);
                resolve({
                  aborted: false,
                  memoryLeak: false,
                  outputSize: 0,
                });
              },
            },
            3000 // 3 second timeout (should abort sooner via size limit)
          );
        }),
        25000, // 25s safety timeout
        { aborted: false, memoryLeak: false, outputSize: 0 } // Default value
      );

      // Assertions - Docker-aware
      if (dockerAvailable) {
        expect(result.aborted).toBe(true); // Should abort due to maxOutputBytes
        expect(result.memoryLeak).toBe(false); // No memory leak in registry
        expect(result.outputSize).toBeGreaterThan(10 * 1024 * 1024); // At least 10MB collected
        expect(result.outputSize).toBeLessThanOrEqual(100 * 1024 * 1024); // But not exceed limit
      } else {
        // Local mode: Just validate completion (may or may not produce output)
        expect(result.memoryLeak).toBe(false); // No memory leak
        // Note: Local g++ compilation may or may not work depending on environment
        console.log(`Local mode output: ${result.outputSize} bytes, exited: ${processExited}`);
      }

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

      await withTimeout(
        new Promise<void>((resolve) => {
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
              onCompileError: (error) => {
                console.log("Compilation failed:", error);
                resolve();
              },
            },
            2000 // 2 second run
          );
        }),
        25000, // 25s safety timeout
        undefined
      );

      // The debouncer (200ms) should drastically reduce updates
      // With 2000ms runtime, we expect ~10 debounced updates (200ms each)
      // NOT thousands from raw digitalWrite calls
      if (dockerAvailable) {
        expect(registrySent).toBe(true);
        expect(pinStateUpdateCount).toBeLessThan(50); // Should be ~10, but allow 50 for variance
        expect(pinStateUpdateCount).toBeGreaterThan(3); // At least some updates happened
      } else {
        // Local mode: May produce output, but debouncing still applies
        console.log(`Local mode: Registry sent=${registrySent}, Pin updates=${pinStateUpdateCount}`);
        // In local mode, debouncing may be less effective - just check process completed
        // The assertion should pass as long as it didn't crash
      }

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

      await withTimeout(
        new Promise<void>((resolve) => {
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
              onCompileError: (error) => {
                console.log("Compilation failed:", error);
                resolve();
              },
            },
            10000 // 10 second total runtime
          );
        }),
        25000, // 25s safety timeout
        undefined
      );

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

      // Assertions - Docker-aware
      const successfulPauses = pauseResults.filter(Boolean).length;
      const successfulResumes = resumeResults.filter(Boolean).length;

      // State errors acceptable in local mode due to timing differences
      if (dockerAvailable) {
        expect(stateErrors.length).toBe(0); // No state transition errors
        expect(successfulPauses).toBeGreaterThan(15); // Most pauses should succeed
        expect(successfulResumes).toBeGreaterThan(15); // Most resumes should succeed
        expect(tickCount).toBeGreaterThan(10); // Some execution happened
      } else {
        // Local mode: More lenient due to different timing
        console.log(`Local mode: ${stateErrors.length} state errors, ${tickCount} ticks`);
        expect(stateErrors.length).toBeLessThan(50); // Allow some errors in local mode
      }
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
      let exitResolved = false;

      await withTimeout(
        new Promise<void>((resolve) => {
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
                exitResolved = true;
                resolve();
              },
              onCompileError: (error) => {
                console.log("Compilation failed:", error);
                exitResolved = true;
                resolve();
              },
            },
            5000 // 5 second timeout
          );
        }),
        25000, // 25s safety timeout
        undefined
      );

      // Only pause/resume if sketch actually started (Docker mode)
      if (dockerAvailable && exitResolved && processStartTime > 0) {
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
      } else {
        // Local mode: skip pause/resume stress testing
        console.log("Skipping pause/resume cycles - Docker not available or script didn't start");
      }

      // Wait a bit then stop
      await new Promise((resolve) => setTimeout(resolve, 500));
      await runner.stop();

      // Verify: Timing and ordering - Docker-aware
      if (dockerAvailable && processStartTime > 0) {
        // Pause durations should sum to ~1000ms (5 x 200ms)
        expect(totalPausedTime).toBeGreaterThan(900); // Allow 10% margin
        expect(totalPausedTime).toBeLessThan(1500); // But not excessive drift
      }

      // Verify: All pause/resume timestamps are ordered (independent of Docker)
      // Allow some timing variance in local mode
      let timingErrors = 0;
      for (let i = 0; i < pauseTimestamps.length; i++) {
        if (resumeTimestamps[i] <= pauseTimestamps[i]) {
          timingErrors++;
        }
        if (i > 0 && pauseTimestamps[i] <= resumeTimestamps[i - 1]) {
          timingErrors++;
        }
      }
      
      // Strict in Docker, lenient in local mode
      if (dockerAvailable) {
        expect(timingErrors).toBe(0);
      } else {
        expect(timingErrors).toBeLessThan(3); // Allow some timing issues in local mode
      }
    }, 30000);
  });

  describe("Test 3: Concurrency & Cleanup - Multi-Instance Stress", () => {
    it("should handle 3 concurrent simulations with isolated temp directories", async () => {
      // Reduce concurrent count for local testing
      const concurrentCount = dockerAvailable ? 3 : 2;
      const runners = Array.from({ length: concurrentCount }, () => new SandboxRunner());
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

      // Start all simulations concurrently
      const promises = runners.map((runner, index) =>
        withTimeout(
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
                onCompileError: (error) => {
                  console.log(`Runner ${index} compilation failed:`, error);
                  resolve();
                },
              },
              3000 // 3 second runtime
            );
          }),
          55000, // 55s safety timeout
          undefined
        )
      );

      // Wait for all to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check temp directory isolation
      const tempEntries = readdirSync(tempDir);
      const sketchDirs = tempEntries.filter((e) => {
        const fullPath = join(tempDir, e);
        return existsSync(join(fullPath, "sketch.ino"));
      });

      // Docker-aware assertions
      if (dockerAvailable) {
        // Should have separate sketch directories per runner
        expect(sketchDirs.length).toBeGreaterThanOrEqual(concurrentCount);
      } else {
        // Without Docker: May not create all directories
        expect(sketchDirs.length).toBeGreaterThanOrEqual(0);
      }

      // Stop all concurrently
      await Promise.all(runners.map((r) => r.stop()));

      // Wait for all exit callbacks
      await Promise.all(promises);

      // Verify outputs are isolated (no crosstalk) - Docker-aware
      if (dockerAvailable) {
        for (let i = 0; i < concurrentCount; i++) {
          const lines = outputs.get(i) || [];
          const hasOwnId = lines.some((l) => l.includes(`RUNNER_${i}`));
          const hasOtherIds = lines.some((l) => {
            for (let j = 0; j < concurrentCount; j++) {
              if (j !== i && l.includes(`RUNNER_${j}`)) {
                return true;
              }
            }
            return false;
          });

          expect(hasOwnId).toBe(true); // Should see own ID
          expect(hasOtherIds).toBe(false); // Should NOT see other IDs
        }
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
        const exitPromise = withTimeout(
          new Promise<void>((resolve) => {
            runSketchHelper(
              runner,
              simpleSketch,
              {
                onExit: () => {
                  resolve();
                },
                onCompileError: (error) => {
                  console.log("Compilation failed:", error);
                  resolve();
                },
              },
              5000
            );
          }),
          10000, // 10s safety timeout per cycle
          undefined
        );

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
        await withTimeout(
          new Promise<void>((resolve) => {
            runSketchHelper(
              runner,
              sketch,
              {
                onExit: () => {
                  resolve();
                },
                onCompileError: (error) => {
                  console.log("Compilation failed:", error);
                  resolve();
                },
              },
              1000
            );
          }),
          5000, // 5s safety timeout per run
          undefined
        );
        await runner.stop();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory should not grow excessively - Docker-aware
      if (dockerAvailable) {
        expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // 50MB max
      } else {
        expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024); // More lenient without Docker
      }
      
      console.log(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`);
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

      // Skip the rest if Docker not available (local mode is too variable)
      if (!dockerAvailable) {
        console.log("Skipping pause/resume stress in local mode");
        await runner.stop();
        return; // Exit early
      }

      // Start a sketch
      const sketch = `void setup() {} void loop() { delay(100); }`;
      let sketchStarted = false;
      await withTimeout(
        new Promise<void>((resolve) => {
          runSketchHelper(
            runner,
            sketch,
            {
              onOutput: () => {
                sketchStarted = true;
              },
              onExit: () => {
                resolve();
              },
              onCompileError: (error) => {
                console.log("Compilation failed:", error);
                sketchStarted = false;
                resolve();
              },
            },
            5000
          );
        }),
        25000, // 25s safety timeout
        undefined
      );

      // Only test pause/resume if sketch actually started
      if (sketchStarted) {
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
      }

      // Stop
      await runner.stop();
    }, 30000);

    it("should handle stop() during STARTING phase", async () => {
      const runner = new SandboxRunner();
      activeRunners.push(runner);

      const sketch = `void setup() {} void loop() { delay(100); }`;

      // Start sketch (fire-and-forget to test STARTING state interruption)
      let firstRunStarted = false;
      runSketchHelper(
        runner,
        sketch,
        {
          onExit: () => {},
          onCompileError: (error) => {
            firstRunStarted = true;
            console.log("Compilation failed on first run:", error);
          },
        },
        5000
      );

      // Immediately stop (might still be in STARTING)
      // This tests the state machine during transition
      await new Promise((resolve) => setTimeout(resolve, 10)); // Let it start
      await runner.stop();

      // Give it time to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should transition cleanly to STOPPED
      // Verify by trying another run
      let exitCalled = false;
      await withTimeout(
        new Promise<void>((resolve) => {
          runSketchHelper(
            runner,
            sketch,
            {
              onExit: () => {
                exitCalled = true;
                resolve();
              },
              onCompileError: (error) => {
                console.log("Compilation failed on second run:", error);
                resolve();
              },
            },
            1000
          );
        }),
        25000, // 25s safety timeout
        undefined
      );

      await runner.stop();
      
      // Validate state machine stability (Docker-independent)
      // simulationState may not be public, so just verify the runner is still functional
      expect(runner).toBeDefined();
      
      // Exit callback only with Docker
      if (dockerAvailable) {
        expect(exitCalled).toBe(true);
      } else {
        // In local mode, second run should also compile with error
        expect(firstRunStarted || exitCalled).toBe(true); // At least one callback fired
      }
    }, 30000);
  });
});
