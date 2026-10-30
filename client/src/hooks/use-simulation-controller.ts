import { useCallback, useRef } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { Logger } from "@shared/logger";
import { normalizeSimulationTimeout } from "@shared/input-limits";
import { sketchSerialBaud } from "@shared/parser-patterns";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { IncomingArduinoMessage } from "@/types/websocket";
import { useSimulationControllerState } from "./use-simulation-controller-state";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";
import type { UseUiFeedbackAdapterResult } from "./use-ui-feedback-adapter";
import type { ServerCapabilities } from "@/lib/server-capabilities";
import type { BoardId, RuntimeKind } from "@shared/boards";
import type { SimulationArtifact } from "@shared/simulation-artifact";
import { getRuntimeHub, type RuntimeHub } from "@/lib/runtime/runtime-hub";

const logger = new Logger("useSimulationController");

export type SimulationControllerParams = {
  readonly capabilities?: ServerCapabilities;
  /** Synchronously relinquish pending REST compile-to-start ownership. */
  onStartOrStop?: () => void;
  /** The runtime of the next run (plan P3.1 selection); the host mock when not given. */
  runtimeKind?: RuntimeKind;
  /** Why the project's libraries may not run with this board and engine (SSOT Libraries §9); blocks every start. */
  startBlockReason?: () => string | undefined;
  /** The host mock can take over when the browser emulation has no image to run. */
  hostMockUsable?: boolean;
  /** The selected board: the worker refuses an image built for another one. */
  board?: BoardId;
  /** The runtimes of this tab; the shared hub when not given. */
  runtimeHub?: Pick<RuntimeHub, "load" | "peek" | "active" | "setActive">;
  code: string;
  /** The content of every file of the project: an edit of any of them stops the run, opening another tab does not. */
  sourceSignature?: string;
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
  /** Cancels a browser start that is still loading the emulator (Stop does it itself). */
  cancelPendingStart: () => void;
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
  /**
   * Identifies the start in flight. A browser start waits for the emulator code to load; Stop, a new
   * workspace or a discarded build in that time cancel it by taking the next number.
   */
  const startToken = useRef(0);
  const cancelPendingStart = useCallback(() => {
    startToken.current++;
  }, []);
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
    params.uiFeedback.logStopSimulation(hub.active);
    cancelPendingStart();
    const message = { type: "stop_simulation" } as const;
    if (!(params.sendMessageImmediate?.(message) ?? false)) params.sendMessage(message);
    setSimulationStatus("idle");
    params.serialEventQueueRef.current = [];
    params.resetPinUI({ keepDetected: true });
  }, [canSimulate, params, setSimulationStatus, cancelPendingStart]);

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
      params.uiFeedback.logPauseSimulation(hub.active);
      const browser = browserRunActive();
      params.sendMessage({ type: "pause_simulation" });
      return { success: true, browser };
    },
    // A browser run reports its state once the worker confirmed it (SimulationRuntime SSOT); the
    // worker ignores a pause before its run is confirmed, so the UI must not claim it early.
    onSuccess: ({ browser }) => {
      if (!browser) setSimulationStatus("paused");
    },
    onError: () => params.uiFeedback.showPauseFailedToast(),
  });

  const resumeMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      params.uiFeedback.logResumeSimulation(hub.active);
      const browser = browserRunActive();
      params.sendMessage({ type: "resume_simulation" });
      return { success: true, browser };
    },
    onSuccess: ({ browser }) => {
      if (!browser) setSimulationStatus("running");
    },
    onError: () => params.uiFeedback.showResumeFailedToast(),
  });

  /** Loads the emulator on demand and starts the run, unless Stop, a new start or a discarded build ended this start meanwhile. */
  const startBrowserRun = async (token: number, compiledArtifact: unknown, timeout: number) => {
    // The schema and the runtime load on demand: they stay out of the initial bundle.
    const { parseSimulationArtifact } = await import("@shared/simulation-artifact");
    const artifact = parseSimulationArtifact(compiledArtifact);
    if (!artifact) throw new Error("The latest build has no image for the browser emulation. Compile again.");
    const runtime = await hub.load("browser");
    if (token !== startToken.current) return { success: true, browser: true, cancelled: true };
    // Start first: replacing a run reports the old one stopped, which must not end the new one.
    const serialBaud = sketchSerialBaud(compiledCodeRef.current ?? "");
    runtime.start({
      kind: "browser", artifact, ...(params.board ? { board: params.board } : {}), timeoutSec: timeout,
      ...(serialBaud === undefined ? {} : { serialBaud }),
    });
    hub.setActive("browser");
    // Pending until the worker confirms the run, which takes a message round trip: the runtime then
    // reports `running` (or `stopped`). Set after start, which reports a replaced run stopped at once.
    setSimulationStatus("queued");
    return { success: true, browser: true, cancelled: false };
  };

  const startMutation = useMutation({
    // These mutations send WebSocket messages or call the browser runtime, never HTTP: a browser run must
    // stay controllable when the browser reports being offline (networkMode "online" would pause them).
    networkMode: "always",
    mutationFn: async () => {
      const token = ++startToken.current;
      // The build this start is made for: a later build or a discarded one does not change what it runs.
      const compiledArtifact = compiledArtifactRef.current;
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

      params.uiFeedback.logStartSimulation(timeout, !!compiledCodeRef.current, startsInBrowser() ? "browser" : "host-mock", compiledArtifact);
      if (startsInBrowser()) return startBrowserRun(token, compiledArtifact, timeout);
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
      return { success: true, browser: false, cancelled: false };
    },
    onSuccess: ({ browser, cancelled }) => {
      if (cancelled) return;
      if (!browser) setSimulationStatus("running");
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
    const blocked = params.startBlockReason?.();
    if (blocked) {
      params.uiFeedback.showStartFailedToast(blocked);
      return;
    }
    if (!startsInBrowser() && !params.ensureBackendConnected("Simulation starten")) return;
    startSimulation();
  }, [canSimulate, params.ensureBackendConnected, startSimulation, params.onStartOrStop, params.startBlockReason, params.uiFeedback]);
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
    ...(params.sourceSignature === undefined ? {} : { sourceSignature: params.sourceSignature }),
    isStartingInBrowser: browserRunActive,
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
    cancelPendingStart,
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
