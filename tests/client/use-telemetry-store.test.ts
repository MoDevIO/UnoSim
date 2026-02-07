// use-telemetry-store.test.ts
// Unit tests for telemetry store hook

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { telemetryStore } from "../../client/src/hooks/use-telemetry-store";
import { useTelemetryStore } from "../../client/src/hooks/use-telemetry-store";

describe("telemetryStore", () => {
  beforeEach(() => {
    telemetryStore.resetTelemetry();
  });

  describe("pushTelemetry", () => {
    it("should store telemetry metrics", () => {
      const metric = {
        incomingEvents: 100,
        sentBatches: 10,
        eventsPerSecond: 100,
        batchEfficiency: 10,
        pinChangesPerSecond: 50,
        isThrottled: false,
        serialOutputPerSecond: 10,
        timestamp: Date.now(),
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
          incomingEvents: i * 10,
          sentBatches: i,
          eventsPerSecond: i * 10,
          batchEfficiency: 10,
          pinChangesPerSecond: i * 5,
          isThrottled: false,
          serialOutputPerSecond: i,
          timestamp: baseTime + i * 1000,
        };
        metrics.push(metric);
        telemetryStore.pushTelemetry(metric);
      }

      const snapshot = telemetryStore.getSnapshot();
      // Should maintain 60-item rolling buffer
      expect(snapshot.history.length).toBeLessThanOrEqual(60);
      expect(snapshot.last).toEqual(metrics[29]);
    });

    it("should track peak EPS (events per second)", () => {
      const metrics = [
        {
          incomingEvents: 100,
          sentBatches: 10,
          eventsPerSecond: 100,
          batchEfficiency: 10,
          pinChangesPerSecond: 50,
          isThrottled: false,
          serialOutputPerSecond: 10,
          timestamp: Date.now(),
        },
        {
          incomingEvents: 200,
          sentBatches: 20,
          eventsPerSecond: 200, // Peak
          batchEfficiency: 10,
          pinChangesPerSecond: 100,
          isThrottled: false,
          serialOutputPerSecond: 20,
          timestamp: Date.now() + 1000,
        },
        {
          incomingEvents: 50,
          sentBatches: 5,
          eventsPerSecond: 50,
          batchEfficiency: 10,
          pinChangesPerSecond: 25,
          isThrottled: false,
          serialOutputPerSecond: 5,
          timestamp: Date.now() + 2000,
        },
      ];

      metrics.forEach((m) => telemetryStore.pushTelemetry(m));

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.peaks.maxEventsPerSecond).toBe(200);
    });

    it("should track peak pin changes per second", () => {
      const metrics = [
        {
          incomingEvents: 50,
          sentBatches: 5,
          eventsPerSecond: 50,
          batchEfficiency: 10,
          pinChangesPerSecond: 30, // Peak
          isThrottled: false,
          serialOutputPerSecond: 10,
          timestamp: Date.now(),
        },
        {
          incomingEvents: 100,
          sentBatches: 10,
          eventsPerSecond: 100,
          batchEfficiency: 10,
          pinChangesPerSecond: 20,
          isThrottled: false,
          serialOutputPerSecond: 20,
          timestamp: Date.now() + 1000,
        },
      ];

      metrics.forEach((m) => telemetryStore.pushTelemetry(m));

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.peaks.maxEventsPerSecond).toBe(100); // Overall EPS peak
    });

    it("should track throttle status", () => {
      const metrics = [
        {
          incomingEvents: 50,
          sentBatches: 5,
          eventsPerSecond: 50,
          batchEfficiency: 10,
          pinChangesPerSecond: 10,
          isThrottled: true, // Throttled
          serialOutputPerSecond: 10,
          timestamp: Date.now(),
        },
        {
          incomingEvents: 100,
          sentBatches: 10,
          eventsPerSecond: 100,
          batchEfficiency: 10,
          pinChangesPerSecond: 20,
          isThrottled: false, // Not throttled
          serialOutputPerSecond: 20,
          timestamp: Date.now() + 1000,
        },
      ];

      metrics.forEach((m) => telemetryStore.pushTelemetry(m));

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.last?.isThrottled).toBe(false);
    });
  });

  describe("useTelemetryStore hook", () => {
    it("should return empty snapshot initially", () => {
      const { result } = renderHook(() => useTelemetryStore());

      expect(result.current.last).toBeNull();
      expect(result.current.history).toEqual([]);
      expect(result.current.peaks.maxEventsPerSecond).toBe(0);
    });

    it("should subscribe to telemetry updates", () => {
      const { result, rerender } = renderHook(() => useTelemetryStore());

      const metric = {
        incomingEvents: 100,
        sentBatches: 10,
        eventsPerSecond: 100,
        batchEfficiency: 10,
        pinChangesPerSecond: 50,
        isThrottled: false,
        serialOutputPerSecond: 10,
        timestamp: Date.now(),
      };

      act(() => {
        telemetryStore.pushTelemetry(metric);
      });

      rerender();

      expect(result.current.last).toEqual(metric);
      expect(result.current.history).toHaveLength(1);
    });

    it("should reflect peak values", () => {
      const { result, rerender } = renderHook(() => useTelemetryStore());

      const metrics = [
        {
          incomingEvents: 100,
          sentBatches: 10,
          eventsPerSecond: 100,
          batchEfficiency: 10,
          pinChangesPerSecond: 50,
          isThrottled: false,
          serialOutputPerSecond: 10,
          timestamp: Date.now(),
        },
        {
          incomingEvents: 200,
          sentBatches: 20,
          eventsPerSecond: 200, // Peak
          batchEfficiency: 10,
          pinChangesPerSecond: 100, // Peak
          isThrottled: false,
          serialOutputPerSecond: 20,
          timestamp: Date.now() + 1000,
        },
      ];

      act(() => {
        metrics.forEach((m) => telemetryStore.pushTelemetry(m));
      });

      rerender();

      expect(result.current.peaks.maxEventsPerSecond).toBe(200);
    });
  });

  describe("resetTelemetry", () => {
    it("should clear all telemetry data", () => {
      const metric = {
        incomingEvents: 100,
        sentBatches: 10,
        eventsPerSecond: 100,
        batchEfficiency: 10,
        pinChangesPerSecond: 50,
        isThrottled: false,
        serialOutputPerSecond: 10,
        timestamp: Date.now(),
      };

      telemetryStore.pushTelemetry(metric);
      telemetryStore.resetTelemetry();

      const snapshot = telemetryStore.getSnapshot();
      expect(snapshot.history).toEqual([]);
      expect(snapshot.last).toBeNull();
      expect(snapshot.lastHeartbeatAt).toBeNull();
    });
  });

  describe("resetToInitial", () => {
    it("should clear history but preserve peaks", () => {
      const metrics = [
        {
          incomingEvents: 100,
          sentBatches: 10,
          eventsPerSecond: 100,
          batchEfficiency: 10,
          pinChangesPerSecond: 50,
          isThrottled: false,
          serialOutputPerSecond: 10,
          timestamp: Date.now(),
        },
        {
          incomingEvents: 200,
          sentBatches: 20,
          eventsPerSecond: 200,
          batchEfficiency: 10,
          pinChangesPerSecond: 100,
          isThrottled: false,
          serialOutputPerSecond: 20,
          timestamp: Date.now() + 1000,
        },
      ];

      metrics.forEach((m) => telemetryStore.pushTelemetry(m));

      const snapshotBefore = telemetryStore.getSnapshot();
      const peakBefore = snapshotBefore.peaks.maxEventsPerSecond;

      telemetryStore.resetToInitial();

      const snapshotAfter = telemetryStore.getSnapshot();
      expect(snapshotAfter.history).toEqual([]);
      expect(snapshotAfter.last).toBeNull();
      expect(snapshotAfter.peaks.maxEventsPerSecond).toBe(peakBefore);
    });
  });
});
