import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { resetUnifiedGatekeeper } from "../../server/services/unified-gatekeeper";
import {
  extractPlainText,
  runSketchWithOutput,
} from "../utils/serial-test-helper";

const SERIAL_CONTRACT_SKETCH = String.raw`
void setup() {
  Serial.begin(9600);

  Serial.print("DOTS=");
  Serial.print(".");
  delay(5);
  Serial.print(".");
  delay(5);
  Serial.println(".");

  Serial.print("HEX=");
  Serial.print(255, HEX);
  Serial.print(",");
  Serial.println(78, HEX);

  Serial.print("FLOAT=");
  Serial.print(3.1415, 2);
  Serial.print(",");
  Serial.println(1.234, 3);

  Serial.print("CTRL=AB\b");
  Serial.println();

  Serial.print("BASE3=");
  Serial.println(255, 3);

  Serial.print("INVALID_BASE=");
  Serial.print(42, 1);
  Serial.print(",");
  Serial.println(42, 0);

  Serial.print("WRITE=");
  Serial.write('A');
  Serial.write('B');
  Serial.write('C');
  Serial.println();

  byte value = 255;
  Serial.print("BYTE=");
  Serial.print(value, HEX);
  Serial.print(",");
  Serial.println(value, BIN);

  Serial.println("SETUP_END");
}

void loop() {
  Serial.println("LOOP");
  delay(5);
  exit(0);
}
`.trim();

describe("Serial output flow", () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    vi.useRealTimers();
    resetUnifiedGatekeeper();
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await runner.stop();
  });

  it("preserves formatting, flushing and setup/loop order in one real smoke", async () => {
    const result = await runSketchWithOutput(runner, SERIAL_CONTRACT_SKETCH, {
      timeout: 30,
      fallbackTimeout: 45_000,
    });

    expect(result.success, result.error).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);

    const output = extractPlainText(result.outputs);
    expect(output).toContain("DOTS=...");
    expect(output).toContain("HEX=FF,4E");
    expect(output).toContain("FLOAT=3.14,1.234");
    expect(output).toContain("CTRL=AB\b");
    expect(output).toContain("BASE3=100110");
    expect(output).toContain("INVALID_BASE=42,42");
    expect(output).toContain("WRITE=ABC");
    expect(output).toContain("BYTE=FF,11111111");

    const setupIndex = output.indexOf("SETUP_END");
    const loopIndex = output.indexOf("LOOP");
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(loopIndex).toBeGreaterThan(setupIndex);
  }, 60_000);
});
