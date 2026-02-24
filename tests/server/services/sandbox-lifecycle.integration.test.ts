import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../../server/services/sandbox-runner";

// Skip only when SKIP_HEAVY_TESTS is explicitly set to a truthy value (default: run heavy/integration tests)
const skipHeavy = process.env.SKIP_HEAVY_TESTS === "1" || process.env.SKIP_HEAVY_TESTS === "true";
const maybeDescribe = describe;

maybeDescribe("SandboxRunner — lifecycle integration (real processes)", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    // Ensure runner is stopped and cleaned up between tests
    try {
      if (runner && runner.isRunning) await runner.stop();
    } catch (err) {
      // swallow cleanup errors to not mask test results
    }
  });

  it("spawn & output: delivers serial output from the child process", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }

      void loop() {
        Serial.println("HELLO");
        delay(50);
      }
    `;

    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("timeout waiting for output"));
      }, 15000);

      runner.runSketch(
        code,
        (line) => {
          received.push(line);
          if (received.filter((l) => l.includes("HELLO")).length >= 3) {
            clearTimeout(timeout);
            // Basic sanity: lines contain the printed word
            expect(received.some((l) => l.includes("HELLO"))).toBe(true);
            runner.stop().then(() => resolve()).catch(reject);
          }
        },
        (err) => {
          // ignore transient stderr markers used by runner internals
          if (err.includes("[[PIN_")) return;
        },
        () => {
          // onExit handled via resolve above; ignore here
        },
        undefined,
        undefined,
        undefined,
        10,
      );
    });
  }, 20000);

  it("lifecycle signals: SIGSTOP pauses and SIGCONT resumes the process output", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }

      void loop() {
        Serial.println("PING");
        delay(50);
      }
    `;

    const lines: Array<{ text: string; time: number }> = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("timeout in pause/resume test"));
      }, 20000);

      runner.runSketch(
        code,
        (line) => {
          lines.push({ text: line, time: Date.now() });

          // Once we have a few lines, perform pause/resume checks
          if (lines.length === 4) {
            const beforePauseCount = lines.length;

            // Pause the process (sends SIGSTOP)
            const paused = runner.pause();
            expect(paused).toBe(true);

            // Wait long enough that no new lines should arrive while paused
            setTimeout(() => {
              const afterPauseCount = lines.length;
              expect(afterPauseCount).toBe(beforePauseCount);

              // Resume and verify output continues
              const resumed = runner.resume();
              expect(resumed).toBe(true);

              // Wait for at least one more line after resume
              const waitForResume = setTimeout(() => {
                try {
                  expect(lines.length).toBeGreaterThan(afterPauseCount);
                  clearTimeout(timeout);
                  runner.stop().then(() => resolve()).catch(reject);
                } catch (err) {
                  reject(err);
                }
              }, 600);
            }, 400);
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
        },
        () => {
          // onExit ignored here
        },
        undefined,
        undefined,
        undefined,
        15,
      );
    });
  }, 25000);

  it("stop() reliably terminates the child process and prevents further output", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }

      void loop() {
        Serial.println("GOODBYE");
        delay(50);
      }
    `;

    const captured: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          runner.stop();
        } finally {
          reject(new Error("timeout in stop() test"));
        }
      }, 15000);

      runner.runSketch(
        code,
        (line) => {
          captured.push(line);

          // Be resilient: stop shortly after the first serial output (avoids flaky timing)
          if (captured.length === 1) {
            setTimeout(() => {
              runner.stop().catch(() => {});
            }, 50);
          }
        },
        (err) => {},
        undefined,
        undefined,
        undefined,
        undefined,
        10,
      );

      // Poll for first output (max 2s) then ensure stop prevented further output
      const start = Date.now();
      const pollForOutput = () => {
        if (captured.length > 0) {
          const afterStopCount = captured.length;
          // Wait another 200ms to ensure no additional output arrives
          setTimeout(() => {
            try {
              expect(captured.length).toBe(afterStopCount);
              clearTimeout(timeout);
              resolve();
            } catch (err) {
              reject(err);
            }
          }, 200);
        } else if (Date.now() - start > 5000) {
          // Failed to observe any output before timeout — treat as test failure
          clearTimeout(timeout);
          reject(new Error("no serial output observed before stop (timeout 5s)"));
        } else {
          setTimeout(pollForOutput, 50);
        }
      };
      setTimeout(pollForOutput, 50);
    });
  }, 20000);

  it("regression: stopping immediately while data flows does not cause unhandled errors", async () => {
    const code = `
      void setup() { Serial.begin(9600); }
      void loop() { Serial.println("RACE"); delay(20); }
    `;

    // Track if any uncaught error happens during test
    let uncaught: any = null;
    const uex = (err: any) => { uncaught = err; };
    process.once('uncaughtException', uex);
    process.once('unhandledRejection', uex);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout in race regression test')), 8000);

      let seen = false;
      const runnerResolve = () => {
        clearTimeout(timeout);
        process.removeListener('uncaughtException', uex);
        process.removeListener('unhandledRejection', uex);
        if (uncaught) return reject(uncaught);
        resolve();
      };

      const runPromise = runner.runSketch(
        code,
        (line) => {
          if (!seen) {
            seen = true;
            // Immediately stop when first data arrives — replicate race window
            runner.stop().catch(() => {});
            // finish shortly after to ensure no asynchronous unhandled errors occur
            setTimeout(runnerResolve, 300);
          }
        },
        () => {},
        () => {},
        undefined,
        undefined,
        undefined,
        5,
      );

      // Safety: if no output observed in time, fail
      setTimeout(() => {
        if (!seen) {
          clearTimeout(timeout);
          process.removeListener('uncaughtException', uex);
          process.removeListener('unhandledRejection', uex);
          reject(new Error('no output observed to trigger race'));
        }
      }, 3000); // increased to reduce flakiness on CI/full-suite runs
    });
  }, 10000);

  it("error handling: process can exit with non-zero code and onExit receives that code", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
        // Force an immediate non-zero exit
        exit(42);
      }
      void loop() { }
    `;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("timeout waiting for non-zero exit"));
      }, 10000);

      runner.runSketch(
        code,
        () => {},
        () => {},
        (exitCode) => {
          try {
            expect(exitCode).toBe(42);
            clearTimeout(timeout);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        undefined,
        undefined,
        undefined,
        5,
      );
    });
  }, 10000);
});
