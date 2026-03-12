/**
 * Integration Test: Telemetry Consistency Under Aggressive Pin Sampling
 * 
 * Validates that telemetry metrics correctly report dropped vs. actual pin changes
 * when batching/sampling occurs, ensuring the backend safety net is reliable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PinStateBatcher } from "../../server/services/pin-state-batcher";
import { RegistryManager } from "../../server/services/registry-manager";

describe("Integration: Batching Safety Net Under Aggressive Sampling", () => {
  let registryManager: RegistryManager;
  let batcher: PinStateBatcher;
  
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));
    
    registryManager = new RegistryManager({
      enableTelemetry: true,
      onTelemetry: () => {}, // Discard telemetry for this test
    });
    registryManager.pauseTelemetry(); // Prevent heartbeat interference
  });

  afterEach(() => {
    if (batcher) {
      batcher.destroy();
    }
    registryManager.destroy();
    vi.useRealTimers();
  });

  describe("Batching Consolidates High-Frequency Updates", () => {
    it("should consolidate 1000 pin changes into 1 batch with correct telemetry", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // Simulate 1000 rapid changes to a single pin (pin 0)
      for (let i = 0; i < 1000; i++) {
        batcher.enqueue(0, "value", i % 2);
      }

      vi.advanceTimersByTime(50);

      // Should have exactly 1 batch
      expect(batches).toHaveLength(1);

      // Batch should contain exactly 1 state entry
      expect(batches[0].states).toHaveLength(1);
      
      // Final value should be 1 (iteration 0-999 ends at 999 % 2 = 1)
      expect(batches[0].states[0]).toEqual({
        pin: 0,
        stateType: "value",
        value: 1,
      });

      // Telemetry shows dropping
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(1000);
      expect(telemetry.actual).toBe(1);
      expect(telemetry.batches).toBe(1);
      
      // Verify the safety net: droppedPinChanges = intended - actual
      const dropped = telemetry.intended - telemetry.actual;
      expect(dropped).toBe(999);
    });

    it("should correctly report metrics when multiple pins have different update frequencies", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // Pin 0: toggles 500 times → final value 0
      for (let i = 0; i < 500; i++) {
        batcher.enqueue(0, "value", i % 2);
      }

      // Pin 1: toggles 300 times → final value 0
      for (let i = 0; i < 300; i++) {
        batcher.enqueue(1, "value", i % 2);
      }

      // Pin 2: static, changed once → value 1
      batcher.enqueue(2, "value", 1);

      vi.advanceTimersByTime(50);

      // One batch with 3 pin states
      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(3);

      // Retrieve telemetry
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(801); // 500 + 300 + 1
      expect(telemetry.actual).toBe(3); // 3 unique pin states
      
      // Verify batching and dropping
      const avgStatesPerBatch = telemetry.actual / telemetry.batches;
      expect(avgStatesPerBatch).toBe(3); // All states in 1 batch
      
      const droppedRate = (telemetry.intended - telemetry.actual) / telemetry.intended;
      expect(droppedRate).toBeGreaterThan(0.99); // >99% dropped (expected for high frequency)
    });

    it("should correctly consolidate state and telemetry across consecutive ticks", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // First tick: Pin 0 toggles 100 times, Pin 1 set once
      for (let i = 0; i < 100; i++) {
        batcher.enqueue(0, "value", i % 2);
      }
      batcher.enqueue(1, "value", 1);

      vi.advanceTimersByTime(50);

      // Second tick: Pin 0 toggles 50 times, Pin 2 set to 0
      for (let i = 0; i < 50; i++) {
        batcher.enqueue(0, "value", i % 2);
      }
      batcher.enqueue(2, "value", 0);

      vi.advanceTimersByTime(50);

      // Should have 2 batches
      expect(batches).toHaveLength(2);

      // First batch: 2 states (pin 0, pin 1)
      expect(batches[0].states).toHaveLength(2);
      
      // Second batch: 2 states (pin 0, pin 2)
      expect(batches[1].states).toHaveLength(2);

      // Telemetry aggregates both ticks
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(152); // 100 + 1 + 50 + 1 (101 + 51)
      expect(telemetry.actual).toBe(4); // 2 in first tick + 2 in second tick (Pin 0 appears twice)
      expect(telemetry.batches).toBe(2);
    });

    it("should maintain batch array size and telemetry consistency with PWM-like patterns", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // Simulate PWM: dynamic value changes
      // Pin 3 (PWM): rapid value transitions 0→255
      for (let val = 0; val <= 255; val++) {
        batcher.enqueue(3, "pwm", val);
      }

      // Pin 4 (PWM): rapid value transitions 255→0
      for (let val = 255; val >= 0; val--) {
        batcher.enqueue(4, "pwm", val);
      }

      vi.advanceTimersByTime(50);

      // One batch with 2 PWM states
      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(2);

      // Check PWM final values
      const pin3 = batches[0].states.find((s: any) => s.pin === 3);
      const pin4 = batches[0].states.find((s: any) => s.pin === 4);

      expect(pin3.value).toBe(255); // Last set value
      expect(pin4.value).toBe(0);   // Last set value

      // Telemetry: 256 + 256 = 512 intended, 2 actual
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(512);
      expect(telemetry.actual).toBe(2);
    });
  });

  describe("Telemetry Safety Net for Frontend Waterflow Control", () => {
    it("should provide accurate dropped count that enables frontend throttling decisions", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // Simulate a high pin change storm
      const numPins = 20;
      const changesPerPin = 50;

      for (let pinNum = 0; pinNum < numPins; pinNum++) {
        for (let change = 0; change < changesPerPin; change++) {
          batcher.enqueue(pinNum, "value", change % 2);
        }
      }

      vi.advanceTimersByTime(50);

      // One batch with 20 unique pins
      expect(batches).toHaveLength(1);
      expect(batches[0].states).toHaveLength(numPins);

      // Telemetry shows the safety net
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(numPins * changesPerPin);
      expect(telemetry.actual).toBe(numPins);

      // Frontend can use this to detect overage:
      const dropRatio = telemetry.intended / telemetry.actual;
      expect(dropRatio).toBe(changesPerPin);
      
      // If dropRatio > threshold, frontend knows to warn user or reduce update frequency
      const overloadThreshold = 10;
      const isOverloaded = dropRatio > overloadThreshold;
      expect(isOverloaded).toBe(true);
    });

    it("should track batches-per-second metric for UI load assessment", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();
      registryManager.setPinStateBatcher(batcher);

      // Simulate 3 seconds of activity at 20 batches/sec (50ms intervals)
      for (let tick = 0; tick < 60; tick++) {
        // Each tick generates one batch (if there are events)
        for (let pin = 0; pin < 5; pin++) {
          batcher.enqueue(pin, "value", tick % 2);
        }
        vi.advanceTimersByTime(50);
      }

      // Should have ~59 batches (first tick might be lost due to timing)
      expect(batches.length).toBeGreaterThanOrEqual(50);
      expect(batches.length).toBeLessThanOrEqual(60);

      // Telemetry tells us the batch rate
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.batches).toBeGreaterThanOrEqual(50);

      // Calculate batches per second (batches / 3 seconds ≈ 20)
      const batchesPerSecond = telemetry.batches / 3;
      expect(batchesPerSecond).toBeGreaterThan(15); // At least 15 batches/sec
      expect(batchesPerSecond).toBeLessThan(25); // At most 25 batches/sec
    });

    it("should verify that consolidated batch reduces frontend message count proportionally to drop rate", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Generate a scenario where:
      // - Pin 0-4: each changes 100 times → 500 total intended
      // - Should result in 1 batch with 5 states
      // - Frontend receives 1 message instead of 500 messages
      
      for (let pin = 0; pin < 5; pin++) {
        for (let change = 0; change < 100; change++) {
          batcher.enqueue(pin, "value", change % 2);
        }
      }

      vi.advanceTimersByTime(50);

      const telemetry = batcher.getTelemetryAndReset();
      
      // Safety net calculation
      const messageReductionFactor = telemetry.intended / telemetry.actual;
      expect(messageReductionFactor).toBe(100); // 500 intended / 5 actual

      // This means: without batching, frontend would receive 500 messages
      // With batching, it receives 1 message (plus the batch metadata)
      // Reduction: 500x fewer messages
      
      expect(messageReductionFactor).toBeGreaterThan(50);
      
      const bandwidthSavingsPercent = (1 - (1 / messageReductionFactor)) * 100;
      expect(bandwidthSavingsPercent).toBeGreaterThanOrEqual(99); // >=99% reduction
    });
  });

  describe("Frontend UI State Consistency Validation", () => {
    it("should ensure final UI state matches last enqueued value despite dropped changes", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Scenario: Pin 10 ends at HIGH after 1000 toggles
      for (let i = 0; i < 1000; i++) {
        batcher.enqueue(10, "value", i % 2);
      }
      // Explicitly ensure last value is HIGH
      batcher.enqueue(10, "value", 1);

      vi.advanceTimersByTime(50);

      const batch = batches[0];
      const pin10State = batch.states.find((s: any) => s.pin === 10);

      // Frontend receives: pin 10 is HIGH
      expect(pin10State.value).toBe(1);

      // Telemetry shows: 1001 intended, 1 actual
      // But the UI shows the correct final state!
      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(1001);
      expect(telemetry.actual).toBe(1);
    });

    it("should verify batch consolidation preserves causal ordering (last write wins)", () => {
      const batches: any[] = [];
      batcher = new PinStateBatcher({
        tickIntervalMs: 50,
        onBatch: (batch) => batches.push(batch),
      });

      batcher.start();

      // Pin 20: 1→0→1→0→1 (5 changes, last is 1)
      batcher.enqueue(20, "value", 0);
      batcher.enqueue(20, "value", 1);
      batcher.enqueue(20, "value", 0);
      batcher.enqueue(20, "value", 1);
      batcher.enqueue(20, "value", 0);
      batcher.enqueue(20, "value", 1);

      vi.advanceTimersByTime(50);

      const pin20 = batches[0].states.find((s: any) => s.pin === 20);
      expect(pin20.value).toBe(1); // Last value

      const telemetry = batcher.getTelemetryAndReset();
      expect(telemetry.intended).toBe(6);
      expect(telemetry.actual).toBe(1);
      
      // The UI shows the correct state despite 5 intermediate drops
      expect(pin20.value).toBe(1);
    });
  });
});
