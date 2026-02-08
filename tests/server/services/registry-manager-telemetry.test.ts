// registry-manager-telemetry.test.ts
// Unit tests for RegistryManager telemetry tracking (Serial Output only)
// Pin state telemetry is now handled by PinStateBatcher

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";
import { PinStateBatcher } from "../../../server/services/pin-state-batcher";

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

    it("should measure serial events accurately over 1 second", () => {
      manager.trackSerialOutput();
      manager.trackSerialOutput();

      vi.advanceTimersByTime(1000); // 1 second

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBeGreaterThan(0);
    });

    it("should measure zero serial rate correctly", () => {
      // No events recorded
      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBe(0);
    });
  });

  describe("New Telemetry Interface (Phase A)", () => {
    it("should include all required fields in metrics report", () => {
      // Setup mock PinStateBatcher
      const mockBatcher = {
        getTelemetryAndReset: () => ({ intended: 10, actual: 8, batches: 2 }),
      } as unknown as PinStateBatcher;
      
      manager.setPinStateBatcher(mockBatcher);
      manager.trackSerialOutput();

      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();

      // New interface fields (Phase A)
      expect(metrics).toHaveProperty("timestamp");
      expect(metrics).toHaveProperty("intendedPinChangesPerSecond");
      expect(metrics).toHaveProperty("actualPinChangesPerSecond");
      expect(metrics).toHaveProperty("droppedPinChangesPerSecond");
      expect(metrics).toHaveProperty("batchesPerSecond");
      expect(metrics).toHaveProperty("avgStatesPerBatch");
      expect(metrics).toHaveProperty("serialOutputPerSecond");

      // Should NOT have old fields
      expect(metrics).not.toHaveProperty("incomingEvents");
      expect(metrics).not.toHaveProperty("sentBatches");
      expect(metrics).not.toHaveProperty("eventsPerSecond");
      expect(metrics).not.toHaveProperty("batchEfficiency");
      expect(metrics).not.toHaveProperty("pinChangesPerSecond");
      expect(metrics).not.toHaveProperty("isThrottled");
    });

    it("should calculate droppedPinChangesPerSecond correctly", () => {
      const mockBatcher = {
        getTelemetryAndReset: () => ({ intended: 100, actual: 80, batches: 5 }),
      } as unknown as PinStateBatcher;
      
      manager.setPinStateBatcher(mockBatcher);

      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      
      expect(metrics.intendedPinChangesPerSecond).toBe(100);
      expect(metrics.actualPinChangesPerSecond).toBe(80);
      expect(metrics.droppedPinChangesPerSecond).toBe(20);
    });

    it("should calculate avgStatesPerBatch correctly", () => {
      const mockBatcher = {
        getTelemetryAndReset: () => ({ intended: 100, actual: 80, batches: 4 }),
      } as unknown as PinStateBatcher;
      
      manager.setPinStateBatcher(mockBatcher);

      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      
      expect(metrics.avgStatesPerBatch).toBe(20); // 80 actual / 4 batches = 20
    });

    it("should handle zero batches gracefully", () => {
      const mockBatcher = {
        getTelemetryAndReset: () => ({ intended: 0, actual: 0, batches: 0 }),
      } as unknown as PinStateBatcher;
      
      manager.setPinStateBatcher(mockBatcher);

      vi.advanceTimersByTime(1000);

      const metrics = manager.getPerformanceMetrics();
      
      expect(metrics.avgStatesPerBatch).toBe(0);
      expect(metrics.batchesPerSecond).toBe(0);
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

      manager.trackSerialOutput();

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

      const metrics = newManager.getPerformanceMetrics();
      expect(metrics.serialOutputPerSecond).toBe(0);
      expect(metrics.intendedPinChangesPerSecond).toBe(0);

      newManager.destroy();
    });
  });

  describe("Metric Types", () => {
    it("should have numeric types for all new metrics", () => {
      manager.trackSerialOutput();

      vi.advanceTimersByTime(100);

      const metrics = manager.getPerformanceMetrics();
      expect(typeof metrics.intendedPinChangesPerSecond).toBe("number");
      expect(typeof metrics.actualPinChangesPerSecond).toBe("number");
      expect(typeof metrics.droppedPinChangesPerSecond).toBe("number");
      expect(typeof metrics.batchesPerSecond).toBe("number");
      expect(typeof metrics.avgStatesPerBatch).toBe("number");
      expect(typeof metrics.serialOutputPerSecond).toBe("number");
      expect(typeof metrics.timestamp).toBe("number");
    });
  });
});
