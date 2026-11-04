/**
 * Integration Test: Serial Output Flooding & Drop Verification
 * 
 * Verifies that output produced faster than the baudrate allows is throttled
 * by the simulated TX buffer and nothing is dropped (FIFO buffering).
 * 
 * KEY INSIGHT: The C++ mock's txDelay() caps at 10ms. For short strings
 * (< 115 chars), txDelay naturally limits output to ~baudrate, so no drops.
 * Only strings > 115 chars trigger the 10ms cap, producing data faster
 * than the baudrate allows.
 * 
 * Math at 115200 baud:
 * - Budget per tick (50ms): 576 bytes
 * - Burst budget (3×): 1728 bytes
 * - txDelay for 200 chars: 17.4ms → capped to 10ms → 5 iterations/tick = 1005 bytes/tick
 * - Steady-state surplus: ~429 bytes/tick ≈ 8580 bytes/s, buffered rather than dropped
 */

import { SandboxRunner } from '../../server/services/sandbox-runner';
import { expectCompleteCounterSequence, extractPlainText, runSketchWithOutput } from '../utils/serial-test-helper';

const _skipHeavy = process.env.SKIP_HEAVY_TESTS !== "0" && process.env.SKIP_HEAVY_TESTS !== "false";
const maybeDescribe = _skipHeavy ? describe.skip : describe;

// Use stderr to bypass vitest console capture
const log = (msg: string) => process.stderr.write(msg + '\n');

maybeDescribe('Serial Output Flooding', () => {
  let runner: SandboxRunner;

  beforeEach(() => {
    runner = new SandboxRunner();
  });

  afterEach(async () => {
    await runner.stop();
    expect(runner.hasPendingContainerCleanup).toBe(false);
  });

  /**
   * WORST-CASE SKETCH: Long strings in tight loop
   * 
   * This sketch prints 200-character lines in a tight loop for 2 seconds.
   * Each line contains a counter so we can detect dropped lines.
   * 
   * Expected behavior:
   * - Each println produces 200 chars + counter + newline ≈ 205 bytes
   * - txDelay(205) = (10 * 205 * 1000) / 115200 = 17.8ms → capped to 10ms
   * - Rate: ~100 lines/s × 205 bytes = ~20500 bytes/s
   * - Budget: 11520 bytes/s
   * - The surplus is buffered (FIFO), not dropped
   *
   * We verify: every numbered line up to the total the sketch reports arrives complete.
   */
  test('T-FLOOD-01: Long strings are throttled without drops (200-char lines for 2s)', async () => {
    const sketch = String.raw`
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  // Run for 2 seconds, report how many lines were printed, then exit
  if (millis() - start > 2000) {
    Serial.print("===END ");
    Serial.print(counter);
    Serial.println("===");
    delay(100);
    exit(0);
  }
  
  // Print a 200-char line with counter prefix
  // Format: "NNN:AAAAA...AAAAA" where NNN is the line number (zero-padded)
  char buf[256];
  // Create a long payload that exceeds txDelay cap threshold (>115 chars)
  snprintf(buf, sizeof(buf), "%06lu:", counter);
  // Fill rest with 'X' to reach ~200 chars total
  size_t prefixLen = strlen(buf);
  for (size_t i = prefixLen; i < 200; i++) {
    buf[i] = 'X';
  }
  buf[200] = '\0';
  Serial.println(buf);
  counter++;
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 30 });

    expect(result.success).toBe(true);

    const fullOutput = extractPlainText(result.outputs);
    // Every line 000000 … total-1 arrives complete (6-digit counter, ':' and 193 'X'), none dropped:
    // with FIFO buffering (Phase 7r2+) data is buffered rather than dropped, and this test stays below
    // MAX_QUEUE_BYTES (100 KB). The old "tail wins" strategy would have dropped about 43 % here.
    const { total } = expectCompleteCounterSequence(fullOutput, /^(\d{6}):X{193}$/);
    log(`[T-FLOOD-01] Complete sequence of ${total} lines, ${fullOutput.length} bytes`);
  }, 30000);

  /**
   * CONTROL TEST: Short strings should NOT cause drops
   * 
   * With "X\n" (2 bytes), txDelay = 0.17ms → ~288 iterations per 50ms = 576 bytes.
   * Budget per tick: 576 bytes. Perfect match → zero drops.
   */
  test('T-FLOOD-02: Short strings do NOT cause drops (2-byte lines)', async () => {
    const sketch = `
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  if (millis() - start > 1000) {
    Serial.print("===END ");
    Serial.print(counter);
    Serial.println("===");
    delay(100);
    exit(0);
  }
  
  Serial.println(counter);
  counter++;
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 30 });
    expect(result.success).toBe(true);

    const fullOutput = extractPlainText(result.outputs);
    // txDelay throttles short lines to the baudrate, so every counter 0 … total-1 arrives.
    const { total } = expectCompleteCounterSequence(fullOutput, /^(\d+)$/);
    log(`[T-FLOOD-02] Complete sequence of ${total} lines, ${fullOutput.length} bytes`);
  }, 30000);
});
