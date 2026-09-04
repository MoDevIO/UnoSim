import { useCallback, useRef } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { Logger } from "@shared/logger";
import { normalizeSimulationTimeout } from "@shared/input-limits";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { IncomingArduinoMessage } from "@/types/websocket";
import { useSimulationControllerState } from "./use-simulation-controller-state";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";
import type { UseUiFeedbackAdapterResult } from "./use-ui-feedback-adapter";

const logger = new Logger("useSimulationController");

export type SimulationControllerParams = {
  code: string;
  hasCompilationErrors: boolean;
  isModified?: boolean;
  ensureBackendConnected: (reason: string) => boolean;
  sendMessage: (message: IncomingArduinoMessage) => void;
  sendMessageImmediate?: (message: IncomingArduinoMessage) => boolean;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs: () => void;
  serialEventQueueRef: React.MutableRefObject<
    Array<{ payload: IncomingArduinoMessage; receivedAt: number }>
  >;
  pendingPinConflicts: number[];
  startSimulationRef?: React.MutableRefObject<(() => void) | null>;
  uiFeedback: Pick<
    UseUiFeedbackAdapterResult,
    | "logStopSimulation"
    | "logPauseSimulation"
    | "logResumeSimulation"
    | "logStartSimulation"
    | "logStartSimulationFallback"
    | "showSimulationStartedToast"
    | "showStartFailedToast"
    | "showCodeModifiedToast"
    | "showPauseFailedToast"
    | "showResumeFailedToast"
    | "showPinConflictWarning"
    | "extractErrorMessage"
  >;
};

export type SimulationControllerResult = {
  simulationStatus: SimulationStatus;
  setSimulationStatus: (value: SimulationStatus | ((previous: SimulationStatus) => SimulationStatus)) => void;
  hasCompiledOnce: boolean;
  setHasCompiledOnce: (value: boolean | ((previous: boolean) => boolean)) => void;
  simulationTimeout: number;
  setSimulationTimeout: (value: number | ((previous: number) => number)) => void;
  startMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  stopMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  pauseMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  resumeMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  handleStart: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  stopSimulationImmediately: () => void;
  startSimulation: () => void;
  setCompiledCode: (code: string) => void;
  startSimulationRef: React.MutableRefObject<(() => void) | null>;
  suppressAutoStopOnce: () => void;
};

export function useSimulationController(
  params: SimulationControllerParams,
): SimulationControllerResult {
  const {
    simulationStatus,
    setSimulationStatus,
    hasCompiledOnce,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
  } = useSimulationControllerState();
  const compiledCodeRef = useRef<string | null>(null);
  const internalStartRef = useRef<(() => void) | null>(null);
  const startSimulationRef = params.startSimulationRef ?? internalStartRef;

  const stopSimulationImmediately = useCallback(() => {
    params.uiFeedback.logStopSimulation();
    const message = { type: "stop_simulation" } as const;
    if (!(params.sendMessageImmediate?.(message) ?? false)) params.sendMessage(message);
    setSimulationStatus("idle");
    params.serialEventQueueRef.current = [];
    params.resetPinUI({ keepDetected: true });
  }, [params, setSimulationStatus]);

  const stopMutation = useMutation({
    mutationFn: async () => {
      stopSimulationImmediately();
      return { success: true };
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      params.uiFeedback.logPauseSimulation();
      params.sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => setSimulationStatus("paused"),
    onError: () => params.uiFeedback.showPauseFailedToast(),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      params.uiFeedback.logResumeSimulation();
      params.sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => setSimulationStatus("running"),
    onError: () => params.uiFeedback.showResumeFailedToast(),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const timeout = normalizeSimulationTimeout(simulationTimeout);
      logger.debug(`[CLIENT] startMutation invoked, simulationTimeout=${timeout}`);
      params.resetPinUI({ keepDetected: true });
      const message: { type: "start_simulation"; timeout: number; code?: string } = {
        type: "start_simulation",
        timeout,
      };
      if (compiledCodeRef.current) message.code = compiledCodeRef.current;

      params.uiFeedback.logStartSimulation(timeout, !!compiledCodeRef.current);
      if (params.sendMessageImmediate) {
        const sent = params.sendMessageImmediate(message);
        logger.debug(`[CLIENT] sendMessageImmediate returned ${String(sent)}`);
        if (!sent) {
          params.uiFeedback.logStartSimulationFallback();
          params.sendMessage(message);
        }
      } else {
        params.sendMessage(message);
      }
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
      params.uiFeedback.showSimulationStartedToast();
      if (params.pendingPinConflicts.length > 0) {
        params.uiFeedback.showPinConflictWarning(params.pendingPinConflicts);
      }
    },
    onError: (error: unknown) => {
      params.uiFeedback.showStartFailedToast(params.uiFeedback.extractErrorMessage(error));
      if (params.isModified && hasCompiledOnce) params.uiFeedback.showCodeModifiedToast();
    },
  });

  const startSimulation = useCallback(() => startMutation.mutate(), [startMutation]);
  const setCompiledCode = useCallback((code: string) => {
    compiledCodeRef.current = code;
  }, []);
  const handleStart = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation starten")) return;
    startSimulation();
  }, [params.ensureBackendConnected, startSimulation]);
  const handleStop = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation stoppen")) return;
    stopMutation.mutate();
  }, [params.ensureBackendConnected, stopMutation]);
  const handlePause = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation pausieren")) return;
    pauseMutation.mutate();
  }, [params.ensureBackendConnected, pauseMutation]);
  const handleResume = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation fortsetzen")) return;
    resumeMutation.mutate();
  }, [params.ensureBackendConnected, resumeMutation]);

  startSimulationRef.current = startSimulation;

  const lifecycle = useSimulationLifecycle({
    code: params.code,
    simulationStatus,
    setSimulationStatus,
    sendMessage: params.sendMessage,
    resetPinUI: params.resetPinUI,
    clearOutputs: params.clearOutputs,
    handlePause,
    handleResume,
    hasCompilationErrors: params.hasCompilationErrors,
  });

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
    stopSimulationImmediately,
    startSimulation,
    setCompiledCode,
    startSimulationRef,
    suppressAutoStopOnce: lifecycle.suppressAutoStopOnce,
  };
}