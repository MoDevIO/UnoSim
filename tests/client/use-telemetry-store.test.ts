// use-telemetry-store.test.ts
// Unit tests for telemetry store hook (Phase A: New Metrics)

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { telemetryStore } from "../../client/src/hooks/use-telemetry-store";
import { useTelemetryStore } from "../../client/src/hooks/use-telemetry-store";

describe("telemetryStore", () => {
  beforeEach(() => {
    telemetryStore.resetTelemetry();
  });

  describe("pushTelemetry", () => {
    it("should store telemetry metrics with new interface", () => {
      const metric = {
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 150,
        actualPinChangesPerSecond: 120,
        droppedPinChangesPerSecond: 30,
        batchesPerSecond: 20,
        avgStatesPerBatch: 6,
        serialOutputPerSecond: 10,
        serialBytesTotal: 0,
      };

      telemetryStore.pushTelemetry(metric);

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last).toEqual(metric);
      expect(snapshot.history).toContainEqual(metric);
    });

    it("should maintain rolling window of metrics", () => {
      const metrics = [];
      const baseTime = Date.now();

      for (let i = 0; i < 30; i++) {
        const metric = {
          timestamp: baseTime + i * 1000,
          intendedPinChangesPerSecond: i * 50,
          actualPinChangesPerSecond: i * 40,
          droppedPinChangesPerSecond: i * 10,
          batchesPerSecond: 20,
          avgStatesPerBatch: i * 2,
          serialOutputPerSecond: i,
        };
        metrics.push(metric);
        telemetryStore.pushTelemetry(metric);
      }

      const snapshot = telemetryStore.getSnapshot();
      // Should maintain 60-item rolling buffer
      expect(snapshot.history.length).toBeLessThanOrEqual(60);
      expect(snapshot.last).toEqual(metrics[29]);
    });

    it("should handle zero metrics gracefully", () => {
      const metric = {
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 0,
        actualPinChangesPerSecond: 0,
        droppedPinChangesPerSecond: 0,
        batchesPerSecond: 0,
        avgStatesPerBatch: 0,
        serialOutputPerSecond: 0,
        serialBytesTotal: 0,
      };

      telemetryStore.pushTelemetry(metric);

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last).toEqual(metric);
    });

    it("should handle realistic simulation metrics", () => {
      const metric = {
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 1520,
        actualPinChangesPerSecond: 1140,
        droppedPinChangesPerSecond: 380,
        batchesPerSecond: 20,
        avgStatesPerBatch: 57,
        serialOutputPerSecond: 5,
        serialBytesTotal: 0,
      };

      telemetryStore.pushTelemetry(metric);

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last?.intendedPinChangesPerSecond).toBe(1520);
      expect(snapshot.last?.actualPinChangesPerSecond).toBe(1140);
      expect(snapshot.last?.droppedPinChangesPerSecond).toBe(380);
    });
  });

  describe("resetTelemetry", () => {
    it("should clear all telemetry data", () => {
      const metric = {
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 100,
        actualPinChangesPerSecond: 80,
        droppedPinChangesPerSecond: 20,
        batchesPerSecond: 20,
        avgStatesPerBatch: 4,
        serialOutputPerSecond: 10,
        serialBytesTotal: 0,
      };

      telemetryStore.pushTelemetry(metric);
      telemetryStore.resetTelemetry();

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last).toBeNull();
      expect(snapshot.history).toEqual([]);
      expect(snapshot.lastHeartbeatAt).toBeNull();
    });
  });

  describe("resetToEmpty", () => {
    it("should perform hard reset of telemetry", () => {
      const metrics = [];
      for (let i = 0; i < 5; i++) {
        const metric = {
          timestamp: Date.now() + i * 1000,
          intendedPinChangesPerSecond: i * 100,
          actualPinChangesPerSecond: i * 80,
          droppedPinChangesPerSecond: i * 20,
          batchesPerSecond: 20,
          avgStatesPerBatch: 4,
          serialOutputPerSecond: i * 10,
          serialBytesTotal: 0,
        };
        metrics.push(metric);
        telemetryStore.pushTelemetry(metric);
      }

      telemetryStore.resetToEmpty();

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last).toBeNull();
      expect(snapshot.history).toEqual([]);
    });
  });
});

describe("useTelemetryStore", () => {
  beforeEach(() => {
    telemetryStore.resetTelemetry();
  });

  it("should provide telemetry snapshot via hook", () => {
    const { result } = renderHook(() => useTelemetryStore());

    expect(result.current.history).toEqual([]);
    expect(result.current.last).toBeNull();
  });

  it("should update when telemetry is pushed", () => {
    const { result } = renderHook(() => useTelemetryStore());

    act(() => {
      telemetryStore.pushTelemetry({
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 100,
        actualPinChangesPerSecond: 80,
        droppedPinChangesPerSecond: 20,
        batchesPerSecond: 20,
        avgStatesPerBatch: 4,
        serialOutputPerSecond: 10,
      });
    });

    expect(result.current.last).toBeDefined();
    expect(result.current.last?.intendedPinChangesPerSecond).toBe(100);
  });

  it("should track lastHeartbeatAt timestamp", () => {
    const { result } = renderHook(() => useTelemetryStore());
    const now = Date.now();

    act(() => {
      telemetryStore.pushTelemetry({
        timestamp: now,
        intendedPinChangesPerSecond: 100,
        actualPinChangesPerSecond: 80,
        droppedPinChangesPerSecond: 20,
        batchesPerSecond: 20,
        avgStatesPerBatch: 4,
        serialOutputPerSecond: 10,
        serialBytesTotal: 0,
      });
    });

    expect(result.current.lastHeartbeatAt).toBe(now);
  });

  it("should provide access to reset function", () => {
    const { result } = renderHook(() => useTelemetryStore());

    act(() => {
      telemetryStore.pushTelemetry({
        timestamp: Date.now(),
        intendedPinChangesPerSecond: 100,
        actualPinChangesPerSecond: 80,
        droppedPinChangesPerSecond: 20,
        batchesPerSecond: 20,
        avgStatesPerBatch: 4,
        serialOutputPerSecond: 10,
      });
    });

    expect(result.current.last).toBeDefined();

    act(() => {
      result.current.resetTelemetry();
    });

    expect(result.current.last).toBeNull();
  });
});
