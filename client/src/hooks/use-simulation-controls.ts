import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { SimulationStatus } from "@shared/types/arduino.types";
import { useSimulationController } from "./use-simulation-controller";
import { useUiFeedbackAdapter } from "./use-ui-feedback-adapter";
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
  suppressAutoStopOnce: () => void;
};

export function useSimulationControls(
  params: UseSimulationControlsParams,
): UseSimulationControlsResult {
  const uiFeedback = useUiFeedbackAdapter({
    toast: params.toast,
    addDebugMessage: params.addDebugMessage,
    triggerErrorGlitch: () => {},
    setCliOutput: params.setCliOutput,
    setPendingPinConflicts: params.setPendingPinConflicts,
  });
  const controller = useSimulationController({
    code: "",
    hasCompilationErrors: false,
    isModified: params.isModified,
    ensureBackendConnected: params.ensureBackendConnected,
    sendMessage: params.sendMessage,
    sendMessageImmediate: params.sendMessageImmediate,
    resetPinUI: params.resetPinUI,
    clearOutputs: params.clearOutputs,
    serialEventQueueRef: params.serialEventQueueRef,
    pendingPinConflicts: params.pendingPinConflicts,
    startSimulationRef: params.startSimulationRef,
    uiFeedback,
  });

  const handleReset = useCallback(() => {
    if (!params.ensureBackendConnected("Reset simulation")) return;
    params.clearOutputs();
    if (controller.simulationStatus === "running") controller.stopSimulationImmediately();
    controller.setSimulationStatus("idle");
    params.resetPinUI({ keepDetected: true });
    uiFeedback.showResettingToast();
    setTimeout(() => {
      params.handleCompileAndStart();
    }, 100);
  }, [controller, params, uiFeedback]);

  // mirror original return shape exactly
  return {
    simulationStatus: controller.simulationStatus,
    setSimulationStatus: controller.setSimulationStatus,
    hasCompiledOnce: controller.hasCompiledOnce,
    setHasCompiledOnce: controller.setHasCompiledOnce,
    simulationTimeout: controller.simulationTimeout,
    setSimulationTimeout: controller.setSimulationTimeout,
    startMutation: controller.startMutation,
    stopMutation: controller.stopMutation,
    pauseMutation: controller.pauseMutation,
    resumeMutation: controller.resumeMutation,
    handleStart: controller.handleStart,
    handleStop: controller.handleStop,
    handlePause: controller.handlePause,
    handleResume: controller.handleResume,
    handleReset,
    suppressAutoStopOnce: controller.suppressAutoStopOnce,
  };
}
