import { useCompileAndRun, CompileAndRunParams } from "./use-compile-and-run";
import { useRef, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { SetState } from "./use-compile-and-run";

// original alias kept for compatibility (rare external refs)
export type UseCompileAndRunParams = CompileAndRunParams;

// compilation-only parameters (simulation inputs are injected with no-ops)
export type UseCompilationParams = Omit<
  CompileAndRunParams,
  |
    "sendMessage"
    | "sendMessageImmediate"
    | "serialEventQueueRef"
    | "pendingPinConflicts"
    | "setPendingPinConflicts"
    | "isModified"
    | "handleCompileAndStart"
    | "startSimulationRef"
> & {
  startSimulation?: () => void;
  setHasCompiledOnce?: SetState<boolean>;
};

export function useCompilation(params: UseCompilationParams) {
  // merge passed compile params with harmless defaults for simulation fields
  const merged = useCompileAndRun({
    ...params,
    sendMessage: () => {},
    // @ts-ignore intentionally provide fallback
    sendMessageImmediate: undefined,
    serialEventQueueRef: { current: [] } as MutableRefObject<any>,
    pendingPinConflicts: [],
    setPendingPinConflicts: () => {},
    isModified: false,
    handleCompileAndStart: () => {},
    startSimulationRef: { current: null } as MutableRefObject<(() => void) | null>,
  });

  // notify caller of compile successes in the old style and trigger
  // optional external simulation start *after* compilation status updates.
  const startCalled = useRef(false);
  useEffect(() => {
    if (merged.compilationStatus === "success") {
      // update external flags
      params.setHasCompiledOnce?.(true);
      params.setIsModified?.(false);
      // trigger external startSimulation only once per success
      if (!startCalled.current && typeof params.startSimulation === "function") {
        startCalled.current = true;
        // defer to microtask so that compilationStatus has updated for callers
        Promise.resolve().then(() => {
          params.startSimulation?.();
        });
      }
    } else {
      startCalled.current = false;
    }
  }, [merged.compilationStatus, params]);

  // mirror the original Public API exactly
  // wrap handleCompileAndStart so that external callers (tests / legacy
  // users) can pass their own startSimulation callback.
  const handleCompileAndStart = () => {
    merged.handleCompileAndStart();
  };

  return {
    compilationStatus: merged.compilationStatus,
    setCompilationStatus: merged.setCompilationStatus,
    arduinoCliStatus: merged.arduinoCliStatus,
    setArduinoCliStatus: merged.setArduinoCliStatus,
    gccStatus: merged.gccStatus,
    setGccStatus: merged.setGccStatus,
    hasCompilationErrors: merged.hasCompilationErrors,
    setHasCompilationErrors: merged.setHasCompilationErrors,
    lastCompilationResult: merged.lastCompilationResult,
    setLastCompilationResult: merged.setLastCompilationResult,
    cliOutput: merged.cliOutput,
    setCliOutput: merged.setCliOutput,
    compileMutation: merged.compileMutation,
    handleCompile: merged.handleCompile,
    handleCompileAndStart,
    handleClearCompilationOutput: merged.handleClearCompilationOutput,
    clearOutputs: merged.clearOutputs,
  } as any;
}
