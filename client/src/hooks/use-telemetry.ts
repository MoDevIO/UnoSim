import { useMemo } from "react";
import { TelemetryMetrics, useTelemetryStore } from "./use-telemetry-store";

/**
 * Helper hook bundling telemetry store subscription with some derived data
 * that is useful for UI components. Separates metrics-specific logic out of
 * pages and places it in a reusable hook.
 */
export function useTelemetry() {
  const telemetryData = useTelemetryStore();

  // derive a few commonly used rate values so callers don't have to guard
  // against null/undefined all over the place.
  const rates = useMemo(() => {
    const last: TelemetryMetrics | null = telemetryData.last;
    return {
      serialOutputPerSecond: last?.serialOutputPerSecond ?? 0,
      serialBytesPerSecond: last?.serialBytesPerSecond ?? 0,
      serialDroppedBytesPerSecond: last?.serialDroppedBytesPerSecond ?? 0,
      serialBytesTotal: last?.serialBytesTotal ?? 0,
    };
  }, [telemetryData.last]);

  return { telemetryData, rates };
}
