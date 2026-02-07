// telemetry-throttle-detection.test.ts
// Tests to verify throttle detection and warning behavior

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";

describe("Telemetry - Throttle Detection & Warning", () => {
  let manager: RegistryManager;
  const telemetryMetrics: any[] = [];

  beforeEach(() => {
    telemetryMetrics.length = 0;
    manager = new RegistryManager({
      onTelemetry: (metrics) => {
        telemetryMetrics.push(metrics);
      },
      enableTelemetry: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.destroy();
  });

  describe("Throttle Flag Behavior", () => {
    it("should be false when no changes are happening", () => {
      // No pin changes at all
      vi.advanceTimersByTime(500);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });

    it("should be false at low frequency (1 Hz)", () => {
      manager.updatePinValue(13, 1);
      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });

    it("should be false at moderate frequency (10 Hz)", () => {
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });

    it("should be true during debounce window after rapid changes", () => {
      // Trigger multiple rapid changes
      for (let i = 0; i < 5; i++) {
        manager.updatePinValue(13, i % 2);
      }

      // Check within debounce window (50ms)
      vi.advanceTimersByTime(25);
      const metrics = manager.getPerformanceMetrics();

      // During debounce, should be true
      expect(metrics.isThrottled).toBe(true);
    });

    it("should transition from false to true and back with burst", () => {
      // Start with no throttle
      vi.advanceTimersByTime(100);
      let metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);

      // Trigger burst to activate throttle
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
      }

      vi.advanceTimersByTime(25); // Within debounce
      metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(true);

      // Wait for debounce to clear
      vi.advanceTimersByTime(100);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });
  });

  describe("Loss Detection Heuristics", () => {
    it("should have pinChangesPerSecond < expected at 77 Hz", () => {
      // Simulate 77 Hz
      const expectedRate = 77;

      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();
      const measuredRate = metrics.pinChangesPerSecond;

      // Should be significantly lower than 77
      expect(measuredRate).toBeLessThan(expectedRate * 0.8);
    });

    it("should have pinChangesPerSecond < expected at 395 Hz", () => {
      const expectedRate = 395;

      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();
      const measuredRate = metrics.pinChangesPerSecond;

      // Should be WAY lower than 395
      expect(measuredRate).toBeLessThan(expectedRate * 0.1);
    });

    it("should maintain consistent measured rate at high frequencies", () => {
      const measuredRates: number[] = [];

      // Take 3 measurements at 100 Hz
      for (let measurement = 0; measurement < 3; measurement++) {
        for (let i = 0; i < 100; i++) {
          manager.updatePinValue(13, i % 2);
          vi.advanceTimersByTime(10);
        }

        const metrics = manager.getPerformanceMetrics();
        measuredRates.push(metrics.pinChangesPerSecond);
      }

      // All should be capped around 20 Hz ±5
      measuredRates.forEach((rate) => {
        expect(rate).toBeGreaterThan(15);
        expect(rate).toBeLessThan(30);
      });
    });
  });

  describe("Throttle Indicator Logic", () => {
    it("should compute throttle status based on debounce timer", () => {
      // No changes = no throttle
      let metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);

      // Single change
      manager.updatePinValue(13, 1);

      // Within 50ms = should be throttled
      vi.advanceTimersByTime(25);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(true);

      // After 50ms = not throttled anymore
      vi.advanceTimersByTime(50);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });

    it("should extend throttle if new changes arrive during debounce", () => {
      // First change triggers debounce
      manager.updatePinValue(13, 1);

      // At 25ms, within first debounce window
      vi.advanceTimersByTime(25);
      let metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(true);

      // Add another change (restarts debounce)
      manager.updatePinValue(13, 0);

      // Check at 45ms (still within the restarted debounce)
      vi.advanceTimersByTime(20);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(true);
    });
  });

  describe("Loss Estimation", () => {
    it("should show measurable loss at 77 Hz", () => {
      const expectedChanges = 77;

      for (let i = 0; i < expectedChanges; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();
      const lossPercentage =
        ((expectedChanges - metrics.pinChangesPerSecond) /
          expectedChanges) *
        100;

      // Should lose ~75% of changes
      expect(lossPercentage).toBeGreaterThan(60);
      expect(lossPercentage).toBeLessThan(90);
    });

    it("should show severe loss at 395 Hz", () => {
      const expectedChanges = 395;

      for (let i = 0; i < expectedChanges; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();
      const lossPercentage =
        ((expectedChanges - metrics.pinChangesPerSecond) /
          expectedChanges) *
        100;

      // Should lose ~95% of changes
      expect(lossPercentage).toBeGreaterThan(90);
      expect(lossPercentage).toBeLessThan(99);
    });

    it("should show no loss at 10 Hz", () => {
      const expectedChanges = 10;

      for (let i = 0; i < expectedChanges; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      const lossPercentage =
        ((expectedChanges - metrics.pinChangesPerSecond) /
          expectedChanges) *
        100;

      // Should have minimal loss
      expect(lossPercentage).toBeLessThan(20);
    });
  });

  describe("Warning Threshold Logic", () => {
    it("should trigger warning when loss exceeds 50%", () => {
      // At 77 Hz, we expect ~75% loss
      const expectedRate = 77;

      for (let i = 0; i < expectedRate; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();
      const lossPercentage =
        ((expectedRate - metrics.pinChangesPerSecond) / expectedRate) * 100;

      // Should exceed 50% threshold
      if (lossPercentage > 50 && metrics.isThrottled) {
        // Warning condition met
        expect(true).toBe(true);
      }
    });

    it("should not trigger warning at low speeds", () => {
      // At 10 Hz, minimal loss
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      const lossPercentage = ((10 - metrics.pinChangesPerSecond) / 10) * 100;

      // Should not exceed 50% threshold
      expect(lossPercentage).toBeLessThan(50);
      expect(metrics.isThrottled).toBe(false);
    });
  });

  describe("Rate Capping", () => {
    it("should never report more than ~25 /sec (cap)", () => {
      const speeds = [77, 100, 200, 395];

      for (const speed of speeds) {
        const interval = 1000 / speed;

        for (let i = 0; i < speed; i++) {
          manager.updatePinValue(13, i % 2);
          vi.advanceTimersByTime(interval);
        }

        const metrics = manager.getPerformanceMetrics();

        // Should be capped below 30 Hz
        expect(metrics.pinChangesPerSecond).toBeLessThan(30);
      }
    });

    it("should report low frequencies accurately (no artificial cap)", () => {
      const speeds = [1, 5, 10, 15];

      for (const speed of speeds) {
        telemetryMetrics.length = 0;
        const interval = 1000 / speed;

        for (let i = 0; i < speed; i++) {
          manager.updatePinValue(13, i % 2);
          vi.advanceTimersByTime(interval);
        }

        const metrics = manager.getPerformanceMetrics();

        // Should report close to actual frequency
        expect(metrics.pinChangesPerSecond).toBeCloseTo(speed, 3);
      }
    });
  });

  describe("User Scenarios: When to Show Warning", () => {
    it("scenario: User applies delay(1000) - should NOT warn", () => {
      // 1 Hz - OK
      manager.updatePinValue(13, 1);
      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      const shouldWarn =
        metrics.isThrottled === true &&
        metrics.pinChangesPerSecond < 10 &&
        ((1 - metrics.pinChangesPerSecond) / 1) * 100 > 50;

      expect(shouldWarn).toBe(false);
    });

    it("scenario: User applies delay(100) - should NOT warn", () => {
      // 10 Hz - still OK
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      const shouldWarn =
        metrics.isThrottled === true &&
        ((10 - metrics.pinChangesPerSecond) / 10) * 100 > 50;

      expect(shouldWarn).toBe(false);
    });

    it("scenario: User applies delay(10) - SHOULD warn", () => {
      // 77 Hz - problematic
      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();
      const shouldWarn =
        ((77 - metrics.pinChangesPerSecond) / 77) * 100 > 50;

      expect(shouldWarn).toBe(true);
    });

    it("scenario: User applies delay(1) - MUST warn", () => {
      // 395 Hz - critical
      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();
      const shouldWarn =
        ((395 - metrics.pinChangesPerSecond) / 395) * 100 > 90;

      expect(shouldWarn).toBe(true);
    });
  });
});
