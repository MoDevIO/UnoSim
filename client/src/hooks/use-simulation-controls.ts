import { useCompileAndRun, CompileAndRunParams } from "./use-compile-and-run";
import type { MutableRefObject } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { SimulationStatus } from "@shared/types/arduino.types";
export type { SimulationStatus } from "@shared/types/arduino.types";

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

export type DebugMessageParams = {
  source: "frontend" | "server";
  type: string;
  data: string;
  protocol?: "websocket" | "http";
};

export type UseSimulationControlsParams = {
  ensureBackendConnected: (reason: string) => boolean;
  sendMessage: (message: IncomingArduinoMessage) => void;
  /** Optional immediate sender for time-critical commands (stop) */
  // return value indicates whether the message was actually sent (socket open)
  sendMessageImmediate?: (message: IncomingArduinoMessage) => boolean;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs: () => void;
  addDebugMessage: (params: DebugMessageParams) => void;
  serialEventQueueRef: MutableRefObject<
    Array<{ payload: IncomingArduinoMessage; receivedAt: number }>
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

type UseSimulationControlsResult = {
  simulationStatus: SimulationStatus;
  setSimulationStatus: SetState<SimulationStatus>;
  hasCompiledOnce: boolean;
  setHasCompiledOnce: SetState<boolean>;
  simulationTimeout: number;
  setSimulationTimeout: SetState<number>;
  startMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  stopMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  pauseMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  resumeMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  handleStart: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleReset: () => void;
};

export function useSimulationControls(
  params: UseSimulationControlsParams,
): UseSimulationControlsResult {
  // delegate to unified hook, supplying no-op placeholders for the compile
  // side so that tests which only define simulation props don't crash.
  const merged = useCompileAndRun({
    // compile portion defaults
    editorRef: { current: null },
    tabs: [],
    activeTabId: null,
    code: "",
    setSerialOutput: () => {},
    clearSerialOutput: () => {},
    setParserMessages: () => {},
    setParserPanelDismissed: () => {},
    // use the real resetPinUI from params when available (important for tests)
    resetPinUI: params.resetPinUI,
    setIoRegistry: () => {},
    setIsModified: () => {},
    setDebugMessages: () => {},
    addDebugMessage: params.addDebugMessage,
    ensureBackendConnected: params.ensureBackendConnected,
    isBackendUnreachableError: () => false,
    triggerErrorGlitch: () => {},
    toast: params.toast,

    // simulation-specific inputs
    sendMessage: params.sendMessage,
    sendMessageImmediate: params.sendMessageImmediate,
    serialEventQueueRef: params.serialEventQueueRef,
    pendingPinConflicts: params.pendingPinConflicts,
    setPendingPinConflicts: params.setPendingPinConflicts,
    setCliOutput: params.setCliOutput,
    isModified: params.isModified,
    handleCompileAndStart: params.handleCompileAndStart,
    startSimulationRef: params.startSimulationRef,
  } as CompileAndRunParams);

  // Compatibility adapter for the legacy conflict warning contract.
  const handleStart = () => {
    merged.handleStart();
    if (params.pendingPinConflicts.length > 0) {
      const names = params.pendingPinConflicts
        .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
        .join(", ");
      params.setCliOutput(
        (prev) =>
          (prev ? prev + "\n\n" : "") +
          `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`,
      );
      params.setPendingPinConflicts([]);
    }
  };

  const handleReset = () => {
    if (!params.ensureBackendConnected("Reset simulation")) return;
    params.clearOutputs();
    merged.handleReset();

    // also notify external compile-and-start after the same delay used internally
    setTimeout(() => {
      params.handleCompileAndStart();
    }, 100);
  };

  // mirror original return shape exactly
  return {
    simulationStatus: merged.simulationStatus,
    setSimulationStatus: merged.setSimulationStatus,
    hasCompiledOnce: merged.hasCompiledOnce,
    setHasCompiledOnce: merged.setHasCompiledOnce,
    simulationTimeout: merged.simulationTimeout,
    setSimulationTimeout: merged.setSimulationTimeout,
    startMutation: merged.startMutation,
    stopMutation: merged.stopMutation,
    pauseMutation: merged.pauseMutation,
    resumeMutation: merged.resumeMutation,
    handleStart,
    handleStop: merged.handleStop,
    handlePause: merged.handlePause,
    handleResume: merged.handleResume,
    handleReset,
  };
}
