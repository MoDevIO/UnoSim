import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PinStateBatcher } from "../../../server/services/pin-state-batcher";

describe("PinStateBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Test 1.1: Grundlegendes Batching
  it("should batch multiple pin events and send after tick interval", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue 3 events for different pins
    batcher.enqueue(1, "value", 1);
    batcher.enqueue(2, "value", 0);
    batcher.enqueue(3, "pwm", 128);

    // Advance time by 50ms to trigger tick
    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(3);
    expect(batches[0].states).toEqual(
      expect.arrayContaining([
        { pin: 1, stateType: "value", value: 1 },
        { pin: 2, stateType: "value", value: 0 },
        { pin: 3, stateType: "pwm", value: 128 },
      ])
    );
    expect(batches[0].timestamp).toBeDefined();

    batcher.destroy();
  });

  // Test 1.2: Letzter-Wert-Gewinnt (Deduplizierung)
  it("should only keep last value for same pin:stateType combination", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue multiple values for same pin
    batcher.enqueue(13, "value", 1);
    batcher.enqueue(13, "value", 0);
    batcher.enqueue(13, "value", 1);
    batcher.enqueue(13, "value", 0);

    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(1);
    expect(batches[0].states[0]).toEqual({
      pin: 13,
      stateType: "value",
      value: 0,
    });

    batcher.destroy();
  });

  // Test 1.3: Verschiedene stateTypes nicht dedupliziert
  it("should not deduplicate different stateTypes for same pin", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    batcher.enqueue(13, "value", 1);
    batcher.enqueue(13, "mode", 1);

    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(2);
    expect(batches[0].states).toEqual(
      expect.arrayContaining([
        { pin: 13, stateType: "value", value: 1 },
        { pin: 13, stateType: "mode", value: 1 },
      ])
    );

    batcher.destroy();
  });

  // Test 1.4: Kein Tick bei leerer Queue
  it("should not call onBatch when no events are pending", () => {
    const onBatch = vi.fn();
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch,
    });

    batcher.start();

    // Advance time without enqueuing any events
    vi.advanceTimersByTime(50);

    expect(onBatch).not.toHaveBeenCalled();

    batcher.destroy();
  });

  // Test 1.5: Telemetrie-Zählung
  it("should track intended and actual pin changes correctly", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue 10 events (4 duplicates on same pin:stateType)
    batcher.enqueue(1, "value", 1); // unique
    batcher.enqueue(1, "value", 0); // overwrite
    batcher.enqueue(2, "value", 1); // unique
    batcher.enqueue(2, "value", 0); // overwrite
    batcher.enqueue(3, "value", 1); // unique
    batcher.enqueue(4, "value", 1); // unique
    batcher.enqueue(5, "value", 1); // unique
    batcher.enqueue(6, "value", 1); // unique
    batcher.enqueue(1, "mode", 1); // unique (different stateType)
    batcher.enqueue(1, "value", 1); // overwrite again

    vi.advanceTimersByTime(50);

    const telemetry = batcher.getTelemetryAndReset();
    expect(telemetry.intended).toBe(10);
    expect(telemetry.actual).toBe(7); // 6 unique value + 1 mode

    // After reset, counters should be zero
    const telemetry2 = batcher.getTelemetryAndReset();
    expect(telemetry2.intended).toBe(0);
    expect(telemetry2.actual).toBe(0);

    batcher.destroy();
  });

  // Test 1.6: Pause/Resume
  it("should pause and resume batching correctly", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue some events
    batcher.enqueue(1, "value", 1);
    batcher.enqueue(2, "value", 0);

    // Pause before tick
    batcher.pause();

    // Advance time - should not send batch
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(0);

    // Resume
    batcher.resume();

    // Advance time again - should send the buffered events
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(2);

    batcher.destroy();
  });

  // Test 1.7: Stop flusht pending Events
  it("should flush pending events when stopped", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // Enqueue 5 events
    batcher.enqueue(1, "value", 1);
    batcher.enqueue(2, "value", 0);
    batcher.enqueue(3, "value", 1);
    batcher.enqueue(4, "value", 0);
    batcher.enqueue(5, "value", 1);

    // Stop before tick - should flush immediately
    batcher.stop();

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(5);

    // No more batches after stop
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
  });

  // Test 1.8: Destroy räumt auf
  it("should clean up when destroyed", () => {
    const onBatch = vi.fn();
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch,
    });

    batcher.start();

    batcher.enqueue(1, "value", 1);

    // Destroy without flushing
    batcher.destroy();

    // Advance time - no callback should be called
    vi.advanceTimersByTime(50);
    expect(onBatch).not.toHaveBeenCalled();
  });

  // Test 1.9: Multi-Pin Szenario (20 Pins)
  it("should handle 20 pins with multiple changes efficiently", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // 20 pins × 5 changes each = 100 events
    for (let pin = 0; pin < 20; pin++) {
      for (let i = 0; i < 5; i++) {
        batcher.enqueue(pin, "value", i % 2);
      }
    }

    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(20); // Only 20 unique pin:stateType

    const telemetry = batcher.getTelemetryAndReset();
    expect(telemetry.intended).toBe(100);
    expect(telemetry.actual).toBe(20);

    batcher.destroy();
  });

  // Test 1.10: Schnelle sequentielle Ticks
  it("should handle sequential ticks correctly", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // First tick events
    batcher.enqueue(1, "value", 1);
    batcher.enqueue(2, "value", 1);
    batcher.enqueue(3, "value", 1);
    batcher.enqueue(4, "value", 1);
    batcher.enqueue(5, "value", 1);

    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(1);
    expect(batches[0].states).toHaveLength(5);

    // Second tick events
    batcher.enqueue(6, "value", 1);
    batcher.enqueue(7, "value", 1);
    batcher.enqueue(8, "value", 1);

    vi.advanceTimersByTime(50);

    expect(batches).toHaveLength(2);
    expect(batches[1].states).toHaveLength(3);

    // Verify no crosstalk between ticks
    const allPinsInBatch1 = batches[0].states.map((s: any) => s.pin);
    const allPinsInBatch2 = batches[1].states.map((s: any) => s.pin);

    expect(allPinsInBatch1).toEqual([1, 2, 3, 4, 5]);
    expect(allPinsInBatch2).toEqual([6, 7, 8]);

    batcher.destroy();
  });
});
