import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SandboxRunner } from "../../server/services/sandbox-runner";

const skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = skipHeavy ? describe.skip : describe;

maybeDescribe("Pause/Resume - digitalRead after Resume", () => {
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

  it("should read pin value correctly BEFORE pause", async () => {
    // Test that digitalRead works at all before pause
    const code = `
      void setup() {
        Serial.begin(9600);
        pinMode(2, INPUT);
      }
      void loop() {
        int val = digitalRead(2);
        Serial.print("PIN2=");
        Serial.println(val);
        delay(100);
      }
    `;

    const output: string[] = [];
    let pinStateReceived = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Timeout waiting for output"));
      }, 15000);

      runner.runSketch(
        code,
        (line) => {
          output.push(line);
          // Check if we got at least one PIN2= output
          const fullOutput = output.join("");
          if (fullOutput.includes("PIN2=0") || fullOutput.includes("PIN2=1")) {
            // Now set pin to HIGH
            runner.setPinValue(2, 1);
          }
          // Wait for PIN2=1 to appear (after setting pin)
          if (fullOutput.includes("PIN2=1")) {
            clearTimeout(timeout);
            runner.stop();
            resolve();
          }
        },
        (err) => {
          // Ignore pin state messages
          if (err.includes("[[PIN_")) return;
          if (err.includes("[[STDIN_RECV")) return;
          console.error("Error:", err);
        },
        () => {}, // onExit
        undefined, // onCompileError
        undefined, // onCompileSuccess
        (pin, type, value) => {
          pinStateReceived = true;
          console.log(`Pin state: pin=${pin}, type=${type}, value=${value}`);
        },
        10, // timeout
      );
    });

    const fullOutput = output.join("");
    expect(fullOutput).toContain("PIN2=1");
    console.log("✅ digitalRead works BEFORE pause");
  });

  it("should read pin value correctly AFTER pause/resume", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
        pinMode(2, INPUT);
        Serial.println("SETUP_DONE");
      }
      void loop() {
        int val = digitalRead(2);
        Serial.print("PIN2=");
        Serial.println(val);
        delay(200);
      }
    `;

    const output: string[] = [];
    const stderrLines: string[] = [];
    let setupDone = false;
    let pausedOnce = false;
    let resumedOnce = false;
    let pinSetAfterResume = false;

    const result = await new Promise<{success: boolean, output: string, stderr: string}>((resolve) => {
      const timeout = setTimeout(() => {
        runner.stop();
        resolve({
          success: false,
          output: output.join(""),
          stderr: stderrLines.join("\n")
        });
      }, 15000);

      runner.runSketch(
        code,
        (line) => {
          output.push(line);
          const fullOutput = output.join("");
          
          // Step 1: Wait for setup to complete
          if (fullOutput.includes("SETUP_DONE") && !setupDone) {
            setupDone = true;
          }

          // Step 2: After seeing first PIN2=0, pause
          if (fullOutput.includes("PIN2=0") && setupDone && !pausedOnce) {
            pausedOnce = true;
            const paused = runner.pause();
            stderrLines.push(`[TEST] Pause called, result: ${paused}`);
            
            // Step 3: Wait a bit, then resume
            setTimeout(() => {
              const resumed = runner.resume();
              stderrLines.push(`[TEST] Resume called, result: ${resumed}`);
              resumedOnce = true;
              
              // Step 4: After resume, set pin to HIGH
              setTimeout(() => {
                stderrLines.push(`[TEST] Setting pin 2 to HIGH`);
                stderrLines.push(`[TEST] runner.isRunning=${runner.isRunning}, runner.isPaused=${runner.isPaused}`);
                stderrLines.push(`[TEST] runner.process exists: ${!!(runner as any).process}`);
                stderrLines.push(`[TEST] runner.process.stdin exists: ${!!((runner as any).process?.stdin)}`);
                stderrLines.push(`[TEST] runner.process.killed: ${(runner as any).process?.killed}`);
                runner.setPinValue(2, 1);
                pinSetAfterResume = true;
              }, 500);
            }, 1000);
          }

          // Step 5: Check if we get PIN2=1 after setting pin post-resume
          if (pinSetAfterResume && fullOutput.includes("PIN2=1")) {
            clearTimeout(timeout);
            runner.stop();
            resolve({
              success: true,
              output: fullOutput,
              stderr: stderrLines.join("\n")
            });
          }
        },
        (err) => {
          stderrLines.push(`[STDERR] ${err}`);
        },
        () => {
          stderrLines.push(`[TEST] Process exited`);
        },
        undefined, // onCompileError
        undefined, // onCompileSuccess
        (pin, type, value) => {
          stderrLines.push(`[PIN_STATE] pin=${pin}, type=${type}, value=${value}`);
        },
        30, // timeout
      );
    });

    // Print debug info BEFORE assertions
    process.stderr.write("\n=== TEST RESULTS ===\n");
    process.stderr.write("Success: " + result.success + "\n");
    process.stderr.write("\n--- STDOUT ---\n");
    process.stderr.write(result.output + "\n");
    process.stderr.write("\n--- STDERR/DEBUG ---\n");
    process.stderr.write(result.stderr + "\n");
    process.stderr.write("===================\n\n");

    expect(result.success).toBe(true);
    expect(result.output).toContain("PIN2=1");
  }, 30000); // 30 second test timeout

  it("should handle multiple pin changes after resume", async () => {
    const code = `
      void setup() {
        Serial.begin(9600);
        pinMode(2, INPUT);
        pinMode(3, INPUT);
        Serial.println("READY");
      }
      void loop() {
        int val2 = digitalRead(2);
        int val3 = digitalRead(3);
        Serial.print("P2=");
        Serial.print(val2);
        Serial.print(" P3=");
        Serial.println(val3);
        delay(150);
      }
    `;

    const output: string[] = [];
    let ready = false;
    let pausedOnce = false;
    let resumedOnce = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        const fullOutput = output.join("");
        console.log("Final output:", fullOutput);
        reject(new Error("Timeout - did not see expected pin values after resume"));
      }, 25000);

      runner.runSketch(
        code,
        (line) => {
          output.push(line);
          const fullOutput = output.join("");
          
          if (fullOutput.includes("READY") && !ready) {
            ready = true;
            console.log("📍 Ready, waiting for initial output...");
          }

          // After seeing P2=0, pause
          if (fullOutput.includes("P2=0") && ready && !pausedOnce) {
            pausedOnce = true;
            console.log("📍 Pausing...");
            runner.pause();
            
            setTimeout(() => {
              console.log("📍 Resuming...");
              runner.resume();
              resumedOnce = true;
              
              // Set both pins after resume
              setTimeout(() => {
                console.log("📍 Setting pin 2 to HIGH...");
                runner.setPinValue(2, 1);
                setTimeout(() => {
                  console.log("📍 Setting pin 3 to HIGH...");
                  runner.setPinValue(3, 1);
                }, 200);
              }, 500);
            }, 1000);
          }

          // Check for P2=1 P3=1
          if (resumedOnce && fullOutput.includes("P2=1") && fullOutput.includes("P3=1")) {
            console.log("✅ SUCCESS: Both pins read correctly after resume!");
            clearTimeout(timeout);
            runner.stop();
            resolve();
          }
        },
        (err) => {
          if (err.includes("[[PIN_")) return;
          if (err.includes("[[STDIN_RECV")) {
            console.log("📍 C++ stdin:", err);
            return;
          }
          console.error("Stderr:", err);
        },
        () => {},
        undefined,
        undefined,
        (pin, type, value) => {
          console.log(`📍 Pin: ${pin}=${value} (${type})`);
        },
        30,
      );
    });

    const fullOutput = output.join("");
    expect(fullOutput).toContain("P2=1");
    expect(fullOutput).toContain("P3=1");
  });
});
