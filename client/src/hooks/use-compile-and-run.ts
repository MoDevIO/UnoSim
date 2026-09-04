import { useCallback, useEffect, useRef } from "react";
import type { RefObject, MutableRefObject } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { Logger } from "@shared/logger";
import { normalizeSimulationTimeout } from "@shared/input-limits";
import type { IOPinRecord, OutputLine, ParserMessage } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";
import type { DebugMessage } from "@/hooks/use-debug-console";
import { useSimulatorControllerState } from "./use-simulator-controller-state";
import type { IncomingArduinoMessage } from "@/types/websocket";
import { useUiFeedbackAdapter } from "./use-ui-feedback-adapter";
import { useCompileController } from "./use-compile-controller";
import type { CompileConfig, CompileResult, CompilerError } from "@/types/websocket";
import { buildCompileCommand } from "./compile-command-builder";

const logger = new Logger("useCompileAndRun");

/** Tracks the Docker/sandbox GCC compile phase for granular UI feedback. */
export type DockerGccPhase = "idle" | "queued" | "active";

/** Arduino CLI status type */
export type CliStatus = "idle" | "compiling" | "success" | "error";

/** Resets Arduino CLI status to idle after the standard 2-second delay. */
function scheduleCliIdle(setArduinoCliStatus: (s: "idle" | "compiling" | "success" | "error") => void) {
  setTimeout(() => {
    setArduinoCliStatus("idle");
  }, 2000);
}

/** Determines where the current code came from (fixes S3776 — extracted from handleCompileAndStart). */
function determineCodeSource(
  editorRef: { current: { getValue: () => string } | null },
  tabs: Array<{ content: string }>,
): "editor" | "tabs" | "state" {
  if (editorRef.current) return "editor";
  if (tabs[0]?.content) return "tabs";
  return "state";
}

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

export type DebugMessageParams = {
  source: "frontend" | "server";
  type: string;
  data: string;
  protocol?: "websocket" | "http";
};

// parameters for compile portion (same as old UseCompilationParams)
export type CompileAndRunParams = {
  editorRef: RefObject<{ getValue: () => string } | null>;
  tabs: Array<{ id: string; name: string; content: string }>;
  activeTabId: string | null;
  code: string;
  setSerialOutput: SetState<OutputLine[]>;
  clearSerialOutput: () => void;
  setParserMessages: SetState<ParserMessage[]>;
  setParserPanelDismissed: SetState<boolean>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  setIoRegistry: SetState<IOPinRecord[]>;
  setIsModified: SetState<boolean>;
  setDebugMessages: SetState<DebugMessage[]>;
  addDebugMessage: (params: DebugMessageParams) => void;
  ensureBackendConnected: (reason: string) => boolean;
  isBackendUnreachableError: (error: unknown) => boolean;
  triggerErrorGlitch: () => void;
  toast: (args: {
    title: string;
    description?: string;
    variant?: "destructive";
  }) => void;

  // simulation-specific inputs (some overlap allowed)
  sendMessage: (message: IncomingArduinoMessage) => void;
  // changed to boolean return so callers know if the frame was actually sent
  sendMessageImmediate?: (message: IncomingArduinoMessage) => boolean;
  serialEventQueueRef: MutableRefObject<Array<{ payload: IncomingArduinoMessage; receivedAt: number }>>;
  pendingPinConflicts: number[];
  setPendingPinConflicts: SetState<number[]>;
  isModified?: boolean; // duplicated with compile side
  handleCompileAndStart?: () => void; // used by reset
  startSimulationRef?: MutableRefObject<(() => void) | null>;
};

interface UseCompileAndRunResult {
  /* compilation state & helpers */
  compilationStatus: CompilationStatus;
  setCompilationStatus: SetState<CompilationStatus>;
  arduinoCliStatus: CliStatus;
  setArduinoCliStatus: SetState<CliStatus>;
  hasCompilationErrors: boolean;
  setHasCompilationErrors: SetState<boolean>;
  compilerErrors: CompilerError[];
  setCompilerErrors: SetState<CompilerError[]>;
  lastCompilationResult: CompilationResultType;
  setLastCompilationResult: SetState<CompilationResultType>;
  cliOutput: string;
  setCliOutput: SetState<string>;
  compileMutation: UseMutationResult<CompileResult, unknown, CompileConfig, unknown>;
  handleCompile: () => void;
  handleCompileAndStart: () => void;
  handleClearCompilationOutput: () => void;
  clearOutputs: () => void;

  /* simulation state & helpers */
  simulationStatus: SimulationStatus;
  setSimulationStatus: SetState<SimulationStatus>;
  hasCompiledOnce: boolean;
  setHasCompiledOnce: SetState<boolean>;
  simulationTimeout: number;
  setSimulationTimeout: SetState<number>;
  /** Docker/sandbox GCC compile phase for granular button feedback. */
  dockerGccPhase: DockerGccPhase;
  setDockerGccPhase: SetState<DockerGccPhase>;
  startMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  stopMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  pauseMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  resumeMutation: UseMutationResult<{ success: boolean }, unknown, void, unknown>;
  handleStart: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleReset: () => void;

  /* compatibility helpers */
  startSimulation: () => void;
  startSimulationRef: MutableRefObject<(() => void) | null>;
  suppressAutoStopOnce: () => void;
}

export function useCompileAndRun(params: CompileAndRunParams): UseCompileAndRunResult {
  // ------------------------------------------------------------
  // shared state (compile + simulation)
  // ------------------------------------------------------------
  const { compilationStatus, setCompilationStatus, arduinoCliStatus, setArduinoCliStatus,
    hasCompilationErrors, setHasCompilationErrors, lastCompilationResult,
    setLastCompilationResult, cliOutput, setCliOutput, compilerErrors, setCompilerErrors,
    simulationStatus, setSimulationStatus, hasCompiledOnce, setHasCompiledOnce,
    simulationTimeout, setSimulationTimeout, dockerGccPhase, setDockerGccPhase,
  } = useSimulatorControllerState();

  // ------------------------------------------------------------
  // UI Feedback Adapter (extrahiert für Schritt 1 von Phase 2.1)
  // ------------------------------------------------------------
  const uiFeedback = useUiFeedbackAdapter({
    toast: params.toast,
    addDebugMessage: params.addDebugMessage,
    triggerErrorGlitch: params.triggerErrorGlitch,
    setCliOutput,
    setPendingPinConflicts: params.setPendingPinConflicts,
  });

  // ------------------------------------------------------------
  // Compile Controller (extrahiert für Schritt 2 von Phase 2.1)
  // ------------------------------------------------------------
  const {
    compileMutation,
    handleCompile,
    handleClearCompilationOutput,
    clearOutputs,
  } = useCompileController({
    // State
    compilationStatus,
    setCompilationStatus,
    arduinoCliStatus,
    setArduinoCliStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
    compilerErrors,
    setCompilerErrors,
    lastCompilationResult,
    setLastCompilationResult,
    cliOutput,
    setCliOutput,

    // Callbacks
    setParserMessages: params.setParserMessages,
    setParserPanelDismissed: params.setParserPanelDismissed,
    setIoRegistry: params.setIoRegistry,
    setIsModified: params.setIsModified,
    resetPinUI: params.resetPinUI,

    // UI Feedback
    uiFeedback: {
      logCompileRequest: uiFeedback.logCompileRequest,
      logCompilationSuccess: uiFeedback.logCompilationSuccess,
      logCompilationError: uiFeedback.logCompilationError,
      triggerCompileErrorGlitch: uiFeedback.triggerCompileErrorGlitch,
      showCompileSuccessToast: uiFeedback.showCompileSuccessToast,
      showCompileErrorToast: uiFeedback.showCompileErrorToast,
      showCompilationFailedWithErrorsToast: uiFeedback.showCompilationFailedWithErrorsToast,
      showNoCodeToast: uiFeedback.showNoCodeToast,
      setCompileSuccessOutput: uiFeedback.setCompileSuccessOutput,
      setCompileErrorOutput: uiFeedback.setCompileErrorOutput,
    },

    // Editor
    editorRef: params.editorRef,
    tabs: params.tabs,
    activeTabId: params.activeTabId,
    code: params.code,

    // Simulation coordination
    clearSerialOutput: params.clearSerialOutput,
    setSerialOutput: params.setSerialOutput,
  });

  // refs used internally
  /** Stores the last successfully compiled code so start_simulation can send it per-client. */
  const lastCompiledCodeRef = useRef<string | null>(null);

  // Expose a test-only setter so E2E tests can inject the REST-compiled code
  // into this ref, ensuring start_simulation always sends code per-client and
  // avoids races with the shared server-side lastCompiledCode.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__ = (code: string) => {
        lastCompiledCodeRef.current = code;
      };
      return () => {
        delete (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__;
      };
    }
  }, []);

  // ensure we offer a ref to caller
  const internalStartRef = useRef<(() => void) | null>(null);
  const startSimulationRef = params.startSimulationRef ?? internalStartRef;

  // ─── Simulation control mutations ─────────────────────────────────────────

  const stopMutation = useMutation({
    mutationFn: async () => {
      uiFeedback.logStopSimulation();
      const immediate = params.sendMessageImmediate ?? undefined;
      if (immediate) immediate({ type: "stop_simulation" });
      else params.sendMessage({ type: "stop_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("idle");
      params.serialEventQueueRef.current = [];
      params.resetPinUI({ keepDetected: true });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      uiFeedback.logPauseSimulation();
      params.sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("paused");
    },
    onError: () => {
      uiFeedback.showPauseFailedToast();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      uiFeedback.logResumeSimulation();
      params.sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
    },
    onError: () => {
      uiFeedback.showResumeFailedToast();
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const timeout = normalizeSimulationTimeout(simulationTimeout);
      logger.debug(`[CLIENT] startMutation invoked, simulationTimeout=${timeout}`);
      params.resetPinUI({ keepDetected: true });

      // Build the start message with per-client code for multi-instance isolation
      const startMsg: { type: "start_simulation"; timeout: number; code?: string } = {
        type: "start_simulation",
        timeout,
      };
      if (lastCompiledCodeRef.current) {
        startMsg.code = lastCompiledCodeRef.current;
      }

      uiFeedback.logStartSimulation(timeout, !!lastCompiledCodeRef.current);
      // Use immediate send for start_simulation when available to ensure
      // WS frame is emitted deterministically for E2E tests and real-time control.
      if (typeof params.sendMessageImmediate === "function") {
        const sent = params.sendMessageImmediate(startMsg);
        logger.debug(`[CLIENT] sendMessageImmediate returned ${String(sent)}`);
        // If immediate send failed (socket not open) fall back to buffered send
        if (!sent) {
          logger.debug("[CLIENT] falling back to buffered send for start_simulation");
          uiFeedback.logStartSimulationFallback();
          params.sendMessage(startMsg);
        }
      } else {
        logger.debug("[CLIENT] using buffered send for start_simulation (no immediate available)");
        params.sendMessage(startMsg);
      }
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
      uiFeedback.showSimulationStartedToast();
      try {
        if (params.pendingPinConflicts && params.pendingPinConflicts.length > 0) {
          uiFeedback.showPinConflictWarning(params.pendingPinConflicts);
        }
      } catch { }
    },
    onError: (error: unknown) => {
      const message = uiFeedback.extractErrorMessage(error);
      uiFeedback.showStartFailedToast(message);
      if (params.isModified && hasCompiledOnce) {
        uiFeedback.showCodeModifiedToast();
      }
    },
  });

  // internal start function used by compilation success handler
  const startSimulationInternal = useCallback(() => {
    startMutation.mutate();
  }, [startMutation]);

  startSimulationRef.current = startSimulationInternal;

  const handleCompileAndStart = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation starten")) {
      setSimulationStatus("idle");
      return;
    }
    params.setDebugMessages([]);

    // Extract code
    let mainSketchCode: string;
    if (params.activeTabId === params.tabs[0]?.id && params.editorRef.current) {
      try {
        mainSketchCode = params.editorRef.current.getValue();
      } catch {
        mainSketchCode = params.tabs[0]?.content || params.code;
      }
    } else {
      mainSketchCode = params.tabs[0]?.content || params.code;
    }

    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      uiFeedback.showNoCodeToast();
      return;
    }

    // Build payload
    const { headers } = buildCompileCommand(mainSketchCode, params.tabs);
    logger.info(`[CLIENT] Compile & Start with ${headers.length} headers`);
    logger.info(`[CLIENT] Code length: ${mainSketchCode.length} bytes`);

    // Determine code source (editor > tabs > state)
    const codeSource = determineCodeSource(params.editorRef, params.tabs);
    logger.info(`[CLIENT] Main code from: ${codeSource}`);
    logger.info(
      `[CLIENT] Tabs: ${params.tabs
        .map((t) => `${t.name}(${t.content.length}b)`)
        .join(", ")}`,
    );

    // Clear and prepare
    clearOutputs();
    params.resetPinUI();
    setCompilationStatus("compiling");

    // Compile with custom handlers for compile + start flow
    compileMutation.mutate({ code: mainSketchCode, headers }, {
      onSuccess: (data) => {
        logger.info(`[CLIENT] Compile response: ${JSON.stringify(data, null, 2)}`);

        if (data.success) {
          lastCompiledCodeRef.current = mainSketchCode;
          (startSimulationRef.current ?? startSimulationInternal)();
          setCompilationStatus("success");
          setHasCompiledOnce(true);
          params.setIsModified(false);
          scheduleCliIdle(setArduinoCliStatus);
        } else {
          setCompilationStatus("error");
          setSimulationStatus("idle");
          uiFeedback.showCompilationFailedWithErrorsToast();
          scheduleCliIdle(setArduinoCliStatus);
        }
      },
      onError: () => {
        setCompilationStatus("error");
        setSimulationStatus("idle");
        uiFeedback.showCompilationFailedWithErrorsToast();
        scheduleCliIdle(setArduinoCliStatus);
      },
    });
  }, [
    params,
    clearOutputs,
    compileMutation,
    startSimulationInternal,
    startSimulationRef,
    uiFeedback,
  ]);

  const handleStart = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation starten")) return;
    startMutation.mutate();
  }, [params.ensureBackendConnected, startMutation]);

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

  const handleReset = useCallback(() => {
    if (!params.ensureBackendConnected("Reset simulation")) return;
    if (simulationStatus === "running") {
      params.sendMessage({ type: "stop_simulation" });
      setSimulationStatus("idle");
    }
    clearOutputs();
    params.resetPinUI({ keepDetected: true });

    uiFeedback.showResettingToast();

    setTimeout(() => {
      handleCompileAndStart();
    }, 100);
  }, [
    clearOutputs,
    params.ensureBackendConnected,
    handleCompileAndStart,
    params.resetPinUI,
    params.sendMessage,
    simulationStatus,
    uiFeedback,
  ]);

  // lifecycle automation (reuse earlier hook)
  const { suppressAutoStopOnce } = useSimulationLifecycle({
    code: params.code,
    simulationStatus,
    setSimulationStatus,
    sendMessage: params.sendMessage,
    resetPinUI: params.resetPinUI,
    clearOutputs,
    handlePause,
    handleResume,
    handleReset,
    hasCompilationErrors,
  });

  return {
    compilationStatus,
    setCompilationStatus,
    arduinoCliStatus,
    setArduinoCliStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
    compilerErrors,
    setCompilerErrors,
    lastCompilationResult,
    setLastCompilationResult,
    cliOutput,
    setCliOutput,
    compileMutation,
    handleCompile,
    handleCompileAndStart,
    handleClearCompilationOutput,
    clearOutputs,

    simulationStatus,
    setSimulationStatus,
    hasCompiledOnce,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
    dockerGccPhase,
    setDockerGccPhase,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleReset,

    startSimulation: startSimulationInternal,
    startSimulationRef,
    suppressAutoStopOnce,
  };
}
