// Phase 7r1 Integration Tests - SerialOutputBatcher Usage
// Tests to verify that SandboxRunner uses SerialOutputBatcher for high-frequency output

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SerialOutputBatcher } from "../../../server/services/serial-output-batcher";

/**
 * Phase 7r1: Tests for SerialOutputBatcher Integration in SandboxRunner
 * 
 * These tests verify that:
 * 1. SerialOutputBatcher is used by SandboxRunner (not bypassed)
 * 2. High-frequency output is properly batched and dropped when exceeding baudrate
 * 3. Telemetry reflects dropped bytes correctly
 */

describe("SerialOutputBatcher - High-Frequency Output (Phase 7r1)", () => {
  let batcher: SerialOutputBatcher;
  const chunks: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    chunks.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    batcher.stop();
  });

  /**
   * T20: Simulate high-frequency Arduino output at 115200 baud
   * 
   * Scenario from user code:
   * - Serial.println("Hallo Welt") every 300ms (~12 bytes)
   * - Serial.println("---...") every 2ms (~62 bytes)
   * 
   * In 50ms at 115200 baud:
   * - 576 bytes allowed (115200 * 0.05 / 10)
   * - Initial burst: 1728 bytes (3x)
   * - With ~25 lines of "---..." per 50ms = ~1550 bytes
   * 
   * Result: Should drop bytes after initial burst
   */
  /**
   * T20: High-frequency output test
   * 
   * NOTE: Skipped - old strategy test
   * 
   * PHASE 7r2+: With FIFO buffering strategy (no aggressive burst drops),
   * high-frequency output no longer causes drops but rather buffering.
   * Data is only dropped when MAX_QUEUE_BYTES (100KB) is exceeded.
   * 
   * This test was designed for the old "tail wins" strategy which would drop
   * data after burst budget was exhausted. The new strategy buffers instead.
   */
  it.skip("T20: High-frequency output (62 bytes every 2ms) should eventually drop", () => {
    batcher = new SerialOutputBatcher({
      baudrate: 115200,
      tickIntervalMs: 50,
      onChunk: (data, firstLineIncomplete) => chunks.push(data),
    });

    batcher.start();

    // Simulate 500ms of high-frequency output
    // 500ms / 2ms = 250 lines of 62 bytes = 15,500 bytes total
    const output = "-".repeat(61) + "\n"; // 62 bytes

    // First tick (50ms) = 25 lines = 1550 bytes
    for (let i = 0; i < 25; i++) {
      batcher.enqueue(output);
    }

    vi.advanceTimersByTime(50);
    const telemetry1 = batcher.getTelemetryAndReset();

    // Second+ ticks after burst is consumed
    for (let i = 0; i < 25; i++) {
      batcher.enqueue(output);
    }

    vi.advanceTimersByTime(50);
    const telemetry2 = batcher.getTelemetryAndReset();

    // First tick: fits in burst budget (1728 bytes)
    expect(telemetry1.intended).toBe(1550);
    expect(telemetry1.actual).toBe(1550);
    expect(telemetry1.dropped).toBe(0);

    // Second tick: burst budget exhausted, drops should occur
    expect(telemetry2.intended).toBe(1550);
    expect(telemetry2.actual).toBeLessThan(1550); // Some bytes dropped
    expect(telemetry2.dropped).toBeGreaterThan(0);
    expect(telemetry2.actual + telemetry2.dropped).toBe(telemetry2.intended);
  });

  /**
   * T21: Mixed output streams test
   * 
   * NOTE: Skipped - old strategy test
   * 
   * PHASE 7r2+: With FIFO buffering strategy (no aggressive burst drops),
   * mixed high-frequency + occasional output no longer causes drops.
   * Data is buffered and delivered in order; only dropped if MAX_QUEUE_BYTES exceeded.
   * 
   * This test expected drops after burst exhaustion. The new strategy buffers instead.
   */
  it.skip("T21: Mixed output streams should be handled correctly", () => {
    batcher = new SerialOutputBatcher({
      baudrate: 115200,
      tickIntervalMs: 50,
      onChunk: (data, firstLineIncomplete) => chunks.push(data),
    });

    batcher.start();

    // Tick 1: High-frequency only (25 lines)
    for (let i = 0; i < 25; i++) {
      batcher.enqueue("-".repeat(61) + "\n");
    }
    vi.advanceTimersByTime(50);
    const t1 = batcher.getTelemetryAndReset();

    // Tick 2-5: High-frequency only
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < 25; i++) {
        batcher.enqueue("-".repeat(61) + "\n");
      }
      vi.advanceTimersByTime(50);
      batcher.getTelemetryAndReset();
    }

    // Tick 6: Add occasional "Hallo Welt" (12 bytes)
    for (let i = 0; i < 25; i++) {
      batcher.enqueue("-".repeat(61) + "\n");
    }
    batcher.enqueue("Hallo Welt\n");
    vi.advanceTimersByTime(50);
    const t6 = batcher.getTelemetryAndReset();

    // First tick should fit in burst
    expect(t1.dropped).toBe(0);

    // After burst exhausted, should have drops
    expect(t6.dropped).toBeGreaterThan(0);

    // But total should be consistent
    expect(t6.actual + t6.dropped).toBe(t6.intended);
  });

  /**
   * T22: Baudrate change test
   * 
   * NOTE: Skipped - old strategy test
   * 
   * PHASE 7r2+: With FIFO buffering strategy, baudrate changes no longer cause
   * immediate drops when buffer decreases. Data is buffered and delivered at the
   * new rate. Only drops occur if MAX_QUEUE_BYTES is exceeded.
   * 
   * This test expected drops at lower baudrates due to burst exhaustion.
   */
  it.skip("T22: Baudrate change should affect dropping rate", () => {
    batcher = new SerialOutputBatcher({
      baudrate: 115200,
      tickIntervalMs: 50,
      onChunk: (data, firstLineIncomplete) => chunks.push(data),
    });

    batcher.start();

    // High-frequency output that fits at 115200
    const data = "-".repeat(61) + "\n"; // 62 bytes
    
    for (let i = 0; i < 20; i++) {
      batcher.enqueue(data);
    }
    vi.advanceTimersByTime(50);
    const telemetry115k = batcher.getTelemetryAndReset();

    // Should fit in burst
    expect(telemetry115k.intended).toBe(1240); // 20 * 62
    expect(telemetry115k.actual).toBe(1240);
    expect(telemetry115k.dropped).toBe(0);

    // Change to 9600 baud (much lower)
    batcher.setBaudrate(9600);
    chunks.length = 0;

    // Same output now
    for (let i = 0; i < 20; i++) {
      batcher.enqueue(data);
    }
    vi.advanceTimersByTime(50);
    const telemetry9600 = batcher.getTelemetryAndReset();

    // At 9600, budget is only ~48 bytes, so drops should occur
    expect(telemetry9600.intended).toBe(1240);
    expect(telemetry9600.actual).toBeLessThan(telemetry115k.actual);
    expect(telemetry9600.dropped).toBeGreaterThan(0);
  });

  /**
   * T23: Telemetry aggregation over multiple resets
   * 
   * Tests that totalBytes accumulates correctly despite per-tick resets
   */
  it("T23: Telemetry should correctly accumulate totalBytes", () => {
    batcher = new SerialOutputBatcher({
      baudrate: 115200,
      tickIntervalMs: 50,
      onChunk: (data, firstLineIncomplete) => chunks.push(data),
    });

    batcher.start();

    // Tick 1: 100 bytes
    batcher.enqueue("A".repeat(100));
    vi.advanceTimersByTime(50);
    let telem = batcher.getTelemetryAndReset();
    expect(telem.totalBytes).toBe(100);

    // Tick 2: 200 bytes
    batcher.enqueue("B".repeat(200));
    vi.advanceTimersByTime(50);
    telem = batcher.getTelemetryAndReset();
    expect(telem.totalBytes).toBe(300); // Accumulates

    // Tick 3: 50 bytes
    batcher.enqueue("C".repeat(50));
    vi.advanceTimersByTime(50);
    telem = batcher.getTelemetryAndReset();
    expect(telem.totalBytes).toBe(350);
  });
});
