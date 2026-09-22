import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";
import { type UseMutationResult } from "@tanstack/react-query";
import { Logger } from "@shared/logger";
import type { IOPinRecord, OutputLine, ParserMessage } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import type { DebugMessage } from "@/hooks/use-debug-console";
import { useSimulatorControllerState } from "./use-simulator-controller-state";
import type { IncomingArduinoMessage, CompileConfig, CompileResult, CompilerError } from "@/types/websocket";
import { useUiFeedbackAdapter } from "./use-ui-feedback-adapter";
import { useCompileController } from "./use-compile-controller";
import { useSimulationController } from "./use-simulation-controller";
import { buildCompileCommand, type CompileCommand } from "./compile-command-builder";
import type { SourceProject } from "@shared/source-project";
import type { ServerCapabilities } from "@/lib/server-capabilities";

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
  readonly capabilities?: ServerCapabilities;
  editorRef: RefObject<{ getValue: () => string } | null>;
  tabs: Array<{ id: string; name: string; path?: string; content: string }>;
  activeTabId: string | null;
  code: string;
  /** Synchronously tracks the latest editor value during batched updates. */
  codeRef?: { current: string };
  sourceProject?: SourceProject | null;
  setSerialOutput: SetState<OutputLine[]>;
  clearSerialOutput: () => void;
  setParserMessages: SetState<ParserMessage[]>;
  setParserPanelDismissed: SetState<boolean>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  /** Runtime snapshot setter; null means no snapshot for the current run yet. */
  setIoRegistry: SetState<IOPinRecord[] | null>;
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

type CompileSourceParams = Pick<
  CompileAndRunParams,
  "sourceProject" | "tabs" | "activeTabId" | "editorRef" | "code" | "codeRef"
>;

function resolveCompileCommand(params: CompileSourceParams): CompileCommand {
  if (params.sourceProject) return buildCompileCommand(params.sourceProject);

  if (params.sourceProject === null) {
    if (params.tabs.length === 0) {
      return buildCompileCommand({
        entryFile: "sketch.ino",
        files: {
          "sketch.ino": params.codeRef ? params.codeRef.current : params.code,
        },
      });
    }
    return { code: "", headers: [], entryFile: undefined };
  }

  if (params.activeTabId === params.tabs[0]?.id && params.editorRef.current) {
    let mainSketchCode: string;
    try {
      mainSketchCode = params.editorRef.current.getValue();
    } catch {
      mainSketchCode = params.tabs[0]?.content || params.code;
    }
    return {
      code: mainSketchCode,
      headers: buildCompileCommand(mainSketchCode, params.tabs).headers,
    };
  }

  const mainSketchCode = params.tabs[0]?.content || params.code;
  return {
    code: mainSketchCode,
    headers: buildCompileCommand(mainSketchCode, params.tabs).headers,
  };
}

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
  const controllerState = useSimulatorControllerState();

  // ------------------------------------------------------------
  // UI Feedback Adapter (extrahiert für Schritt 1 von Phase 2.1)
  // ------------------------------------------------------------
  const uiFeedback = useUiFeedbackAdapter({
    toast: params.toast,
    addDebugMessage: params.addDebugMessage,
    triggerErrorGlitch: params.triggerErrorGlitch,
    setCliOutput: controllerState.setCliOutput,
    setPendingPinConflicts: params.setPendingPinConflicts,
  });

  // ------------------------------------------------------------
  // Compile Controller (extrahiert für Schritt 2 von Phase 2.1)
  // ------------------------------------------------------------
  const {
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
    handleClearCompilationOutput,
    clearOutputs,
  } = useCompileController({
    ...controllerState,
    capabilities: params.capabilities,
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
      showBackendUnreachableToast: uiFeedback.showBackendUnreachableToast,
      showCompilationFailedWithErrorsToast: uiFeedback.showCompilationFailedWithErrorsToast,
      showNoCodeToast: uiFeedback.showNoCodeToast,
      setCompileSuccessOutput: uiFeedback.setCompileSuccessOutput,
      setCompileErrorOutput: uiFeedback.setCompileErrorOutput,
    },
    isBackendUnreachableError: params.isBackendUnreachableError,

    // Editor
    editorRef: params.editorRef,
    tabs: params.tabs,
    activeTabId: params.activeTabId,
    code: params.code,
    sourceProject: params.sourceProject,

    // Simulation coordination
    clearSerialOutput: params.clearSerialOutput,
    setSerialOutput: params.setSerialOutput,
  });

  const simulation = useSimulationController({
    code: params.code,
    hasCompilationErrors,
    isModified: params.isModified,
    ensureBackendConnected: params.ensureBackendConnected,
    capabilities: params.capabilities,
    sendMessage: params.sendMessage,
    sendMessageImmediate: params.sendMessageImmediate,
    resetPinUI: params.resetPinUI,
    clearOutputs,
    serialEventQueueRef: params.serialEventQueueRef,
    pendingPinConflicts: params.pendingPinConflicts,
    startSimulationRef: params.startSimulationRef,
    uiFeedback,
  });

  // Expose a test-only setter so E2E tests can inject the REST-compiled code
  // into the simulation controller before starting a simulation.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__ = (code: string, headers: Array<{ name: string; content: string }> = []) => {
        simulation.setCompiledCode(code);
        simulation.setCompiledHeaders?.(headers);
      };
      return () => {
        delete (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__;
      };
    }
  }, [simulation.setCompiledCode]);

  const handleCompileAndStart = useCallback(() => {
    if (
      params.capabilities &&
      (!params.capabilities.canCompile || !params.capabilities.canSimulate)
    ) return;
    if (!params.ensureBackendConnected("Simulation starten")) {
      simulation.setSimulationStatus("idle");
      return;
    }
    params.setDebugMessages([]);

    const { code: mainSketchCode, headers, entryFile } = resolveCompileCommand(params);

    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      uiFeedback.showNoCodeToast();
      return;
    }

    // Build payload
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
    const compilePayload = { code: mainSketchCode, headers, ...(entryFile ? { entryFile } : {}) };
    compileMutation.mutate(compilePayload, {
      onSuccess: (data) => {
        logger.info(`[CLIENT] Compile response: ${JSON.stringify(data, null, 2)}`);

        if (data.success) {
          simulation.setCompiledCode(mainSketchCode);
          simulation.setCompiledHeaders?.(headers);
          simulation.setCompiledEntryFile?.(entryFile);
          simulation.startSimulation();
          simulation.setHasCompiledOnce(true);
          params.setIsModified(false);
        } else {
          setCompilationStatus("error");
          simulation.setSimulationStatus("idle");
          uiFeedback.showCompilationFailedWithErrorsToast();
          scheduleCliIdle(setArduinoCliStatus);
        }
      },
      onError: () => {
        setCompilationStatus("error");
        simulation.setSimulationStatus("idle");
        uiFeedback.showCompilationFailedWithErrorsToast();
        scheduleCliIdle(setArduinoCliStatus);
      },
    });
  }, [params, clearOutputs, compileMutation, simulation, uiFeedback]);

  const handleReset = useCallback(() => {
    if (params.capabilities && !params.capabilities.canSimulate) return;
    if (!params.ensureBackendConnected("Reset simulation")) return;
    if (simulation.simulationStatus === "running") simulation.handleStop();
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
    simulation,
    uiFeedback,
  ]);

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

    simulationStatus: simulation.simulationStatus,
    setSimulationStatus: simulation.setSimulationStatus,
    hasCompiledOnce: simulation.hasCompiledOnce,
    setHasCompiledOnce: simulation.setHasCompiledOnce,
    simulationTimeout: simulation.simulationTimeout,
    setSimulationTimeout: simulation.setSimulationTimeout,
    dockerGccPhase: controllerState.dockerGccPhase,
    setDockerGccPhase: controllerState.setDockerGccPhase,
    startMutation: simulation.startMutation,
    stopMutation: simulation.stopMutation,
    pauseMutation: simulation.pauseMutation,
    resumeMutation: simulation.resumeMutation,
    handleStart: simulation.handleStart,
    handleStop: simulation.handleStop,
    handlePause: simulation.handlePause,
    handleResume: simulation.handleResume,
    handleReset,

    startSimulation: simulation.startSimulation,
    startSimulationRef: simulation.startSimulationRef,
    suppressAutoStopOnce: simulation.suppressAutoStopOnce,
  };
}
