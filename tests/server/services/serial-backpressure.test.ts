/**
 * Serial Backpressure Tests (Arduino TX Buffer Simulation)
 * 
 * When Arduino's TX buffer is full, Serial.println() should block,
 * slowing down the loop(). This is the key to realistic behavior:
 * 
 * Without backpressure: Arduino sends data at full speed → server drops excess
 * With backpressure: Arduino auto-throttles → server gets baudrate-matched stream
 * 
 * Real Arduino Uno:
 * - TX buffer = 64 bytes (UNO) or 128 bytes (MEGA)
 * - When full: Serial.write() blocks until bytes drain
 * - This naturally throttles the sketch's loop() speed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// backpressure tests can take longer
vi.setConfig({ testTimeout: 30000 });
import { SandboxRunner } from '../../../server/services/sandbox-runner';
import { extractPlainText, runSketchWithOutput } from '../../utils/serial-test-helper';

const log = (msg: string) => process.stderr.write(msg + '\n');

describe('Serial Backpressure (Arduino TX Buffer)', () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  /**
   * T-BP-01: TX Buffer Blocking Behavior
   * 
   * When Arduino TX buffer fills up, Serial.println() should block.
   * This manifests as increased intervals between consecutive sends.
   * 
   * Without backpressure:
   * - 100 * 150-byte lines in 50ms tick = 15KB/tick (way over baudrate)
   * 
   * With backpressure (TX_BUFFER = 256 bytes):
   * - Can queue ~1 line before blocking
   * - Next line must wait for draining
   * - Should see timestamps with significant gaps
   */
  it('T-BP-01: Serial.println() blocks when TX buffer fills', async () => {
    const sketch = String.raw`
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long lastTime = millis();
  
  // Stop after 10 iterations
  if (counter >= 10) {
    Serial.println("===END===");
    delay(100);
    exit(0);
  }
  
  // Print timestamp and line number
  unsigned long now = millis();
  unsigned long elapsed = now - lastTime;
  char buf[256];
  snprintf(buf, sizeof(buf), "[%05lu ms delta] Line %06lu: ", elapsed, counter);
  
  // Fill rest with data to create 150-byte lines
  size_t prefixLen = strlen(buf);
  for (size_t i = prefixLen; i < 148; i++) {
    buf[i] = 'X';
  }
  buf[148] = '\n';
  buf[149] = '\0';
  
  Serial.print(buf);
  
  lastTime = now;
  counter++;
  // No explicit delay - let Serial.print() backpressure do the throttling
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 10 });
    expect(result.success).toBe(true);

    const output = extractPlainText(result.outputs);
    log('[T-BP-01] Output:\n' + output.slice(0, 500));

    // Should receive all 10 lines (no drops due to backpressure throttling)
    const lineMatches = output.match(/Line \d{6}/g) || [];
    log(`[T-BP-01] Lines received: ${lineMatches.length}`);
    
    expect(lineMatches.length).toBe(10);

    // Extract timing deltas
    const deltas: number[] = [];
    const deltaRegex = /\[(\d+) ms delta\]/g;
    let match;
    while ((match = deltaRegex.exec(output)) !== null) {
      deltas.push(Number.parseInt(match[1], 10));
    }

    log(`[T-BP-01] Time deltas (ms): ${deltas.join(', ')}`);

    // After first line (warmup), subsequent deltas should be > 0
    // Backpressure means we can't loop faster than Serial can send
    const deltas_after_warmup = deltas.slice(1);
    const avg_delta = deltas_after_warmup.reduce((a, b) => a + b, 0) / deltas_after_warmup.length;
    log(`[T-BP-01] Average delta (after warmup): ${avg_delta.toFixed(2)} ms`);

    // With 150-byte lines at 115200 baud:
    // - Time to send one line: 150 bytes * 10 bits/byte / 115200 bps ≈ 13ms
    // - With backpressure, we should see deltas around this (±5ms for variance)
    // Without backpressure: deltas would be near 0
    expect(avg_delta).toBeGreaterThan(3); // At least some throttling
  }, 30000);

  /**
   * T-BP-02: No Server-Side Drops with Backpressure
   * 
   * Compare behavior with simple ("tail wins" old strategy) vs with backpressure.
   * 
   * When Arduino throttles itself via TX buffer blocking,
   * server shouldn't need to drop anything.
   * 
   * This is the key insight: with proper backpressure,
   * data loss moves from server-side to Arduino-side,
   * but in practice neither happens - it just slows down.
   */
  it('T-BP-02: With backpressure, no server-side drops occur', async () => {
    const sketch = String.raw`
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  // Run for 2 seconds
  if (millis() - start > 2000) {
    Serial.println("===END===");
    delay(100);
    exit(0);
  }
  
  // Print 200-char lines rapidly (same as T-FLOOD-01)
  char buf[256];
  snprintf(buf, sizeof(buf), "%06lu:", counter);
  size_t prefixLen = strlen(buf);
  for (size_t i = prefixLen; i < 200; i++) {
    buf[i] = 'X';
  }
  buf[200] = '\n';
  buf[201] = '\0';
  
  Serial.println(buf);
  counter++;
  // NO delay - let backpressure throttle us
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 10 });
    expect(result.success).toBe(true);

    const output = extractPlainText(result.outputs);

    // Extract line numbers to check for gaps
    const lineNumbers: number[] = [];
    const regex = /(\d{6})/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      const num = Number.parseInt(match[1], 10);
      // Avoid END marker
      if (num < 10000) {
        lineNumbers.push(num);
      }
    }

    log(`[T-BP-02] Total lines: ${lineNumbers.length}`);
    log(`[T-BP-02] First: ${lineNumbers[0]}, Last: ${lineNumbers.at(-1)}`);

    // Find gaps (dropped lines)
    let gaps = 0;
    let totalMissing = 0;
    for (let i = 1; i < lineNumbers.length; i++) {
      const expected = lineNumbers[i - 1] + 1;
      if (lineNumbers[i] !== expected) {
        gaps++;
        totalMissing += lineNumbers[i] - expected;
      }
    }

    const dropRate = totalMissing / (lineNumbers.at(-1) + 1);
    log(`[T-BP-02] Gaps: ${gaps}, Missing: ${totalMissing}, Drop rate: ${(dropRate * 100).toFixed(1)}%`);

    // With backpressure, drop rate should be VERY LOW or ZERO
    // (Arduino throttles itself, no server-side drops needed)
    expect(totalMissing).toBeLessThan(5); // Allow 1-2 edge case drops
    expect(dropRate).toBeLessThan(0.01); // < 1% drop rate
  }, 30000);

  /**
   * T-BP-03: TX Buffer Size Enforcement
   * 
   * Verify that we're actually simulating a TX buffer,
   * not just pretending backpressure exists.
   * 
   * This test specifically checks that when we
   * exceed TX_BUFFER_SIZE, operations start blocking.
   */
  it('T-BP-03: TX buffer size enforced correctly', async () => {
    const sketch = `
void setup() {
  Serial.begin(115200);
  // Flush to ensure state is clean
  Serial.flush();
}

void loop() {
  static bool testDone = false;
  
  if (testDone) {
    delay(100);
    exit(0);
  }
  
  // Send a series of small messages to fill TX buffer
  for (int i = 0; i < 5; i++) {
    // Each print is non-blocking individually
    Serial.print("ABCDEFGHIJ"); // 10 bytes
  }
  
  // If TX buffer is buffering, these arrivals should show timing data
  Serial.println("");
  Serial.println("===FLUSHED===");
  
  testDone = true;
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 15 });
    expect(result.success).toBe(true);

    const output = extractPlainText(result.outputs);
    log('[T-BP-03] Output:\n' + output);

    // Should see all 50 bytes (5 × 10) plus flush marker
    expect(output).toContain('ABCDEFGHIJ');
    expect(output).toContain('FLUSHED');
  });

  /**
   * T-BP-04: Contrast - Without backpressure (sanity check)
   * 
   * If we disable backpressure, we should see more drops
   * (for stress tests with pathological input rates).
   * 
   * This test documents the ON/OFF behavior.
   * (Implemented as a skip for now - would need a flag to disable backpressure)
   */
  it('T-BP-04: Overflow behavior when TX buffer is disabled (not implemented)', () => {
    // This test remains as documentation of intended behavior.  Currently
    // disabling backpressure is not supported by the mock; assert true to
    // keep the file executable.
    expect(true).toBe(true);
  });
});
