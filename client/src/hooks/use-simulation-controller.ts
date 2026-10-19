import { useCallback, useRef } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { Logger } from "@shared/logger";
import { normalizeSimulationTimeout } from "@shared/input-limits";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { IncomingArduinoMessage } from "@/types/websocket";
import { useSimulationControllerState } from "./use-simulation-controller-state";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";
import type { UseUiFeedbackAdapterResult } from "./use-ui-feedback-adapter";
import type { ServerCapabilities } from "@/lib/server-capabilities";
import type { RuntimeKind } from "@shared/boards";
import type { SimulationArtifact } from "@shared/simulation-artifact";
import { getRuntimeHub, type RuntimeHub } from "@/lib/runtime/runtime-hub";

const logger = new Logger("useSimulationController");

export type SimulationControllerParams = {
  readonly capabilities?: ServerCapabilities;
  /** Synchronously relinquish pending REST compile-to-start ownership. */
  onStartOrStop?: () => void;
  /** The runtime of the next run (plan P3.1 selection); the host mock when not given. */
  runtimeKind?: RuntimeKind;
  /** The host mock can take over when the browser emulation has no image to run. */
  hostMockUsable?: boolean;
  /** The runtimes of this tab; the shared hub when not given. */
  runtimeHub?: Pick<RuntimeHub, "load" | "peek" | "active" | "setActive">;
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
  setCompiledHeaders?: (headers: Array<{ name: string; content: string }>) => void;
  setCompiledEntryFile?: (entryFile: string | undefined) => void;
  /** The flash image of the latest build, from the compile result (anything that is not an artifact clears it). */
  setCompiledArtifact: (artifact: unknown) => void;
  /** True if the next start runs in the browser (selected, and the latest build has an image). */
  willStartInBrowser: () => boolean;
  /** True while a browser run is active and can be reset without compiling again. */
  canResetWithoutCompile: () => boolean;
  /** CPU reset of the running browser emulation; false if there is none. */
  resetWithoutCompile: () => boolean;
  startSimulationRef: React.MutableRefObject<(() => void) | null>;
  suppressAutoStopOnce: () => void;
};

/** Cheap shape check of a compile result's `artifact`; the schema validates it when the run starts. */
function looksLikeArtifact(value: unknown): value is SimulationArtifact {
  if (typeof value !== "object" || value === null) return false;
  const { flashBase64, sha256, buildId } = value as Record<string, unknown>;
  return typeof flashBase64 === "string" && typeof sha256 === "string" && typeof buildId === "string";
}

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
  const compiledHeadersRef = useRef<Array<{ name: string; content: string }>>([]);
  const compiledEntryFileRef = useRef<string | undefined>(undefined);
  const compiledArtifactRef = useRef<unknown>(undefined);
  const hub = params.runtimeHub ?? getRuntimeHub();
  const internalStartRef = useRef<(() => void) | null>(null);
  const startSimulationRef = params.startSimulationRef ?? internalStartRef;
  const canSimulate = params.capabilities?.canSimulate ?? true;

  /** Browser runs do not need the server: stop, pause and resume work without the connection. */
  const browserRunActive = () => hub.active === "browser";
  /** True if the next start runs in the browser: selected, and the latest build has an image. */
  const startsInBrowser = () => params.runtimeKind === "browser" && (looksLikeArtifact(compiledArtifactRef.current) || params.hostMockUsable === false);

  const stopSimulationImmediately = useCallback(() => {
    if (!canSimulate) return;
    params.uiFeedback.logStopSimulation();
    const message = { type: "stop_simulation" } as const;
    if (!(params.sendMessageImmediate?.(message) ?? false)) params.sendMessage(message);
    setSimulationStatus("idle");
    params.serialEventQueueRef.current = [];
    params.resetPinUI({ keepDetected: true });
  }, [canSimulate, params, setSimulationStatus]);

  const stopMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      stopSimulationImmediately();
      return { success: true };
    },
  });

  const pauseMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      params.uiFeedback.logPauseSimulation();
      params.sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => setSimulationStatus("paused"),
    onError: () => params.uiFeedback.showPauseFailedToast(),
  });

  const resumeMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      params.uiFeedback.logResumeSimulation();
      params.sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => setSimulationStatus("running"),
    onError: () => params.uiFeedback.showResumeFailedToast(),
  });

  const startMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      const timeout = normalizeSimulationTimeout(simulationTimeout);
      logger.debug(`[CLIENT] startMutation invoked, simulationTimeout=${timeout}`);
      params.resetPinUI({ keepDetected: true });
      const message: { type: "start_simulation"; timeout: number; code?: string; headers?: Array<{ name: string; content: string }>; entryFile?: string } = {
        type: "start_simulation",
        timeout,
      };
      if (compiledCodeRef.current) message.code = compiledCodeRef.current;
      if (compiledHeadersRef.current.length > 0) message.headers = compiledHeadersRef.current;
      if (compiledEntryFileRef.current) message.entryFile = compiledEntryFileRef.current;

      params.uiFeedback.logStartSimulation(timeout, !!compiledCodeRef.current);
      if (startsInBrowser()) {
        // The schema and the runtime load on demand: they stay out of the initial bundle.
        const { parseSimulationArtifact } = await import("@shared/simulation-artifact");
        const artifact = parseSimulationArtifact(compiledArtifactRef.current);
        if (!artifact) throw new Error("The latest build has no image for the browser emulation. Compile again.");
        const runtime = await hub.load("browser");
        // Start first: replacing a run reports the old one stopped, which must not end the new one.
        runtime.start({ kind: "browser", artifact, timeoutSec: timeout });
        hub.setActive("browser");
        return { success: true };
      }
      hub.setActive("host-mock");
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
      if (params.pendingPinConflicts.length > 0) {
        params.uiFeedback.showPinConflictWarning(params.pendingPinConflicts);
      }
    },
    onError: (error: unknown) => {
      params.uiFeedback.showStartFailedToast(params.uiFeedback.extractErrorMessage(error));
      if (params.isModified && hasCompiledOnce) params.uiFeedback.showCodeModifiedToast();
    },
  });

  const startSimulation = useCallback(() => {
    params.onStartOrStop?.();
    if (canSimulate) startMutation.mutate();
  }, [canSimulate, startMutation, params.onStartOrStop]);
  const setCompiledCode = useCallback((code: string) => {
    compiledCodeRef.current = code;
  }, []);
  const setCompiledHeaders = useCallback((headers: Array<{ name: string; content: string }>) => {
    compiledHeadersRef.current = headers;
  }, []);
  const setCompiledEntryFile = useCallback((entryFile: string | undefined) => {
    compiledEntryFileRef.current = entryFile;
  }, []);
  const handleStart = useCallback(() => {
    params.onStartOrStop?.();
    if (!canSimulate) return;
    if (!startsInBrowser() && !params.ensureBackendConnected("Simulation starten")) return;
    startSimulation();
  }, [canSimulate, params.ensureBackendConnected, startSimulation, params.onStartOrStop]);
  const handleStop = useCallback(() => {
    params.onStartOrStop?.();
    if (!canSimulate) return;
    if (!browserRunActive() && !params.ensureBackendConnected("Simulation stoppen")) return;
    stopMutation.mutate();
  }, [canSimulate, params.ensureBackendConnected, stopMutation, params.onStartOrStop]);
  const handlePause = useCallback(() => {
    if (!canSimulate) return;
    if (!browserRunActive() && !params.ensureBackendConnected("Simulation pausieren")) return;
    pauseMutation.mutate();
  }, [canSimulate, params.ensureBackendConnected, pauseMutation]);
  const handleResume = useCallback(() => {
    if (!canSimulate) return;
    if (!browserRunActive() && !params.ensureBackendConnected("Simulation fortsetzen")) return;
    resumeMutation.mutate();
  }, [canSimulate, params.ensureBackendConnected, resumeMutation]);

  const setCompiledArtifact = useCallback((artifact: unknown) => {
    compiledArtifactRef.current = looksLikeArtifact(artifact) ? artifact : undefined;
  }, []);
  const canResetWithoutCompile = useCallback(() => browserRunActive() && (simulationStatus === "running" || simulationStatus === "paused"), [simulationStatus, hub]);
  const resetWithoutCompile = useCallback(() => {
    if (!canResetWithoutCompile()) return false;
    params.serialEventQueueRef.current = [];
    params.clearOutputs();
    params.resetPinUI({ keepDetected: true });
    hub.peek("browser")?.reset();
    return true;
  }, [canResetWithoutCompile, hub, params]);

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
    setCompiledHeaders,
    setCompiledEntryFile,
    setCompiledArtifact,
    willStartInBrowser: startsInBrowser,
    canResetWithoutCompile,
    resetWithoutCompile,
    startSimulationRef,
    suppressAutoStopOnce: lifecycle.suppressAutoStopOnce,
  };
}
