import { useCallback, useState, useEffect } from "react";
import type { MutableRefObject } from "react";
import { useMutation } from "@tanstack/react-query";

type SimulationStatus = "running" | "stopped" | "paused";

type SetState<T> = (value: T | ((prev: T) => T)) => void;

type DebugMessageParams = {
  source: "frontend" | "server";
  type: string;
  data: string;
  protocol?: "websocket" | "http";
};

type UseSimulationControlsParams = {
  ensureBackendConnected: (reason: string) => boolean;
  sendMessage: (message: any) => void;
  /** Optional immediate sender for time-critical commands (stop) */
  sendMessageImmediate?: (message: any) => void;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs: () => void;
  addDebugMessage: (params: DebugMessageParams) => void;
  serialEventQueueRef: MutableRefObject<
    Array<{ payload: any; receivedAt: number }>
  >;
  toast: (args: {
    title: string;
    description?: string;
    variant?: "destructive";
  }) => void;
  pendingPinConflicts: number[];
  setPendingPinConflicts: SetState<number[]>;
  setCliOutput: SetState<string>;
  isModified: boolean;
  handleCompileAndStart: () => void;
  startSimulationRef: MutableRefObject<(() => void) | null>;
};

export function useSimulationControls({
  ensureBackendConnected,
  sendMessage,
  /** Optional immediate sender for time-critical commands (stop) */
  sendMessageImmediate,
  resetPinUI,
  clearOutputs,
  addDebugMessage,
  serialEventQueueRef,
  toast,
  pendingPinConflicts,
  setPendingPinConflicts,
  setCliOutput,
  isModified,
  handleCompileAndStart,
  startSimulationRef,
}: UseSimulationControlsParams) {
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>(
    "stopped",
  );
  // Trace state changes during tests to detect unexpected overwrites
  // eslint-disable-next-line no-console
  useEffect(() => { /* simulationStatus observed for side-effects */ }, [simulationStatus]);

  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);

  const stopMutation = useMutation({
    mutationFn: async () => {
      addDebugMessage({
        source: "frontend",
        type: "stop_simulation",
        data: JSON.stringify({ type: "stop_simulation" }, null, 2),
        protocol: "websocket",
      });
      // prefer immediate send for STOP (time-critical)
      if ((arguments as any)?.[0] && typeof (arguments as any)[0].sendMessageImmediate === "function") {
        // noop: defensive - not used; prefer the passed-in prop below
      }
      // use provided immediate sender when available, fall back to buffered send
      // (don't change other lifecycle flows)
      // @ts-ignore - sendMessageImmediate may be undefined in older call-sites
      const immediate = (sendMessageImmediate as any) ?? undefined;
      if (immediate) immediate({ type: "stop_simulation" });
      else sendMessage({ type: "stop_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("stopped");
      serialEventQueueRef.current = [];
      resetPinUI({ keepDetected: true });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      addDebugMessage({
        source: "frontend",
        type: "pause_simulation",
        data: JSON.stringify({ type: "pause_simulation" }, null, 2),
        protocol: "websocket",
      });
      sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("paused");
    },
    onError: () => {
      toast({
        title: "Pause failed",
        description: "Could not pause simulation",
        variant: "destructive",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      addDebugMessage({
        source: "frontend",
        type: "resume_simulation",
        data: JSON.stringify({ type: "resume_simulation" }, null, 2),
        protocol: "websocket",
      });
      sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
    },
    onError: () => {
      toast({
        title: "Resume failed",
        description: "Could not resume simulation",
        variant: "destructive",
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      resetPinUI({ keepDetected: true });
      addDebugMessage({
        source: "frontend",
        type: "start_simulation",
        data: JSON.stringify(
          { type: "start_simulation", timeout: simulationTimeout },
          null,
          2,
        ),
        protocol: "websocket",
      });
      sendMessage({ type: "start_simulation", timeout: simulationTimeout });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
      toast({
        title: "Simulation Started",
        description: "Arduino simulation is now running",
      });
      try {
        if (pendingPinConflicts && pendingPinConflicts.length > 0) {
          const names = pendingPinConflicts
            .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
            .join(", ");
          setCliOutput(
            (prev) =>
              (prev ? prev + "\n\n" : "") +
              `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`,
          );
          setPendingPinConflicts([]);
        }
      } catch {}
    },
    onError: (error: any) => {
      toast({
        title: "Start Failed",
        description: error.message || "Could not start simulation",
        variant: "destructive",
      });
      if (isModified && hasCompiledOnce) {
        toast({
          title: "Code Modified",
          description: "Compile to apply your latest changes",
        });
      }
    },
  });

  startSimulationRef.current = () => startMutation.mutate();

  const handleStop = useCallback(() => {
    if (!ensureBackendConnected("Simulation stoppen")) return;
    stopMutation.mutate();
  }, [ensureBackendConnected, stopMutation]);

  const handleStart = useCallback(() => {
    if (!ensureBackendConnected("Simulation starten")) return;
    startMutation.mutate();
  }, [ensureBackendConnected, startMutation]);

  const handlePause = useCallback(() => {
    if (!ensureBackendConnected("Simulation pausieren")) return;
    pauseMutation.mutate();
  }, [ensureBackendConnected, pauseMutation]);

  const handleResume = useCallback(() => {
    if (!ensureBackendConnected("Simulation fortsetzen")) return;
    resumeMutation.mutate();
  }, [ensureBackendConnected, resumeMutation]);

  const handleReset = useCallback(() => {
    if (!ensureBackendConnected("Reset simulation")) return;
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
      setSimulationStatus("stopped");
    }
    clearOutputs();
    resetPinUI({ keepDetected: true });

    toast({
      title: "Resetting...",
      description: "Recompiling and restarting simulation",
    });

    setTimeout(() => {
      handleCompileAndStart();
    }, 100);
  }, [
    clearOutputs,
    ensureBackendConnected,
    handleCompileAndStart,
    resetPinUI,
    sendMessage,
    simulationStatus,
    toast,
  ]);

  return {
    simulationStatus,
    setSimulationStatus,
    hasCompiledOnce,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleReset,
  };
}
