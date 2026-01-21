import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SandboxRunner } from "../../server/services/sandbox-runner";

// Increase timeout for compilation and execution
jest.setTimeout(60000);

describe("Backspace E2E Test", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    // Ensure runner is stopped and allow short delay for cleanup
    try {
      if (runner && typeof runner.stop === "function") {
        const maybe = runner.stop();
        if (maybe && typeof maybe.then === "function") {
          await maybe;
        }
      }
    } catch (e) {
      console.warn("Warning during runner.stop():", e);
    }

    // small delay to allow any lingering handles to close
    await new Promise((resolve) => setTimeout(resolve, 200));

    // If a worker was used by tests, attempt to terminate it
    try {
      if ((globalThis as any).worker && typeof (globalThis as any).worker.terminate === "function") {
        const t = (globalThis as any).worker.terminate();
        if (t && typeof t.then === "function") await t;
      }
    } catch (e) {
      console.warn("Warning terminating global worker:", e);
    }
  });

  it("should show all characters 1, 2, 3, 4 in sequence with backspace correction", async () => {
    const testCode = `
void setup() {
  Serial.begin(115200);
  Serial.print("Counting: 1");
  delay(5);
  Serial.print("\\b2");
  delay(5);
  Serial.print("\\b3");
  delay(5);
  Serial.print("\\b4");
}

void loop() {
  // Empty loop - simulation should still flush all output
}
`;

    const allOutputs: Array<{ raw: string; timestamp: number; type: string }> =
      [];
    let exitCode: number | null = null;

    await new Promise<void>((resolve, reject) => {
      const startTime = Date.now();

      runner.runSketch(
        testCode,
        // onOutput - log EVERYTHING
        (line: string, isComplete?: boolean) => {
          const timestamp = Date.now() - startTime;
          allOutputs.push({ raw: line, timestamp, type: "output" });
          console.log(
            `[${timestamp}ms] RAW OUTPUT: ${JSON.stringify(line).substring(0, 200)}`,
          );
        },
        // onError
        (err: string) => {
          const timestamp = Date.now() - startTime;
          allOutputs.push({ raw: err, timestamp, type: "error" });
          console.log(`[${timestamp}ms] ERROR: ${err}`);
        },
        // onExit
        (code: number | null) => {
          exitCode = code;
          console.log(`[EXIT]: code=${code}`);
          resolve();
        },
        // onCompileError
        (compileErr: string) => {
          console.log(`[COMPILE ERROR]: ${compileErr}`);
          reject(new Error(`Compilation failed: ${compileErr}`));
        },
        // onCompileSuccess
        () => {
          console.log("[COMPILE SUCCESS]");
        },
        // onPinState
        undefined,
        // timeout (increased for slow hardware)
        5,
      );
    });

    console.log("\n=== ALL RAW OUTPUTS ===");
    allOutputs.forEach((o, i) => {
      console.log(
        `  ${i}: [${o.type}] "${JSON.stringify(o.raw).substring(0, 150)}" at ${o.timestamp}ms`,
      );
    });

    // Parse all SERIAL_EVENT_JSON messages
    const serialEvents: Array<{ data: string; ts: number }> = [];
    for (const o of allOutputs) {
      const match = o.raw.match(/\[\[SERIAL_EVENT_JSON:(.+)\]\]/);
      if (match) {
        try {
          const event = JSON.parse(match[1]);
          serialEvents.push({ data: event.data, ts: event.ts_write });
          console.log(
            `  Parsed: data="${JSON.stringify(event.data)}" hex=${Buffer.from(event.data).toString("hex")}`,
          );
        } catch {}
      }
    }

    console.log(`\n=== SERIAL EVENTS (${serialEvents.length}) ===`);
    serialEvents.forEach((e, i) => {
      console.log(
        `  ${i}: "${JSON.stringify(e.data)}" (hex: ${Buffer.from(e.data).toString("hex")})`,
      );
    });

    // Check we have at least 3 serial events (relaxed for slow hardware)
    expect(serialEvents.length).toBeGreaterThanOrEqual(3);

    // Combine and check for all backspace sequences
    const combined = serialEvents.map((e) => e.data).join("");
    console.log(
      `\nCombined: "${JSON.stringify(combined)}" (hex: ${Buffer.from(combined).toString("hex")})`,
    );

    expect(combined).toContain("Counting: 1");
    expect(combined).toContain("\b2");
    expect(combined).toContain("\b3");
    expect(combined).toContain("\b4");

    // Apply backspaces
    let visual = "";
    for (const char of combined) {
      if (char === "\b") {
        visual = visual.slice(0, -1);
      } else {
        visual += char;
      }
    }
    console.log(`Visual result: "${visual}"`);

    expect(visual).toBe("Counting: 4");
  });

  it("should flush output even with empty loop", async () => {
    // Skip if Docker is not available in the environment (CI without Docker)
    let dockerAvailable = true;
    try {
      require("child_process").execSync("docker version", { stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      dockerAvailable = false;
    }
    if (process.env.CI && !dockerAvailable) {
      console.log("⚠️ Skipping test - Docker not available in CI");
      return;
    }
    const testCode = `
void setup() {
  Serial.begin(115200);
  Serial.print("A");
  delay(2);
  Serial.print("B");
  delay(2);
  Serial.print("C");
  // No newline at end!
}

void loop() {
  // Empty - tests that output is flushed on exit
}
`;

    const outputs: string[] = [];

    await new Promise<void>((resolve, reject) => {
      runner.runSketch(
        testCode,
        (line: string) => {
          const match = line.match(/\[\[SERIAL_EVENT_JSON:(.+)\]\]/);
          if (match) {
            try {
              const event = JSON.parse(match[1]);
              outputs.push(event.data);
              console.log(`Received: "${event.data}"`);
            } catch {
              outputs.push(line);
            }
          } else if (line.trim() && !line.includes("Simulation")) {
            outputs.push(line);
            console.log(`Received raw: "${line}"`);
          }
        },
        (err) => console.log(`Error: ${err}`),
        () => resolve(),
        (compileErr) => reject(new Error(compileErr)),
        () => {},
        undefined,
        2,
      );
    });

    const combined = outputs.join("");
    console.log(`Combined output: "${combined}"`);

    // All three characters should be received
    expect(combined).toContain("A");
    expect(combined).toContain("B");
    expect(combined).toContain("C");
  }, 60000);
});
