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

  // Test 10: getTelemetryAndReset with batchCount
  it("should track and reset batchCount in getTelemetryAndReset", () => {
    const batches: any[] = [];
    const batcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch) => batches.push(batch),
    });

    batcher.start();

    // First tick: 5 events
    batcher.enqueue(1, "value", 1);
    batcher.enqueue(2, "value", 0);
    batcher.enqueue(3, "value", 1);
    batcher.enqueue(4, "value", 0);
    batcher.enqueue(5, "value", 1);

    vi.advanceTimersByTime(50);

    // Second tick: 3 events
    batcher.enqueue(6, "value", 1);
    batcher.enqueue(7, "value", 0);
    batcher.enqueue(8, "value", 1);

    vi.advanceTimersByTime(50);

    // Get telemetry: should have 2 batches, 8 total events (5 + 3)
    const telemetry = batcher.getTelemetryAndReset();

    expect(telemetry.intended).toBe(8);
    expect(telemetry.actual).toBe(8); // No deduplication in this test
    expect(telemetry.batches).toBe(2); // Two flushes occurred

    // After reset, counters should be 0
    const telemetry2 = batcher.getTelemetryAndReset();
    expect(telemetry2.intended).toBe(0);
    expect(telemetry2.actual).toBe(0);
    expect(telemetry2.batches).toBe(0);

    batcher.destroy();
  });

  // Test 2.1: Correct Dropping & Batching Under High Toggle Frequency
  describe("High-Frequency Toggle Scenarios (Dropping & Batching Validation)", () => {
    it("should correctly drop and batch when one pin toggles 100 times in single tick", () => {
      const batches: any[] = [];
      const batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Pin 0: toggle 100 times (0 → 1 → 0 → 1 → ... → 0)
      // Final value should be 0 (100 is even, so final is 0)
      for (let i = 0; i < 100; i++) {
        batcher.enqueue(0, "value", i % 2);
      }

      // Pin 1: set once
      batcher.enqueue(1, "value", 1);

      // Advance time to trigger one tick
      vi.advanceTimersByTime(50);

      // Verify: should have exactly 1 batch with 2 pins
      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(2);

      // Verify pin states
      const pin0State = batches[0].states.find((s: any) => s.pin === 0);
      const pin1State = batches[0].states.find((s: any) => s.pin === 1);

      expect(pin0State).toBeDefined();
      expect(pin1State).toBeDefined();

      // Sampling: Pin 0 should have final value (1, because iteration 0-99 ends at 99 % 2 = 1)
      expect(pin0State.value).toBe(1);
      expect(pin1State.value).toBe(1);

      // Dropping: Telemetry should show 99 dropped for Pin 0 + 1 for Pin 1 = 100 intended, 2 actual
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(101); // 100 toggles for pin 0 + 1 for pin 1
      expect(telemetry.actual).toBe(2); // 2 unique pin:stateType entries
      // Dropped should be: 101 intended - 2 actual = 99
      const dropped = telemetry.intended - telemetry.actual;
      expect(dropped).toBe(99);

      batcher.destroy();
    });

    it("should correctly report droppedPinChanges when one pin toggles at extreme frequency", () => {
      const batches: any[] = [];
      const batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Simulate extreme frequency: Pin 2 toggles 500 times in one tick
      for (let i = 0; i < 500; i++) {
        batcher.enqueue(2, "value", i % 2);
      }

      // Pin 3 and Pin 4 each change once
      batcher.enqueue(3, "value", 1);
      batcher.enqueue(4, "pwm", 128);

      vi.advanceTimersByTime(50);

      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(3);

      // Final state for Pin 2 should be 1 (iteration 0-499 ends at 499 % 2 = 1)
      const pin2State = batches[0].states.find((s: any) => s.pin === 2);
      expect(pin2State.value).toBe(1);

      // Telemetry: 500 + 1 + 1 = 502 intended, 3 actual
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(502);
      expect(telemetry.actual).toBe(3);
      expect(telemetry.intended - telemetry.actual).toBe(499); // 499 dropped
    });

    it("should batch multiple high-frequency pins correctly, keeping only final states", () => {
      const batches: any[] = [];
      const batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Two pins, each toggled multiple times
      // Pin 5: 50 toggles → final value: 0 (50 is even)
      for (let i = 0; i < 50; i++) {
        batcher.enqueue(5, "value", i % 2);
      }

      // Pin 6: 75 toggles → final value: 1 (75 is odd)
      for (let i = 0; i < 75; i++) {
        batcher.enqueue(6, "value", i % 2);
      }

      // Pin 7: static value set, no toggles
      batcher.enqueue(7, "mode", 1);

      vi.advanceTimersByTime(50);

      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(3);

      // Verify final values
      const pin5 = batches[0].states.find((s: any) => s.pin === 5);
      const pin6 = batches[0].states.find((s: any) => s.pin === 6);
      const pin7 = batches[0].states.find((s: any) => s.pin === 7);

      expect(pin5.value).toBe(1); // iteration 0-49 ends at 49 % 2 = 1
      expect(pin6.value).toBe(0); // iteration 0-74 ends at 74 % 2 = 0
      expect(pin7.value).toBe(1);

      // Telemetry: 50 + 75 + 1 = 126 intended, 3 actual
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(126);
      expect(telemetry.actual).toBe(3);
      expect(telemetry.batches).toBe(1);
    });

    it("should maintain correct batch array length reflecting unique pin:stateType entries", () => {
      const batches: any[] = [];
      const batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // High frequency on single pin with multiple state types
      // Pin 10: value state
      for (let i = 0; i < 200; i++) {
        batcher.enqueue(10, "value", i % 2);
      }

      // Pin 10: mode state (different from value, should not be deduplicated)
      for (let i = 0; i < 50; i++) {
        batcher.enqueue(10, "mode", i % 2);
      }

      // Pin 10: pwm state
      batcher.enqueue(10, "pwm", 100);
      batcher.enqueue(10, "pwm", 150);
      batcher.enqueue(10, "pwm", 200);

      vi.advanceTimersByTime(50);

      expect(batches).toHaveLength(1);
      // Should have 3 entries for Pin 10 (value, mode, pwm)
      const pin10States = batches[0].states.filter((s: any) => s.pin === 10);
      expect(pin10States).toHaveLength(3);

      // Verify final values
      const valueState = pin10States.find((s: any) => s.stateType === "value");
      const modeState = pin10States.find((s: any) => s.stateType === "mode");
      const pwmState = pin10States.find((s: any) => s.stateType === "pwm");

      expect(valueState.value).toBe(1); // iteration 0-199 ends at 199 % 2 = 1
      expect(modeState.value).toBe(1); // iteration 0-49 ends at 49 % 2 = 1
      expect(pwmState.value).toBe(200); // last value

      // Telemetry: 200 + 50 + 3 = 253 intended, 3 actual (all same pin, different stateTypes)
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(253);
      expect(telemetry.actual).toBe(3);
    });
  });
});
