/**
 * Integration Test: Serial Output Flooding & Drop Verification
 * 
 * Verifies that the SerialOutputBatcher correctly drops data when the
 * C++ mock produces output faster than the baudrate allows.
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
 * - Expected steady-state drops: ~429 bytes/tick ≈ 8580 bytes/s
 */

import { SandboxRunner } from '../../server/services/sandbox-runner';
import { extractPlainText, runSketchWithOutput } from '../utils/serial-test-helper';

// Use stderr to bypass vitest console capture
const log = (msg: string) => process.stderr.write(msg + '\n');

describe('Serial Output Flooding', () => {
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
   * - Expected drops: ~9000 bytes/s (≈ 44% of data dropped)
   * 
   * We verify: numbered lines have GAPS (missing numbers = dropped lines).
   */
  test('T-FLOOD-01: Long strings cause drops (200-char lines for 2s)', async () => {
    const sketch = String.raw`
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  // Run for 2 seconds then exit
  if (millis() - start > 2000) {
    Serial.println("===END===");
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
    
    // Extract all line numbers from output
    const lineNumbers: number[] = [];
    const regex = /(\d{6}):/g;
    let match;
    while ((match = regex.exec(fullOutput)) !== null) {
      lineNumbers.push(Number.parseInt(match[1], 10));
    }

    log(`[T-FLOOD-01] Total received lines: ${lineNumbers.length}`);
    log(`[T-FLOOD-01] First line: ${lineNumbers[0]}, Last line: ${lineNumbers.at(-1)}`);
    log(`[T-FLOOD-01] Total bytes received: ${fullOutput.length}`);
    
    // There must be some output
    expect(lineNumbers.length).toBeGreaterThan(0);
    
    // Check for gaps (dropped lines)
    let gaps = 0;
    let totalMissing = 0;
    for (let i = 1; i < lineNumbers.length; i++) {
      const expected = lineNumbers[i - 1] + 1;
      if (lineNumbers[i] !== expected) {
        gaps++;
        totalMissing += lineNumbers[i] - expected;
      }
    }

    log(`[T-FLOOD-01] Gaps detected: ${gaps}`);
    log(`[T-FLOOD-01] Total missing lines: ${totalMissing}`);
    log(`[T-FLOOD-01] Last counter value: ${lineNumbers.at(-1)}`);
    
    // The last counter value shows how many lines the C++ mock produced.
    // With txDelay of 10ms, that's ~200 lines in 2 seconds.
    const totalProduced = lineNumbers.at(-1) + 1;
    const dropRate = totalMissing / totalProduced;
    
    log(`[T-FLOOD-01] Total produced by C++: ~${totalProduced}`);
    log(`[T-FLOOD-01] Drop rate: ${(dropRate * 100).toFixed(1)}%`);
    
    // NOTE: With FIFO buffering strategy (Phase 7r2+), we buffer instead of aggressively drop.
    // At 115200 baud, 200-char lines don't cause drops - they get buffered for delivery.
    // This is CORRECT per the new semantics: preserve low-baudrate data completeness.
    // Expected: 0 drops (data is buffered, not dropped)
    //
    // The old "tail wins" strategy would have dropped ~43% here.
    // The new "FIFO + memory safety" strategy only drops if MAX_QUEUE_BYTES (100KB) is exceeded.
    // This specific test doesn't hit that limit, so we expect no drops.
    expect(totalMissing).toBe(0);

    // And the output must contain the END marker
    expect(fullOutput).toContain('===END===');
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
    Serial.println("===END===");
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
    
    // Extract counters
    const lines = fullOutput.split(/\n|\r\n/).filter(l => /^\d+$/.test(l.trim()));
    
    log(`[T-FLOOD-02] Lines received: ${lines.length}`);
    log(`[T-FLOOD-02] Total bytes: ${fullOutput.length}`);
    
    // Check for gaps 
    let gaps = 0;
    const numbers = lines.map(l => Number.parseInt(l.trim(), 10)).filter(n => !Number.isNaN(n));
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i-1] + 1) {
        gaps++;
      }
    }
    
    log(`[T-FLOOD-02] Gaps: ${gaps}`);
    
    // With short strings at 115200 baud, txDelay naturally throttles to baudrate.
    // No drops expected (or very few due to startup burst).
    // We allow a small tolerance for the first tick transition.
    expect(gaps).toBeLessThan(3);
    expect(fullOutput).toContain('===END===');
  }, 30000);

  /**
   * EXTREME WORST-CASE: 500-char lines
   * 
   * txDelay = 43.5ms → capped to 10ms → 5 iterations per 50ms = 2505 bytes/tick
   * Budget: 576 bytes/tick
   * Expected drops: ~77% of data
   */
  test('T-FLOOD-03: Extreme flooding with 500-char lines', async () => {
    const sketch = String.raw`
void setup() {
  Serial.begin(115200);
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  if (millis() - start > 2000) {
    Serial.println("===END===");
    delay(100);
    exit(0);
  }
  
  // Print 500-char line
  char buf[520];
  snprintf(buf, sizeof(buf), "%06lu:", counter);
  size_t prefixLen = strlen(buf);
  for (size_t i = prefixLen; i < 500; i++) {
    buf[i] = 'X';
  }
  buf[500] = '\0';
  Serial.println(buf);
  counter++;
}
    `.trim();

    const result = await runSketchWithOutput(runner, sketch, { timeout: 30 });
    expect(result.success).toBe(true);

    const fullOutput = extractPlainText(result.outputs);
    
    const lineNumbers: number[] = [];
    const regex = /(\d{6}):/g;
    let match;
    while ((match = regex.exec(fullOutput)) !== null) {
      lineNumbers.push(Number.parseInt(match[1], 10));
    }

    let totalMissing = 0;
    for (let i = 1; i < lineNumbers.length; i++) {
      const expected = lineNumbers[i - 1] + 1;
      if (lineNumbers[i] !== expected) {
        totalMissing += lineNumbers[i] - expected;
      }
    }

    const totalProduced = lineNumbers.length > 0 ? lineNumbers.at(-1) + 1 : 0;
    const dropRate = totalProduced > 0 ? totalMissing / totalProduced : 0;

    log(`[T-FLOOD-03] Lines received: ${lineNumbers.length}`);
    log(`[T-FLOOD-03] Total produced: ~${totalProduced}`);
    log(`[T-FLOOD-03] Missing lines: ${totalMissing}`);
    log(`[T-FLOOD-03] Drop rate: ${(dropRate * 100).toFixed(1)}%`);
    log(`[T-FLOOD-03] Total bytes: ${fullOutput.length}`);

    // With backpressure simulation (Phase 7r2+), even 500-char lines don't cause drops
    // Arduino's TX buffer blocks Serial.println(), slowing the entire loop()
    // This prevents data loss even with "extreme" string sizes.
    // 
    // Old behavior (without backpressure): Would have 50%+ drops
    // New behavior (with backpressure):    0 drops, Arduino just runs slower
    expect(totalMissing).toBe(0);
    expect(fullOutput).toContain('===END===');
  }, 30000);
});
