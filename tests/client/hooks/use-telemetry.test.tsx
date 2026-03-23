import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTelemetry } from "../../../client/src/hooks/use-telemetry";
import { telemetryStore, TelemetryMetrics } from "../../../client/src/hooks/use-telemetry-store";

// ensure we start each test with a clean store
beforeEach(() => {
  telemetryStore.resetTelemetry();
});

describe("useTelemetry", () => {
  it("provides default zero rates when no data has been pushed", () => {
    const { result } = renderHook(() => useTelemetry());

    expect(result.current.telemetryData.last).toBeNull();
    expect(result.current.rates.serialOutputPerSecond).toBe(0);
    expect(result.current.rates.serialBytesPerSecond).toBe(0);
    expect(result.current.rates.serialDroppedBytesPerSecond).toBe(0);
    expect(result.current.rates.serialBytesTotal).toBe(0);
  });

  it("updates rates when telemetry metrics are pushed to the store", () => {
    const { result } = renderHook(() => useTelemetry());

    const metric: TelemetryMetrics = {
      timestamp: Date.now(),
      intendedPinChangesPerSecond: 0,
      actualPinChangesPerSecond: 0,
      droppedPinChangesPerSecond: 0,
      batchesPerSecond: 0,
      avgStatesPerBatch: 0,
      serialOutputPerSecond: 12.34,
      serialBytesPerSecond: 56,
      serialBytesTotal: 789,
    };

    act(() => {
      telemetryStore.pushTelemetry(metric);
    });

    expect(result.current.telemetryData.last).toEqual(metric);
    expect(result.current.rates.serialOutputPerSecond).toBeCloseTo(12.34);
    expect(result.current.rates.serialBytesPerSecond).toBe(56);
    expect(result.current.rates.serialDroppedBytesPerSecond).toBe(0);
    expect(result.current.rates.serialBytesTotal).toBe(789);
  });
});
