import { useEffect, useRef, useCallback } from "react";

export interface UseSimulationLifecycleOptions {
  code: string;
  simulationStatus: string;
  setSimulationStatus: (s: any) => void;
  sendMessage: (msg: any) => void;
  sendMessageImmediate?: (msg: any) => void;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs?: () => void;
  handlePause?: () => void;
  handleResume?: () => void;
  handleReset?: () => void;
  hasCompilationErrors?: boolean;
}

export function useSimulationLifecycle({
  code,
  simulationStatus,
  setSimulationStatus,
  sendMessage,
  sendMessageImmediate,
  resetPinUI,
  clearOutputs,
  handlePause,
  handleResume,
  handleReset,
  hasCompilationErrors = false,
}: UseSimulationLifecycleOptions) {
  // Trace state transitions for tests/debugging
  // eslint-disable-next-line no-console
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
      if ((sendMessageImmediate as any) != null) sendMessageImmediate?.({ type: "stop_simulation" });
      else sendMessage({ type: "stop_simulation" });
    } catch {}
    try {
      setSimulationStatus("stopped");
    } catch {}
    try {
      resetPinUI();
    } catch {}
  }, [sendMessage, sendMessageImmediate, setSimulationStatus, resetPinUI]);

  // Watch for code edits and stop running/paused simulation (unless suppressed)
  useEffect(() => {
    const prev = prevCodeRef.current;
    if (prev === null) {
      prevCodeRef.current = code;
      return;
    }

    if (prev === code) return;

    prevCodeRef.current = code;

    if ((simulationStatus === "running" || simulationStatus === "paused") && !skipAutoStopRef.current) {
      stopSimulation();
      // preserve detected pin modes when stopping due to edit
      try {
        resetPinUI({ keepDetected: true });
      } catch {}
    }

    skipAutoStopRef.current = false;
  }, [code, simulationStatus, stopSimulation, resetPinUI]);

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
