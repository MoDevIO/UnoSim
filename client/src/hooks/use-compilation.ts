import { useCompileAndRun, CompileAndRunParams } from "./use-compile-and-run";
import { useRef, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { SetState } from "./use-compile-and-run";

// compilation-only parameters (simulation inputs are injected with no-ops)
type UseCompilationParams = Omit<
  CompileAndRunParams,
  |
    "serialEventQueueRef"
    | "pendingPinConflicts"
    | "setPendingPinConflicts"
    | "isModified"
    | "handleCompileAndStart"
    | "startSimulationRef"
> & {
  // original compile-only extras
  startSimulation?: () => void;
  setHasCompiledOnce?: SetState<boolean>;

  // when provided by a caller (e.g. arduino-simulator page) the compile
  // hook will use these to start the simulation over the network. this
  // keeps the helper convenient for pure-compile scenarios while still
  // allowing the integrated compile+run page to function correctly.
  sendMessage?: (message: any) => void;
  sendMessageImmediate?: (message: any) => boolean;
};

export function useCompilation(params: UseCompilationParams) {
  // merge passed compile params with harmless defaults for simulation fields
  const merged = useCompileAndRun({
    ...params,
    sendMessage: params.sendMessage ?? (() => {}),
    // @ts-ignore intentionally provide fallback; if caller passed
    // immediate sender we forward it, otherwise undefined is fine.
    sendMessageImmediate: params.sendMessageImmediate,
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
    hasCompilationErrors: merged.hasCompilationErrors,
    setHasCompilationErrors: merged.setHasCompilationErrors,
    compilerErrors: merged.compilerErrors,
    setCompilerErrors: merged.setCompilerErrors,
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
