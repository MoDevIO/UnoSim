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

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

maybeDescribe('Serial Backpressure (Arduino TX Buffer)', () => {
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

    const result = await runSketchWithOutput(runner, sketch, { timeout: 30 });
    expect(result.success).toBe(true);

    const output = extractPlainText(result.outputs);
    log('[T-BP-01] Output:\n' + output.slice(0, 500));

    // Should receive all 10 lines (no drops due to backpressure throttling)
    const lineMatches = output.match(/Line \d{6}/g) || [];
    log(`[T-BP-01] Lines received: ${lineMatches.length}`);
    
    expect(lineMatches).toHaveLength(10);

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
});
