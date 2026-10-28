import { useEffect, useState, useSyncExternalStore } from "react";
import { getRuntimeHub } from "@/lib/runtime/runtime-hub";

export interface BrowserRunInfo {
  /** A browser run is in progress: it needs no server connection. */
  readonly active: boolean;
  /** Simulated time per wall time of the run, from the worker's telemetry (about once a second). */
  readonly realTimeFactor?: number;
  readonly simTimeMs?: number;
}

/** State of the browser emulation for the header, the debug bar and the connection logic (plan P3.5, P3.6). */
export function useBrowserRunInfo(): BrowserRunInfo {
  const hub = getRuntimeHub();
  const active = useSyncExternalStore(
    (listener) => hub.onChange(listener),
    () => hub.browserRunActive,
    () => false,
  );
  const [telemetry, setTelemetry] = useState<{ realTimeFactor: number; simTimeMs: number } | undefined>();

  useEffect(
    () =>
      hub.onBrowserEvent((event) => {
        if (event.type === "runtime_telemetry") setTelemetry({ realTimeFactor: event.sample.realTimeFactor, simTimeMs: event.sample.simTimeMs });
      }),
    [hub],
  );
  useEffect(() => {
    if (!active) setTelemetry(undefined);
  }, [active]);

  return active && telemetry ? { active, ...telemetry } : { active };
}
