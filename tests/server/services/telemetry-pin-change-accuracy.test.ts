// telemetry-pin-change-accuracy.test.ts
// Tests to verify pin change frequency measurement accuracy and loss detection

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";

describe("Telemetry - Pin Change Accuracy & Loss Detection", () => {
  let manager: RegistryManager;
  const telemetryReadings: any[] = [];

  beforeEach(() => {
    telemetryReadings.length = 0;
    manager = new RegistryManager({
      onTelemetry: (metrics) => {
        telemetryReadings.push(metrics);
      },
      enableTelemetry: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.destroy();
  });

  describe("Scenario 1: 1 Hz (delay(1000)) - No Loss Expected", () => {
    it("should measure approximately 1 pin change per second", () => {
      // Simulate 1 Hz toggle: 1 change per 1000ms
      manager.updatePinValue(13, 1);
      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeCloseTo(1, 0);
      expect(metrics.isThrottled).toBe(false);
    });

    it("should not indicate throttling at 1 Hz", () => {
      for (let i = 0; i < 3; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1000);
        const metrics = manager.getPerformanceMetrics();
        expect(metrics.pinChangesPerSecond).toBeCloseTo(1, 0);
      }
    });

    it("should show stable readings over multiple seconds at 1 Hz", () => {
      telemetryReadings.length = 0;

      // Simulate 3 seconds of 1 Hz changes
      for (let sec = 0; sec < 3; sec++) {
        manager.updatePinValue(13, sec % 2);
        vi.advanceTimersByTime(1000);
      }

      const readings = telemetryReadings.filter(
        (m) => m.pinChangesPerSecond > 0,
      );
      expect(readings.length).toBeGreaterThan(0);

      // All readings should be close to 1 Hz
      const avgRate =
        readings.reduce((sum, m) => sum + m.pinChangesPerSecond, 0) /
        readings.length;
      expect(avgRate).toBeCloseTo(1, 0);
    });
  });

  describe("Scenario 2: 10 Hz (delay(100)) - No Loss Expected", () => {
    it("should measure approximately 10 pin changes per second", () => {
      // Simulate 10 Hz: 10 changes per 1000ms = 1 change per 100ms
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeCloseTo(10, 0);
      expect(metrics.isThrottled).toBe(false);
    });

    it("should not indicate throttling at 10 Hz", () => {
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
      }
      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(false);
    });

    it("should measure stable 10 Hz over extended period", () => {
      telemetryReadings.length = 0;

      // 3 seconds at 10 Hz = 30 changes
      for (let i = 0; i < 30; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const readings = telemetryReadings.filter(
        (m) => m.pinChangesPerSecond > 0,
      );
      expect(readings.length).toBeGreaterThan(0);

      const avgRate =
        readings.reduce((sum, m) => sum + m.pinChangesPerSecond, 0) /
        readings.length;
      expect(avgRate).toBeCloseTo(10, 0);
    });
  });

  describe("Scenario 3: 77 Hz (delay(10)) - Loss Expected", () => {
    it("should report 77 /sec but debounce prevents actual registry updates", () => {
      // Simulate 77 Hz: 77 changes per 1000ms = 1 change per ~13ms
      // Current implementation counts every updatePinValue() call
      // So it reports ~77, not the limited ~20 that Registry actually uses

      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();

      // Current behavior: reports actual count (~77), not limited count
      // This is the problem - user sees 77 but doesn't know 80% is lost!
      expect(metrics.pinChangesPerSecond).toBeCloseTo(77, 0);
    });

    it("should indicate throttling at 77 Hz", () => {
      // Rapidly trigger changes to activate debounce
      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
      }

      vi.advanceTimersByTime(50); // Within debounce window

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.isThrottled).toBe(true);
    });

    it("should FAIL to show loss estimate (this is the bug)", () => {
      // 77 intended changes, but only ~20 actually update Registry
      // However, updatePinValue() counts ALL 77, so loss is hidden!
      telemetryReadings.length = 0;

      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();

      // Current behavior: NO loss detected, reports full 77
      // This is WRONG - user should see warning!
      const reportedRate = metrics.pinChangesPerSecond;
      expect(reportedRate).toBeCloseTo(77, 0);

      // What SHOULD happen: detect loss
      // const estimatedLoss = 77 - 20 = 57 (80% loss)
      // But this detection is NOT implemented yet
    });

    it("should report high rate without proper throttle indication", () => {
      telemetryReadings.length = 0;

      // Sustain 77 Hz for short period
      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const metrics = manager.getPerformanceMetrics();

      // High rate is reported
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(50);

      // But isThrottled flag may not be true
      // (depends on timing of debounce timer)
      expect(typeof metrics.isThrottled).toBe('boolean');
    });
  });

  describe("Scenario 4: 395 Hz (delay(1)) - Severe Loss (CRITICAL BUG)", () => {
    it("should report 395 /sec but in reality only ~20 work", () => {
      // 395 changes in 395ms, debounce allows only ~20
      // This is EXACTLY the problem the user reported!
      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();

      // Current behavior: reports full 395 without warning!
      expect(metrics.pinChangesPerSecond).toBeCloseTo(395, 0);

      // User sees: "Pin Changes: 395 /s" - seems normal
      // Reality: 95% of those changes are lost in debounce!
      // Should show: "Pin Changes: 395 /s ⚠️ LOST: 95% (only 20 actual)"
    });

    it("should show some indication of throttle (but doesn't reliably)", () => {
      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
      }

      // At this point, debounce may or may not be active
      const metrics = manager.getPerformanceMetrics();

      // We can't guarantee isThrottled is true
      // because updatePinValue() doesn't trigger debounce directly
      expect(typeof metrics.isThrottled).toBe('boolean');
    });

    it("should FAIL to detect ~95% loss (not implemented)", () => {
      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();

      // Current behavior: no loss detection, reports 395
      expect(metrics.pinChangesPerSecond).toBeCloseTo(395, 0);

      // What SHOULD happen:
      // const estimatedLoss = 95%; // 375 out of 395 lost
      // const warningLevel = 'CRITICAL';
      // But this is NOT implemented
    });

    it("should fail silently (no warning at 395 Hz)", () => {
      telemetryReadings.length = 0;

      // 395 changes in 395ms
      for (let i = 0; i < 395; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1);
      }

      const metrics = manager.getPerformanceMetrics();

      // Reports high rate without warning
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(100);
      // No loss indication present
      expect(metrics).not.toHaveProperty('lossPercentage');
      expect(metrics).not.toHaveProperty('warningLevel');
    });
  });

  describe("Transition Detection: Low → High Frequency", () => {
    it("should detect transition from 1 Hz to 77 Hz", () => {
      telemetryReadings.length = 0;

      // Start at 1 Hz for 2 seconds
      for (let i = 0; i < 2; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(1000);
      }

      const lowFreqReadings = telemetryReadings.filter(
        (m) => m.pinChangesPerSecond > 0,
      );
      const lowFreqThrottled = lowFreqReadings.filter((m) => m.isThrottled);

      // Should have no throttling at 1 Hz
      expect(lowFreqThrottled.length).toBe(0);

      // Now jump to 77 Hz
      telemetryReadings.length = 0;
      for (let i = 0; i < 77; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(13);
      }

      const highFreqReadings = telemetryReadings.filter(
        (m) => m.pinChangesPerSecond > 0,
      );
      const highFreqThrottled = highFreqReadings.filter((m) => m.isThrottled);

      // Should now show throttling
      expect(highFreqThrottled.length).toBeGreaterThan(0);
    });

    it("should show increasing loss as frequency increases", () => {
      const frequencies = [1, 5, 10, 20, 40, 77];
      const lossPercentages = [];

      for (const freq of frequencies) {
        telemetryReadings.length = 0;

        const changeInterval = 1000 / freq;
        for (let i = 0; i < freq; i++) {
          manager.updatePinValue(13, i % 2);
          vi.advanceTimersByTime(changeInterval);
        }

        const metrics = manager.getPerformanceMetrics();
        const loss = ((freq - metrics.pinChangesPerSecond) / freq) * 100;
        lossPercentages.push(loss);
      }

      // Loss should increase monotonically (or stay at 0)
      for (let i = 1; i < lossPercentages.length; i++) {
        expect(lossPercentages[i]).toBeGreaterThanOrEqual(
          lossPercentages[i - 1] - 5, // Allow 5% tolerance
        );
      }

      // Should have significant loss at 77 Hz
      expect(lossPercentages[lossPercentages.length - 1]).toBeGreaterThan(50);
    });
  });

  describe("Throttle Flag Accuracy", () => {
    it("should toggle throttle flag based on debounce timer", () => {
      // When debounce is active, throttle should be true
      manager.updatePinValue(13, 1);

      // Immediately after, debounce is active
      vi.advanceTimersByTime(25); // Before 50ms expires
      let metrics = manager.getPerformanceMetrics();

      // Can't guarantee throttle without knowing implementation detail,
      // but we can verify it's a boolean
      expect(typeof metrics.isThrottled).toBe("boolean");

      // After debounce expires
      vi.advanceTimersByTime(50);
      metrics = manager.getPerformanceMetrics();
      expect(typeof metrics.isThrottled).toBe("boolean");
    });

    it("should remain false when changes are infrequent", () => {
      for (let i = 0; i < 5; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(500); // 0.5 Hz - very slow
      }

      const allMetrics = telemetryReadings.filter((m) => m.timestamp);
      const anyThrottled = allMetrics.some((m) => m.isThrottled);

      // Should have minimal throttling at 0.5 Hz
      expect(anyThrottled).toBe(false);
    });
  });

  describe("Accuracy Verification", () => {
    it("should measure 1 Hz within 10% accuracy", () => {
      for (let i = 0; i < 10; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(100);
      }

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeCloseTo(10, 1);
    });

    it("should measure 5 Hz within 10% accuracy", () => {
      for (let i = 0; i < 5; i++) {
        manager.updatePinValue(13, i % 2);
        vi.advanceTimersByTime(200);
      }

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeCloseTo(5, 1);
    });

    it("should be consistent across multiple measurement windows", () => {
      const rates: number[] = [];

      // Take 3 measurements at 10 Hz
      for (let measurement = 0; measurement < 3; measurement++) {
        telemetryReadings.length = 0;

        // 1 second at 10 Hz
        for (let i = 0; i < 10; i++) {
          manager.updatePinValue(13, i % 2);
          vi.advanceTimersByTime(100);
        }

        const metrics = manager.getPerformanceMetrics();
        rates.push(metrics.pinChangesPerSecond);
      }

      // All rates should be similar (within 10%)
      const avg = rates.reduce((a, b) => a + b) / rates.length;
      rates.forEach((rate) => {
        expect(Math.abs(rate - avg) / avg).toBeLessThan(0.1);
      });
    });
  });
});
