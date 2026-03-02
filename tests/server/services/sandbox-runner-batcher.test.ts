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
   * NOTE: T20, T21, T22 were removed - they tested the old "tail wins" drop strategy.
   * The current FIFO buffering strategy (PHASE 7r2+) is validated in:
   * - tests/server/services/sandbox-performance.test.ts
   * - tests/integration/serial-flow.test.ts
   */


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
