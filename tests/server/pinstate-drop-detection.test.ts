import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinStateBatcher } from "../../server/services/pin-state-batcher";

describe("PinStateBatcher - dropped pin state detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("should accurately count intended vs actual pin state changes", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 10,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue 50 pin state changes rapidly
    for (let i = 0; i < 50; i++) {
      batcher.enqueue(13, "value", i % 2);
    }

    vi.advanceTimersByTime(10);
    batcher.stop();

    // Get telemetry
    const telemetry = batcher.getTelemetryAndReset();
    const totalActualStates = batches
      .flat()
      .reduce((sum, batch) => sum + batch.states.length, 0);

    console.log(`
      ✓ Intended pin changes: ${telemetry.intended}
      ✓ Actual pin changes: ${telemetry.actual}
      ✓ Dropped: ${telemetry.intended - telemetry.actual} (${(((telemetry.intended - telemetry.actual) / telemetry.intended) * 100).toFixed(1)}%)
      ✓ Batches: ${telemetry.batches}
    `);

    // Verify accuracy
    expect(telemetry.intended).toBe(50);
    expect(telemetry.actual).toBeLessThanOrEqual(telemetry.intended);
    expect(telemetry.actual).toBeGreaterThan(0); // At least some should make it
    expect(telemetry.batches).toBeGreaterThan(0);

    // Verify total actual matches sum of batch contents
    expect(totalActualStates).toBe(telemetry.actual);

    batcher.destroy();
  });

  it("should show correct drop rate with high-frequency changes", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50, // 50ms batches = 20 batches/sec
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Simulate high-frequency changes (enqueue rapidly)
    for (let i = 0; i < 100; i++) {
      for (let pin = 12; pin <= 13; pin++) {
        batcher.enqueue(pin, "value", i % 2);
      }
    }

    vi.advanceTimersByTime(50);
    batcher.stop();

    const telemetry = batcher.getTelemetryAndReset();
    const dropRate =
      telemetry.intended > 0
        ? (1 - telemetry.actual / telemetry.intended) * 100
        : 0;

    console.log(`
      ✓ High-frequency test (200 intended changes):
      ✓ Intended: ${telemetry.intended}
      ✓ Actual: ${telemetry.actual}
      ✓ Drop rate: ${dropRate.toFixed(1)}%
      ✓ Batches: ${telemetry.batches}
    `);

    // With high frequency, there SHOULD be drops due to "last value wins"
    // But we'll just verify counts match between telemetry and batches
    const totalActualStates = batches.reduce(
      (sum, batch) => sum + batch.states.length,
      0,
    );
    expect(telemetry.actual).toBe(totalActualStates);
    expect(telemetry.intended).toBe(200);
    expect(telemetry.actual).toBe(2);

    console.log(
      `✅ Drop detection working - intended=${telemetry.intended}, actual=${telemetry.actual}`,
    );

    batcher.destroy();
  });

  it("should show minimal drops when enqueuing with delay between changes", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Slowly enqueue changes with delay between them
    for (let i = 0; i < 3; i++) {
      batcher.enqueue(13, "value", i % 2);
      vi.advanceTimersByTime(50);
    }

    batcher.stop();

    const telemetry = batcher.getTelemetryAndReset();

    console.log(`
      ✓ Low-frequency test (3 changes with delays):
      ✓ Intended: ${telemetry.intended}
      ✓ Actual: ${telemetry.actual}
      ✓ Drop rate: ${telemetry.intended > 0 ? ((1 - telemetry.actual / telemetry.intended) * 100).toFixed(1) : 0}%
    `);

    // With delays, all or nearly all should get through
    expect(telemetry.intended).toBe(3);
    expect(telemetry.actual).toBe(3);
    expect(telemetry.batches).toBe(3);

    console.log(`✅ Minimal drops with low-frequency changes`);

    batcher.destroy();
  });

  it("should verify duplicate key behavior (last value wins)", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 20,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue same pin with different values (last wins)
    batcher.enqueue(13, "value", 0);
    batcher.enqueue(13, "value", 1);
    batcher.enqueue(13, "value", 0);
    batcher.enqueue(13, "value", 1); // Last value
    batcher.enqueue(13, "value", 1); // Duplicate last value
    batcher.enqueue(13, "value", 1); // Another duplicate

    vi.advanceTimersByTime(20);
    batcher.stop();

    const telemetry = batcher.getTelemetryAndReset();

    console.log(
      `
      ✓ Duplicate key test:
      ✓ Intended changes: ${telemetry.intended}
      ✓ Actual changes: ${telemetry.actual}
      ✓ Batches: ${telemetry.batches}
      ✓ Final value in batch:`,
      batches[0]?.states[0]?.value,
    );

    // All 6 enqueues counted as intended
    expect(telemetry.intended).toBe(6);
    // But only 1 (last value) should be in batch
    expect(telemetry.actual).toBe(1);
    // Final value should be 1
    expect(batches[0]?.states[0]?.value).toBe(1);

    console.log(`✅ Last-value-wins deduplication working correctly`);

    batcher.destroy();
  });
});
