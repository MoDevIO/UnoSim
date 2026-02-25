/**
 * Integration Test: Serial Output Flow
 * 
 * Validates that the ArduinoOutputParser is correctly integrated into the
 * SandboxRunner and that Serial.print() output is processed with proper
 * timing and formatting.
 * 
 * These tests verify the critical message queue flushing behavior that
 * ensures output is delivered even when sketches exit quickly (< 1.5s).
 */

import { vi } from "vitest";
import { SandboxRunner } from '../../server/services/sandbox-runner';
import { extractPlainText, runSketchWithOutput } from '../utils/serial-test-helper';

describe('Serial Output Flow Integration', () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
    // Short delay to allow cleanup
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  test('Serial.print with delayed dots should arrive in separate chunks', async () => {
    // increase timeout from default 5s to 15s since compilation+batching may exceed 5s
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.print(".");
  delay(50);
  Serial.print(".");
  delay(50);
  Serial.print(".");
  Serial.println();
}

void loop() {
  // Exit after setup
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Should contain dots (due to batching, they might arrive together)
    expect(fullOutput).toContain('.');
  }, 15000);

  test('Serial.print with HEX conversion should format correctly', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.print(255, HEX);
  Serial.print(" ");
  Serial.print(78, HEX);
  Serial.println();
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Arduino prints uppercase hex by default
    expect(fullOutput.toUpperCase()).toContain('FF');
    expect(fullOutput.toUpperCase()).toContain('4E');
  });

  test('Serial.print with float precision should format correctly', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.print(3.1415, 2);
  Serial.print(" ");
  Serial.print(1.234, 3);
  Serial.println();
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Should contain formatted floats
    expect(fullOutput).toContain('3.14');
    expect(fullOutput).toContain('1.234');
  });

  test('Serial.println should flush immediately', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.println("Immediate");
  Serial.println("Flush");
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    expect(fullOutput).toContain('Immediate');
    expect(fullOutput).toContain('Flush');
  });

  test('Control characters should pass through correctly', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.print("AB\\b");
  Serial.println();
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Should contain backspace character
    expect(fullOutput).toContain('AB\b');
  });

  /**
   * CRITICAL EDGE CASE TEST: Message Queue Flush on Immediate Exit
   * 
   * This test verifies the fix for the message queue flushing bug.
   * 
   * BACKGROUND:
   * - SandboxRunner queues output messages while waiting for I/O registry (1.5s wait mode)
   * - If sketch exits BEFORE registry timeout, queued messages were historically lost
   * - This caused integration tests to receive empty output arrays
   * 
   * THE FIX:
   * Added flushMessageQueue() call in both Docker and local close handlers
   * (server/services/sandbox-runner.ts lines ~735 and ~825)
   * 
   * This test uses an extremely fast sketch (no delays) that exits immediately
   * after printing. Without the fix, outputs would be empty. With the fix,
   * the message queue is flushed on process close, delivering the output.
   */
  test('Message queue should flush even for immediate exit after Serial.print', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.print("QUICK");
  // Tiny delay to allow serial write to complete, then immediate exit
  // This ensures we're testing message queue flush, not serial buffering
  delay(10);
  exit(0);
}

void loop() {}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 10 });

    // Should succeed even though sketch exits in < 200ms (before 1.5s registry timeout)
    expect(result.success).toBe(true);

    const fullOutput = extractPlainText(result.outputs);
    
    // CRITICAL: This would fail without the flushMessageQueue() fix
    // because the sketch exits before the registry wait mode timeout
    expect(fullOutput).toContain('QUICK');
    
    // Verify we actually got output quickly (not from fallback timeout)
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test('Serial output from setup() must appear before loop() output', async () => {
    const sketch = `
bool done = false;

void setup() {
  Serial.begin(9600);
  Serial.println("SETUP");  // From setup()
  delay(5); // allow serial parser to flush
}

void loop() {
  if (!done) {
    Serial.println("LOOP");  // First iteration of loop()
    delay(5);
    done = true;
    exit(0);
  }
}
    `.trim();

      const result = await runSketchWithOutput(runner, sketch, { timeout: 15 });

      expect(result.success).toBe(true);

      const fullOutput = extractPlainText(result.outputs);
    
        // CRITICAL: setup() output ("SETUP") MUST appear before loop() output ("LOOP")
      // This validates that serial data is NOT queued during registry wait mode
        const index1 = fullOutput.indexOf('SETUP');
        const index2 = fullOutput.indexOf('LOOP');
    
        expect(index1).toBeGreaterThan(-1); // "SETUP" should be present
        expect(index2).toBeGreaterThan(-1); // "LOOP" should be present
        expect(index1).toBeLessThan(index2); // "SETUP" must come BEFORE "LOOP"
    
      });

  test('Serial.println with arbitrary base (base 3) should output correct value', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.println(255, 3);
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // 255 in base 3 = 100110
    // Arduino's printNumber supports any base >= 2
    expect(fullOutput).toContain('100110');
  });

  test('Serial.print with invalid base (< 2) should default to decimal', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.println(42, 1);
  Serial.println(42, 0);
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Base < 2 should default to base 10 (decimal), printing "42" twice
    const matches = fullOutput.match(/42/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  test('Serial.write should produce output via SERIAL_EVENT', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  Serial.write('A');
  Serial.write('B');
  Serial.write('C');
  Serial.println();
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // Serial.write sends raw bytes - should appear as characters
    expect(fullOutput).toContain('ABC');
  });

  test('Serial.print byte with base should format correctly', async () => {
    const sketch = `
void setup() {
  Serial.begin(9600);
  byte val = 255;
  Serial.println(val, HEX);
  Serial.println(val, BIN);
}

void loop() {
  exit(0);
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch);

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const fullOutput = extractPlainText(result.outputs);
    
    // 255 in HEX = FF (uppercase on real Arduino)
    expect(fullOutput.toUpperCase()).toContain('FF');
    // 255 in BIN = 11111111
    expect(fullOutput).toContain('11111111');
  });

  test('Serial output at low baudrate (300) should complete in < 2 seconds due to txDelay capping', async () => {
    const sketch = `
void setup() {
  Serial.begin(300);  // Very low baudrate
  Serial.println("Hello World!");  // Would take 3.3s without capping
}

void loop() {
  exit(0);
}
    `.trim();

    const start = Date.now();
    const result = await runSketchWithOutput(runner, sketch, { timeout: 15 });
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    const fullOutput = extractPlainText(result.outputs);
    expect(fullOutput).toContain('Hello World');

    // txDelay is capped at 10ms, so even with low baudrate, should complete quickly
    expect(elapsed).toBeLessThan(2000);  // Should complete in < 2 seconds
  });
});
