import { useEffect, useRef, useCallback } from "react";
import type { IncomingArduinoMessage } from "@/types/websocket";

interface UseSimulationLifecycleOptions {
  code: string;
  /**
   * What counts as the source of the run: the content of every file of the project. An edit of any file
   * stops the run; opening another tab changes the shown `code` but not this. Without it, `code` itself.
   */
  sourceSignature?: string;
  /** True while a `queued` status belongs to a run that is starting in the browser (not to the server's queue). */
  isStartingInBrowser?: () => boolean;
  simulationStatus: "idle" | "running" | "compiling" | "queued" | "paused";
  setSimulationStatus: (s: "idle" | "running" | "compiling" | "queued" | "paused") => void;
  sendMessage: (msg: IncomingArduinoMessage) => void;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs?: () => void;
  handlePause?: () => void;
  handleResume?: () => void;
  handleReset?: () => void;
  hasCompilationErrors?: boolean;
}

export function useSimulationLifecycle({
  code,
  sourceSignature,
  isStartingInBrowser,
  simulationStatus,
  setSimulationStatus,
  sendMessage,
  resetPinUI,
  clearOutputs,
  handlePause,
  handleResume,
  handleReset,
  hasCompilationErrors = false,
}: UseSimulationLifecycleOptions) {
  // Trace state transitions for tests/debugging
   
  useEffect(() => { /* status changes handled by lifecycle */ }, [simulationStatus]);

  // Temporary suppression flag (used when inserting editor suggestions)
  const skipAutoStopRef = useRef(false);

  // Remember last code to detect *edits* (not initial mount)
  const prevCodeRef = useRef<string | null>(null);

  const suppressAutoStopOnce = useCallback(() => {
    skipAutoStopRef.current = true;
  }, []);

  const stopSimulation = useCallback(() => {
    try {
      sendMessage({ type: "stop_simulation" });
    } catch {}
    try {
      setSimulationStatus("idle");
    } catch {}
    try {
      resetPinUI();
    } catch {}
  }, [sendMessage, setSimulationStatus, resetPinUI]);

  // Watch for source edits and stop a running, paused or (in the browser) starting simulation (unless suppressed)
  const watched = sourceSignature ?? code;
  useEffect(() => {
    const prev = prevCodeRef.current;
    if (prev === null) {
      prevCodeRef.current = watched;
      return;
    }

    if (prev === watched) return;

    prevCodeRef.current = watched;

    // `queued` of a browser run is the time until the worker confirms it: the confirmation must not start the old source.
    const startingInBrowser = simulationStatus === "queued" && isStartingInBrowser?.() === true;
    if ((simulationStatus === "running" || simulationStatus === "paused" || startingInBrowser) && !skipAutoStopRef.current) {
      stopSimulation();
      // preserve detected pin modes when stopping due to edit
      try {
        resetPinUI({ keepDetected: true });
      } catch {}
    }

    skipAutoStopRef.current = false;
  }, [watched, simulationStatus, stopSimulation, resetPinUI, isStartingInBrowser]);

  // Stop simulation automatically when compiler reports errors
  useEffect(() => {
    if (!hasCompilationErrors) return;
    if (simulationStatus === "running" || simulationStatus === "paused") {
      stopSimulation();
      // keep UI state consistent when compiler fails
      try {
        clearOutputs?.();
      } catch {}
    }
  }, [hasCompilationErrors, simulationStatus, stopSimulation, clearOutputs]);

  return {
    suppressAutoStopOnce,
    stopSimulation,
    pauseSimulation: handlePause ?? (() => {}),
    resumeSimulation: handleResume ?? (() => {}),
    resetSimulation: handleReset ?? (() => {}),
  } as const;
}
