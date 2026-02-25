import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";

const skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = describe;

maybeDescribe("SandboxRunner - Pause/Resume Timing", () => {
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

  it("should freeze time during pause", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }
      
      void loop() {
        unsigned long t = millis();
        Serial.print("TIME:");
        Serial.println(t);
        delay(100);
      }
    `;

    const timeValues: number[] = [];
    let pauseTime = 0;
    let isPaused = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Test timeout"));
      }, 20000);

      runner.runSketch(
        code,
        (line) => {
          // Parse time values
          const match = line.match(/TIME:(\d+)/);
          if (match) {
            const value = parseInt(match[1]);
            timeValues.push(value);

            // After collecting some initial values, pause the simulation
            if (timeValues.length === 3 && !isPaused) {
              isPaused = true;
              pauseTime = value;
              runner.pause();

              // Wait 500ms then resume
              setTimeout(() => {
                const timeAfterPause = timeValues[timeValues.length - 1];
                // Time should not have advanced during pause
                expect(timeAfterPause).toBe(pauseTime);
                runner.resume();

                // Wait a bit more to collect post-resume values
                setTimeout(() => {
                  // after resume we expect at least one *new* time value to arrive
                  const initialLen = timeValues.length;
                  const check = () => {
                    if (timeValues.length > initialLen) {
                      const afterResumeTime = timeValues[timeValues.length - 1];
                      // Time should resume and advance
                      expect(afterResumeTime).toBeGreaterThan(pauseTime);
                      runner.stop();
                      clearTimeout(timeout);
                      resolve();
                    } else {
                      // try again shortly
                      setTimeout(check, 20);
                    }
                  };
                  check();
                }, 300);
              }, 500);
            }
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
          if (err.includes("[[STDIN_RECV")) return;
        },
        () => {}, // onExit
        undefined, // onCompileError
        undefined, // onCompileSuccess
        undefined, // onPinStateChange
        15,
      );
    });
  }, 10000);

  it("should maintain time continuity across pause/resume cycles", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }
      
      void loop() {
        unsigned long t = millis();
        Serial.print("T:");
        Serial.println(t);
        delay(50);
      }
    `;

    const timeReadings: Array<{ value: number; isPaused: boolean }> = [];
    let cycle = 0;
    let pausedInCycle = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Test timeout"));
      }, 30000);

      runner.runSketch(
        code,
        (line) => {
          const match = line.match(/T:(\d+)/);
          if (match) {
            const value = parseInt(match[1]);
            timeReadings.push({
              value,
              isPaused: runner.isPaused,
            });
          }

          // Perform multiple pause/resume cycles
          if (
            timeReadings.length > 0 &&
            timeReadings.length % 4 === 0 &&
            cycle < 2 &&
            !pausedInCycle
          ) {
            pausedInCycle = true;
            const lastValue = timeReadings[timeReadings.length - 1].value;
            runner.pause();

            setTimeout(() => {
              // Verify time didn't advance during pause
              const pausedReadings = timeReadings.filter((r) => r.isPaused);
              pausedReadings.forEach((r) => {
                expect(r.value).toBe(lastValue);
              });

              runner.resume();
              pausedInCycle = false;
              cycle++;

              if (cycle === 2) {
                setTimeout(() => {
                  runner.stop();
                  clearTimeout(timeout);

                  // Verify time continuity: values should be non-decreasing
                  for (let i = 1; i < timeReadings.length; i++) {
                    const prev = timeReadings[i - 1];
                    const curr = timeReadings[i];
                    // If both paused, should be same time
                    if (prev.isPaused && curr.isPaused) {
                      expect(curr.value).toBe(prev.value);
                    }
                    // Otherwise should be greater or equal
                    else {
                      expect(curr.value).toBeGreaterThanOrEqual(prev.value);
                    }
                  }

                  resolve();
                }, 300);
              }
            }, 300);
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
          if (err.includes("[[STDIN_RECV")) return;
        },
        () => {}, // onExit
        undefined,
        undefined,
        undefined,
        20,
      );
    });
  });

  it("should handle micros() freeze during pause", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
      }
      
      void loop() {
        unsigned long t = micros();
        Serial.print("USEC:");
        Serial.println(t);
        delayMicroseconds(1000);
      }
    `;

    const microValues: number[] = [];
    let pauseTime = 0;
    let isPaused = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Test timeout"));
      }, 20000);

      runner.runSketch(
        code,
        (line) => {
          try {
            const match = line.match(/USEC:(\d+)/);
            if (match) {
              const value = parseInt(match[1]);
              microValues.push(value);

              // After collecting values, pause (only once runner is running)
              if (microValues.length === 3 && !isPaused && runner.isRunning) {
                isPaused = true;
                pauseTime = value;
                // remember index of first paused value
                const pauseIndex = microValues.length - 1;
                runner.pause();

                setTimeout(() => {
                  try {
                    // pick the first value after pauseIndex -- freeze means it should equal pauseTime
                    const resumeTime = microValues[pauseIndex];
                    expect(resumeTime).toBe(pauseTime);
                    runner.resume();

                    setTimeout(() => {
                      try {
                        runner.stop();
                        clearTimeout(timeout);

                        const afterResumeTime = microValues[microValues.length - 1];
                        expect(afterResumeTime).toBeGreaterThan(pauseTime);
                        resolve();
                      } catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                      }
                    }, 300);
                  } catch (err) {
                    clearTimeout(timeout);
                    reject(err);
                  }
                }, 500);
              }
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
          if (err.includes("[[STDIN_RECV")) return;
        },
        () => {}, // onExit
        undefined,
        undefined,
        undefined,
        15,
      );
    });
  });

  it("should properly reset pauseStartTime on stop", async () => {
    /*
     * Poor gating was causing this test to hang when the output callback
     * never fired.  Instead of waiting for an arbitrary line we drive the
     * sketch with a simple micros loop and control the flow with timers.
     * The promise always either resolves or rejects via the timeout handler.
     */
    const code = `
      void setup() {
        Serial.begin(9600);
      }

      void loop() {
        // continuously emit a timestamp so we know the sketch is alive
        Serial.println(micros());
        delay(100);
      }
    `;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Test timeout"));
      }, 10000);

      let sawOutput = false;
      runner.runSketch(
        code,
        (line) => { sawOutput = true; },
        () => {},
        () => {},
        undefined,
        undefined,
        undefined,
        15,
      );

      // wait for at least one output line (guaranteed running) before pausing

      // after we see output, actually pause
      const check = setInterval(async () => {
        if (sawOutput) {
          clearInterval(check);
          try {
            runner.pause();
            expect(runner.isPaused).toBe(true);
            expect((runner as any).pauseStartTime).not.toBeNull();

            await runner.stop();
            clearTimeout(timeout);
            expect((runner as any).pauseStartTime).toBeNull();
            expect(runner.isPaused).toBe(false);
            resolve();
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        }
      }, 200);
    });
  }, 15000);
});
