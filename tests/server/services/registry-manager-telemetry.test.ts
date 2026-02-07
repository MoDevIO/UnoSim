// registry-manager-telemetry.test.ts
// Unit tests for RegistryManager telemetry tracking

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";

describe("RegistryManager - Telemetry Metrics", () => {
  let manager: RegistryManager;
  const telemetryCallbacks: any[] = [];

  beforeEach(() => {
    telemetryCallbacks.length = 0;
    manager = new RegistryManager({
      onTelemetry: (metrics) => {
        telemetryCallbacks.push(metrics);
      },
      enableTelemetry: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.destroy();
  });

  describe("Pin Change Tracking", () => {
    it("should track pin value changes in telemetry", () => {
      manager.updatePinValue(13, 1);

      // Must wait some time for rate calculation
      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);
    });

    it("should track PWM changes separately", () => {
      manager.updatePinPWM(9, 128);

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);
    });

    it("should track PWM and value changes together", () => {
      manager.updatePinValue(13, 1);
      manager.updatePinPWM(9, 128);

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThanOrEqual(1);
    });

    it("should reset pin change counter after metric retrieval", () => {
      manager.updatePinValue(13, 1);
      vi.advanceTimersByTime(100);
      let metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);

      // After calling getPerformanceMetrics, counters reset
      vi.advanceTimersByTime(100);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBe(0);
    });
  });

  describe("Serial Output Tracking", () => {
    it("should track serial output events", () => {
      manager.trackSerialOutput();

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);
    });

    it("should track high-frequency serial output", () => {
      for (let i = 0; i < 50; i++) {
        manager.trackSerialOutput();
      }

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);
    });

    it("should reset serial output counter after metric retrieval", () => {
      manager.trackSerialOutput();
      vi.advanceTimersByTime(100);
      let metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);

      // Counter resets after getPerformanceMetrics
      vi.advanceTimersByTime(100);
      metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBe(0);
    });
  });

  describe("Combined Telemetry Metrics", () => {
    it("should include all required fields in metrics report", () => {
      manager.updatePinValue(13, 1);
      manager.trackSerialOutput();

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();

      expect(metrics).toHaveProperty("incomingEvents");
      expect(metrics).toHaveProperty("sentBatches");
      expect(metrics).toHaveProperty("eventsPerSecond");
      expect(metrics).toHaveProperty("batchEfficiency");
      expect(metrics).toHaveProperty("pinChangesPerSecond");
      expect(metrics).toHaveProperty("isThrottled");
      expect(metrics).toHaveProperty("serialOutputPerSecond");
      expect(metrics).toHaveProperty("timestamp");
    });

    it("should track pins and serial independently", () => {
      for (let i = 0; i < 6; i++) {
        manager.updatePinValue(13, i);
      }

      for (let i = 0; i < 4; i++) {
        manager.trackSerialOutput();
      }

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);
    });

    it("should handle fractional rates correctly", () => {
      // Single change with time passage
      manager.updatePinValue(13, 1);

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);
      expect(metrics.pinChangesPerSecond).toBeLessThanOrEqual(10); // 1 change in 100ms = ~10/sec
    });
  });

  describe("Telemetry Configuration", () => {
    it("should respect enableTelemetry flag when false", () => {
      const disabledManager = new RegistryManager({
        onTelemetry: (metrics) => {
          telemetryCallbacks.push(metrics);
        },
        enableTelemetry: false,
      });

      disabledManager.updatePinValue(13, 1);

      vi.advanceTimersByTime(100);

      // Should still allow getPerformanceMetrics
      const metrics = disabledManager.getPerformanceMetrics();
      expect(metrics).toBeDefined();

      disabledManager.destroy();
    });

    it("should initialize with zero metrics", () => {
      const newManager = new RegistryManager({
        enableTelemetry: true,
      });

      // No time passed, no events recorded - should be 0
      const metrics = newManager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBe(0);
      expect(metrics.serialOutputPerSecond).toBe(0);

      newManager.destroy();
    });
  });

  describe("Rate Measurement", () => {
    it("should capture pin changes in metrics", () => {
      manager.updatePinValue(13, 1);
      manager.updatePinValue(12, 0);
      manager.updatePinValue(11, 1);

      vi.advanceTimersByTime(1000); // 1 second

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBeGreaterThan(0);
    });

    it("should capture serial events in metrics", () => {
      manager.trackSerialOutput();
      manager.trackSerialOutput();

      vi.advanceTimersByTime(1000); // 1 second

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);
    });

    it("should measure zero rates correctly", () => {
      // No events recorded
      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.pinChangesPerSecond).toBe(0);
      expect(metrics.serialOutputPerSecond).toBe(0);
    });
  });

  describe("Metric Types", () => {
    it("should have correct type for isThrottled", () => {
      const metrics = manager.getPerformanceMetrics();
      expect(typeof metrics.isThrottled).toBe("boolean");
    });

    it("should have numeric types for rates", () => {
      manager.updatePinValue(13, 1);
      manager.trackSerialOutput();

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(typeof metrics.pinChangesPerSecond).toBe("number");
      expect(typeof metrics.serialOutputPerSecond).toBe("number");
      expect(typeof metrics.timestamp).toBe("number");
    });

    it("should have boolean type for isThrottled", () => {
      const metrics = manager.getPerformanceMetrics();
      expect(typeof metrics.isThrottled).toBe("boolean");
    });
  });
});
