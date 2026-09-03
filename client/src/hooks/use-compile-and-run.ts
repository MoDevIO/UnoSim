import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, MutableRefObject } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Logger } from "@shared/logger";
import type { IOPinRecord, OutputLine, ParserMessage } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";
import type { DebugMessage } from "@/hooks/use-debug-console";
import {
  isCompileResult,
  isHexResult,
} from "@/types/websocket";
import type {
  CompileConfig,
  CompileResult,
  CompilerError,
  HexResult,
  IncomingArduinoMessage,
} from "@/types/websocket";

const logger = new Logger("useCompileAndRun");

/** Tracks the Docker/sandbox GCC compile phase for granular UI feedback. */
export type DockerGccPhase = "idle" | "queued" | "active";

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

// reused helpers from previous hooks
type CliStatus = "idle" | "compiling" | "success" | "error";

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
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("ready");
  const [arduinoCliStatus, setArduinoCliStatus] = useState<CliStatus>("idle");
  // gccStatus removed - compiler results are tracked via errors array & flags
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<CompilationResultType>(null);
  const [cliOutput, setCliOutput] = useState("");
  const [compilerErrors, setCompilerErrors] = useState<CompilerError[]>([]);

  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("idle");
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);
  /** Tracks the Docker/sandbox GCC compile phase for granular button feedback. */
  const [dockerGccPhase, setDockerGccPhase] = useState<DockerGccPhase>("idle");

  // refs used internally
  const doUploadOnCompileSuccessRef = useRef(false);
  const lastCompilePayloadRef = useRef<{ code: string; headers?: Array<{ name: string; content: string }> } | null>(null);
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

  const clearOutputs = useCallback(() => {
    setCliOutput("");
    params.setSerialOutput([]);
    params.clearSerialOutput();
    params.setParserMessages([]);
  }, [params]);

  // upload mutation used by compile success
  const uploadMutation = useMutation<HexResult, unknown, CompileConfig, unknown>({
    mutationFn: async (payload: CompileConfig): Promise<HexResult> => {
      params.addDebugMessage({
        source: "frontend",
        type: "upload_request",
        data: JSON.stringify({ endpoint: "POST /api/upload", codeLength: payload.code.length }, null, 2),
        protocol: "http",
      });
      const response = await apiRequest("POST", "/api/upload", payload);
      const ct = (response.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("application/json")) {
        try {
          const parsed = await response.json();
          return isHexResult(parsed) ? parsed : { success: response.ok, raw: JSON.stringify(parsed) };
        } catch {
          const txt = await response.text();
          return { success: response.ok, raw: txt };
        }
      }

      const txt = await response.text();
      return { success: response.ok, raw: txt };
    },
    onSuccess: (data) => {
      if (data.success) {
        params.toast({
          title: "Upload started",
          description: "Upload initiated to connected device.",
        });
        return;
      }

      const txt = (data.raw ?? "").trim();
      if (txt.length === 0) {
        params.toast({
          title: "Upload started",
          description: "Upload initiated to connected device.",
        });
        return;
      }

      params.toast({
        title: "Upload response",
        description: txt.slice(0, 200),
      });
    },
    onError: (err: unknown) => {
      const backendDown = params.isBackendUnreachableError(err);
      const message = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
      params.toast({
        title: backendDown ? "Backend unreachable" : "Upload failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : message || "Upload failed",
        variant: "destructive",
      });
    },
    onSettled: () => {
      try {
        doUploadOnCompileSuccessRef.current = false;
        lastCompilePayloadRef.current = null;
      } catch { }
    },
  });

  // simple compile mutation (callbacks moved to handlers above)
  const compileMutation = useMutation<CompileResult, unknown, CompileConfig, unknown>({
    mutationFn: async (payload: CompileConfig): Promise<CompileResult> => {
      setArduinoCliStatus("compiling");
      setLastCompilationResult(null);
      params.addDebugMessage({
        source: "frontend",
        type: "compile_request",
        data: JSON.stringify({ endpoint: "POST /api/compile", codeLength: payload.code.length }, null, 2),
        protocol: "http",
      });
      const response = await apiRequest("POST", "/api/compile", payload);
      const ct = (response.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("application/json")) {
        try {
          const parsed = await response.json();
          return isCompileResult(parsed)
            ? parsed
            : { success: false, errors: JSON.stringify(parsed), raw: JSON.stringify(parsed) };
        } catch {
          const txt = await response.text();
          return { success: false, errors: txt, raw: txt };
        }
      }

      const txt = await response.text();
      return { success: false, errors: txt, raw: txt };
    },
    onSuccess: (data) => {
      if (data.success) {
        handleCompileSuccess(data);
      } else {
        handleCompileError(data);
      }
    },
    onError: (error: unknown) => {
      setArduinoCliStatus("error");
      params.triggerErrorGlitch();
      const backendDown = params.isBackendUnreachableError(error);
      params.toast({
        title: backendDown ? "Backend unreachable" : "Compilation with Arduino-CLI Failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : "There were errors in your sketch",
        variant: "destructive",
      });
    },
  });

  // ─── Compilation response handlers ───────────────────────────────────────

  /**
   * Handle successful compilation: update state, show toast, handle upload queue
   */
  const handleCompileSuccess = useCallback(
    (data: CompileResult) => {
      setArduinoCliStatus("success");
      setHasCompilationErrors(false);
      setLastCompilationResult("success");
      setCompilerErrors([]);
      setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
      params.addDebugMessage({
        source: "server",
        type: "compilation_status",
        data: JSON.stringify({ success: true }, null, 2),
        protocol: "http",
      });
      params.setParserMessages(data.parserMessages ?? []);
      if (data.parserMessages && data.parserMessages.length > 0) {
        params.setParserPanelDismissed(false);
      }
      params.toast({
        title: "Arduino-CLI Compilation succeeded",
        description: "Your sketch has been compiled successfully",
      });

      // Handle queued upload
      if (doUploadOnCompileSuccessRef.current && data.success) {
        const payload = lastCompilePayloadRef.current;
        if (payload) {
          logger.info(`[CLIENT] Uploading compiled artifact... ${JSON.stringify(payload)}`);
          uploadMutation.mutate(payload);
        } else {
          params.toast({
            title: "Upload failed",
            description: "No compiled artifact available to upload.",
            variant: "destructive",
          });
        }
      }
      doUploadOnCompileSuccessRef.current = false;
    },
    [params, uploadMutation],
  );

  /**
   * Handle compilation errors: extract error details, show toast
   */
  const handleCompileError = useCallback(
    (data: CompileResult) => {
      setArduinoCliStatus("error");
      setHasCompilationErrors(true);
      setLastCompilationResult("error");
      let errs: CompilerError[] = [];
      let errText = "";

      if (Array.isArray(data.errors)) {
        errs = data.errors;
        errText = errs
          .map((e) => {
            const lineStr = e.line ? `:${e.line}` : "";
            const columnStr = e.column ? `:${e.column}` : "";
            const location = `${e.file}${lineStr}${columnStr}`;
            return `${location} ${e.type}: ${e.message}`;
          })
          .join("\n");
      } else if (typeof data.errors === "string") {
        errs = [{ file: "", line: 0, column: 0, type: "error", message: data.errors }];
        errText = data.errors;
      }

      setCompilerErrors(errs);
      params.triggerErrorGlitch();
      setCliOutput(errText || "✗ Arduino-CLI Compilation failed.");
      params.addDebugMessage({
        source: "server",
        type: "compilation_error",
        data: JSON.stringify({ type: "compilation_error", data: data.errors }, null, 2),
        protocol: "http",
      });
      params.addDebugMessage({
        source: "server",
        type: "compilation_status",
        data: JSON.stringify({ success: false }, null, 2),
        protocol: "http",
      });
      params.setParserMessages(data.parserMessages ?? []);
      if (data.parserMessages && data.parserMessages.length > 0) {
        params.setParserPanelDismissed(false);
      }
      params.toast({
        title: "Arduino-CLI Compilation failed",
        description: "There were errors in your sketch",
        variant: "destructive",
      });
      doUploadOnCompileSuccessRef.current = false;
    },
    [params],
  );

  // ─── Simulation control mutations ─────────────────────────────────────────

  const stopMutation = useMutation({
    mutationFn: async () => {
      params.addDebugMessage({
        source: "frontend",
        type: "stop_simulation",
        data: JSON.stringify({ type: "stop_simulation" }, null, 2),
        protocol: "websocket",
      });
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
      params.addDebugMessage({
        source: "frontend",
        type: "pause_simulation",
        data: JSON.stringify({ type: "pause_simulation" }, null, 2),
        protocol: "websocket",
      });
      params.sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("paused");
    },
    onError: () => {
      params.toast({
        title: "Pause failed",
        description: "Could not pause simulation",
        variant: "destructive",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      params.addDebugMessage({
        source: "frontend",
        type: "resume_simulation",
        data: JSON.stringify({ type: "resume_simulation" }, null, 2),
        protocol: "websocket",
      });
      params.sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
    },
    onError: () => {
      params.toast({
        title: "Resume failed",
        description: "Could not resume simulation",
        variant: "destructive",
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      logger.debug(`[CLIENT] startMutation invoked, simulationTimeout=${simulationTimeout}`);
      params.resetPinUI({ keepDetected: true });

      // Build the start message with per-client code for multi-instance isolation
      const startMsg: { type: "start_simulation"; timeout: number; code?: string } = {
        type: "start_simulation",
        timeout: simulationTimeout,
      };
      if (lastCompiledCodeRef.current) {
        startMsg.code = lastCompiledCodeRef.current;
      }

      params.addDebugMessage({
        source: "frontend",
        type: "start_simulation",
        data: JSON.stringify(startMsg, null, 2),
        protocol: "websocket",
      });
      // Use immediate send for start_simulation when available to ensure
      // WS frame is emitted deterministically for E2E tests and real-time control.
      if (typeof params.sendMessageImmediate === "function") {
        const sent = params.sendMessageImmediate(startMsg);
        logger.debug(`[CLIENT] sendMessageImmediate returned ${String(sent)}`);
        // If immediate send failed (socket not open) fall back to buffered send
        if (!sent) {
          logger.debug("[CLIENT] falling back to buffered send for start_simulation");
          params.addDebugMessage({ source: "frontend", type: "start_simulation", data: "Immediate send failed, falling back to buffered send", protocol: "websocket" });
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
      params.toast({
        title: "Simulation Started",
        description: "Arduino simulation is now running",
      });
      try {
        if (params.pendingPinConflicts && params.pendingPinConflicts.length > 0) {
          const names = params.pendingPinConflicts
            .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
            .join(", ");
          setCliOutput(
            (prev) =>
              (prev ? prev + "\n\n" : "") +
              `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`,
          );
          params.setPendingPinConflicts([]);
        }
      } catch { }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
      params.toast({
        title: "Start Failed",
        description: message || "Could not start simulation",
        variant: "destructive",
      });
      if (params.isModified && hasCompiledOnce) {
        params.toast({
          title: "Code Modified",
          description: "Compile to apply your latest changes",
        });
      }
    },
  });

  // internal start function used by compilation success handler
  const startSimulationInternal = useCallback(() => {
    startMutation.mutate();
  }, [startMutation]);

  startSimulationRef.current = startSimulationInternal;

  // ─── Helper functions for compile and start ─────────────────────────────

  /**
   * Extract main sketch code from editor, tabs, or state (in priority order)
   */
  const extractMainSketchCode = useCallback((): string => {
    if (params.editorRef.current) {
      try {
        return params.editorRef.current.getValue();
      } catch (error) {
        console.error("[CLIENT] Error getting code from editor:", error);
        // Fall through to tabs/code fallback
      }
    }

    if (params.tabs.length > 0 && params.tabs[0]?.content) {
      return params.tabs[0].content;
    }

    return params.code || "";
  }, [params.code, params.editorRef, params.tabs]);

  /**
   * Build compile payload with code + headers
   */
  const buildCompilePayload = useCallback(
    (mainSketchCode: string) => {
      const headers = params.tabs.slice(1).map((tab) => ({
        name: tab.name,
        content: tab.content,
      }));
      return { code: mainSketchCode, headers };
    },
    [params.tabs],
  );

  /**
   * Initialize IO registry with empty pin records
   */
  const initializeEmptyRegistry = useCallback(() => {
    const pins: IOPinRecord[] = [];
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    params.setIoRegistry(pins);
  }, [params]);

  // ─── Compile handlers ────────────────────────────────────────────────────

  const handleCompile = useCallback(() => {
    clearOutputs();
    params.resetPinUI();
    initializeEmptyRegistry();

    let mainSketchCode: string;
    if (params.activeTabId === params.tabs[0]?.id && params.editorRef.current) {
      mainSketchCode = params.editorRef.current.getValue();
    } else {
      mainSketchCode = params.tabs[0]?.content || params.code;
    }

    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      params.toast({
        title: "No Code",
        description: "Please write some code before compiling",
        variant: "destructive",
      });
      return;
    }

    const headers = params.tabs.slice(1).map((tab) => ({
      name: tab.name,
      content: tab.content,
    }));
    logger.info(`[CLIENT] Compiling with ${headers.length} headers`);
    lastCompilePayloadRef.current = { code: mainSketchCode, headers };
    compileMutation.mutate({ code: mainSketchCode, headers });
  }, [
    params.activeTabId,
    clearOutputs,
    params.code,
    compileMutation,
    params.editorRef,
    params.resetPinUI,
    params.tabs,
    initializeEmptyRegistry,
  ]);

  const handleCompileAndStart = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation starten")) {
      // Backend not reachable — reset any pending "queued" state so the badge
      // doesn't get stuck in QUEUED_FOR_SIMULATION forever.
      setSimulationStatus("idle");
      return;
    }
    params.setDebugMessages([]);

    // Extract code
    const mainSketchCode = extractMainSketchCode();
    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      params.toast({
        title: "No Code",
        description: "Please write some code before compiling",
        variant: "destructive",
      });
      return;
    }

    // Build payload
    const payload = buildCompilePayload(mainSketchCode);
    logger.info(`[CLIENT] Compile & Start with ${payload.headers.length} headers`);
    logger.info(`[CLIENT] Code length: ${mainSketchCode.length} bytes`);

    // Determine code source (editor > tabs > state) — helper is module-level (fixes S3776)
    const codeSource = determineCodeSource(params.editorRef, params.tabs);
    logger.info(`[CLIENT] Main code from: ${codeSource}`);
    logger.info(
      `[CLIENT] Tabs: ${params.tabs
        .map((t) => `${t.name}(${t.content.length}b)`)
        .join(", ")}`,
    );

    // Clear and prepare
    clearOutputs();
    setCompilationStatus("compiling");
    setArduinoCliStatus("compiling");

    // Compile with custom handlers for compile + start flow
    compileMutation.mutate(payload, {
      onSuccess: (data) => {
        logger.info(`[CLIENT] Compile response: ${JSON.stringify(data, null, 2)}`);

        if (data.success) {
          lastCompiledCodeRef.current = mainSketchCode;
          initializeEmptyRegistry();
          (startSimulationRef.current ?? startSimulationInternal)();
          setCompilationStatus("success");
          setHasCompiledOnce(true);
          params.setIsModified(false);
          scheduleCliIdle(setArduinoCliStatus);
        } else {
          handleCompileError(data);
          setCompilationStatus("error");
          // Reset any pending "queued" simulationStatus so the badge doesn't
          // get stuck in QUEUED_FOR_SIMULATION after a compile failure.
          setSimulationStatus("idle");
          params.toast({
            title: "Compilation Completed with Errors",
            description: "Simulation will not start due to compilation errors.",
            variant: "destructive",
          });
          scheduleCliIdle(setArduinoCliStatus);
        }
      },
      onError: () => {
        setCompilationStatus("error");
        setArduinoCliStatus("error");
        // Reset any pending "queued" simulationStatus so the badge doesn't
        // get stuck in QUEUED_FOR_SIMULATION after a network/compile error.
        setSimulationStatus("idle");
        params.toast({
          title: "Compilation Failed",
          description: "Simulation will not start due to compilation errors.",
          variant: "destructive",
        });
        scheduleCliIdle(setArduinoCliStatus);
      },
    });
  }, [
    params,
    extractMainSketchCode,
    buildCompilePayload,
    clearOutputs,
    compileMutation,
    startSimulationInternal,
    startSimulationRef,
    initializeEmptyRegistry,
    handleCompileError,
  ]);

  const handleClearCompilationOutput = useCallback(() => {
    setCliOutput("");
    setLastCompilationResult(null);
    params.setParserMessages([]);
  }, [setCliOutput, setLastCompilationResult, params.setParserMessages]);

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

    params.toast({
      title: "Resetting...",
      description: "Recompiling and restarting simulation",
    });

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
    params.toast,
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
