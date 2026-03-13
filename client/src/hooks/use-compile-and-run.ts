import { useCallback, useRef, useState } from "react";

// Local copy of the structured error type returned from backend
interface CompilationError {
  file: string;
  line: number;
  column: number;
  type: "error" | "warning";
  message: string;
}
import type { RefObject, MutableRefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Logger } from "@shared/logger";
import type { IOPinRecord, ParserMessage } from "@shared/schema";
import { useSimulationLifecycle } from "./use-simulation-lifecycle";

// status types
type CompilationStatus = "ready" | "compiling" | "success" | "error";

const logger = new Logger("useCompileAndRun");

// reused helpers from previous hooks
type SimulationStatus = "running" | "stopped" | "paused";
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
  setSerialOutput: SetState<any[]>;
  clearSerialOutput: () => void;
  setParserMessages: SetState<ParserMessage[]>;
  setParserPanelDismissed: SetState<boolean>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  setIoRegistry: SetState<IOPinRecord[]>;
  setIsModified: SetState<boolean>;
  setDebugMessages: SetState<any[]>;
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
  sendMessage: (message: any) => void;
  // changed to boolean return so callers know if the frame was actually sent
  sendMessageImmediate?: (message: any) => boolean;
  serialEventQueueRef: MutableRefObject<Array<{ payload: any; receivedAt: number }>>;
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
  compilerErrors: CompilationError[];
  setCompilerErrors: SetState<CompilationError[]>;
  lastCompilationResult: "success" | "error" | null;
  setLastCompilationResult: SetState<"success" | "error" | null>;
  cliOutput: string;
  setCliOutput: SetState<string>;
  compileMutation: any;
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
  startMutation: any;
  stopMutation: any;
  pauseMutation: any;
  resumeMutation: any;
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
  const [compilationStatus, setCompilationStatus] = useState<"ready" | "compiling" | "success" | "error">("ready");
  const [arduinoCliStatus, setArduinoCliStatus] = useState<CliStatus>("idle");
  // gccStatus removed - compiler results are tracked via errors array & flags
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<"success" | "error" | null>(null);
  const [cliOutput, setCliOutput] = useState("");
  const [compilerErrors, setCompilerErrors] = useState<CompilationError[]>([]);

  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("stopped");
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);

  // refs used internally
  const doUploadOnCompileSuccessRef = useRef(false);
  const lastCompilePayloadRef = useRef<{ code: string; headers?: Array<{ name: string; content: string }> } | null>(null);

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
  const uploadMutation = useMutation({
    mutationFn: async (payload: { code: string; headers?: Array<{ name: string; content: string }> }) => {
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
          return await response.json();
        } catch {
          const txt = await response.text();
          return { success: response.ok, raw: txt } as any;
        }
      }
      const txt = await response.text();
      return { success: response.ok, raw: txt } as any;
    },
    onSuccess: (data) => {
      if (data && (data as any).success) {
        params.toast({
          title: "Upload started",
          description: "Upload initiated to connected device.",
        });
      } else if (data && typeof (data as any).raw === "string") {
        const txt = String((data as any).raw || "").trim();
        if (txt.length === 0) {
          params.toast({
            title: "Upload started",
            description: "Upload initiated to connected device.",
          });
        } else {
          params.toast({ title: "Upload response", description: txt.slice(0, 200) });
        }
      } else {
        params.toast({
          title: "Upload failed",
          description:
            data && (data as any).error
              ? (data as any).error
              : "Upload did not succeed.",
          variant: "destructive",
        });
      }
    },
    onError: (err) => {
      const backendDown = params.isBackendUnreachableError(err);
      params.toast({
        title: backendDown ? "Backend unreachable" : "Upload failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : (err as Error)?.message || "Upload failed",
        variant: "destructive",
      });
    },
    onSettled: () => {
      try {
        doUploadOnCompileSuccessRef.current = false;
        lastCompilePayloadRef.current = null;
      } catch {}
    },
  });

  // ------------------------------------------------------------
  // compile mutation (core behaviour same as old hook)
  // ------------------------------------------------------------
  const compileMutation = useMutation({
    mutationFn: async (payload: { code: string; headers?: Array<{ name: string; content: string }> }) => {
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
          return await response.json();
        } catch {
          const txt = await response.text();
          return { success: false, errors: txt, raw: txt } as any;
        }
      }
      const txt = await response.text();
      return { success: false, errors: txt, raw: txt } as any;
    },
    onSuccess: (data) => {
      if (data.success) {
        setArduinoCliStatus("success");
        setHasCompilationErrors(false);
        setLastCompilationResult("success");
        setCompilerErrors([]);
        setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
        // debug message no longer includes gccStatus
        params.addDebugMessage({
          source: "server",
          type: "compilation_status",
          data: JSON.stringify({ success: true }, null, 2),
          protocol: "http",
        });
      } else {
        setArduinoCliStatus("error");
        setHasCompilationErrors(true);
        setLastCompilationResult("error");
        let errs: any[] = [];
        let errText = "";
        if (Array.isArray(data.errors)) {
          errs = data.errors;
          errText = errs
            .map((e: any) =>
              `${e.file}${e.line ? `:${e.line}` : ""}${e.column ? `:${e.column}` : ""} ${e.type}: ${e.message}`
            )
            .join("\n");
        } else if (typeof data.errors === "string") {
          errs = [
            { file: "", line: 0, column: 0, type: "error", message: data.errors },
          ];
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
      }
      params.setParserMessages(data.parserMessages);
      if (data.parserMessages.length > 0) {
        params.setParserPanelDismissed(false);
      }

      params.toast({
        title: data.success
          ? "Arduino-CLI Compilation succeeded"
          : "Arduino-CLI Compilation failed",
        description: data.success
          ? "Your sketch has been compiled successfully"
          : "There were errors in your sketch",
        variant: data.success ? undefined : "destructive",
      });

      try {
        if (doUploadOnCompileSuccessRef.current) {
          doUploadOnCompileSuccessRef.current = false;
          if (data.success) {
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
          } else {
            params.toast({
              title: "Upload canceled",
              description: "Compilation failed — upload canceled.",
              variant: "destructive",
            });
          }
        }
      } catch (err) {
        console.error("Error handling post-compile upload", err);
      }
    },
    onError: (error) => {
      setArduinoCliStatus("error");
      params.triggerErrorGlitch();
      const backendDown = params.isBackendUnreachableError(error);
      params.toast({
        title: backendDown
          ? "Backend unreachable"
          : "Compilation with Arduino-CLI Failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : "There were errors in your sketch",
        variant: "destructive",
      });
    },
  });

  // simulation mutations ------------------------------------------------
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
      setSimulationStatus("stopped");
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
      console.info("[CLIENT] startMutation invoked, simulationTimeout=", simulationTimeout);
      params.resetPinUI({ keepDetected: true });
      params.addDebugMessage({
        source: "frontend",
        type: "start_simulation",
        data: JSON.stringify({ type: "start_simulation", timeout: simulationTimeout }, null, 2),
        protocol: "websocket",
      });
      // Use immediate send for start_simulation when available to ensure
      // WS frame is emitted deterministically for E2E tests and real-time control.
      if (typeof params.sendMessageImmediate === "function") {
        const sent = params.sendMessageImmediate({ type: "start_simulation", timeout: simulationTimeout });
        console.info("[CLIENT] sendMessageImmediate returned", sent);
        // If immediate send failed (socket not open) fall back to buffered send
        if (!sent) {
          console.info("[CLIENT] falling back to buffered send for start_simulation");
          params.addDebugMessage({ source: "frontend", type: "start_simulation", data: "Immediate send failed, falling back to buffered send", protocol: "websocket" });
          params.sendMessage({ type: "start_simulation", timeout: simulationTimeout });
        }
      } else {
        console.info("[CLIENT] using buffered send for start_simulation (no immediate available)");
        params.sendMessage({ type: "start_simulation", timeout: simulationTimeout });
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
      } catch {}
    },
    onError: (error: any) => {
      params.toast({
        title: "Start Failed",
        description: error.message || "Could not start simulation",
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

  // Compile helpers
  const handleCompile = useCallback(() => {
    clearOutputs();
    params.resetPinUI();
    const pins: IOPinRecord[] = [];
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    params.setIoRegistry(pins);

    let mainSketchCode: string;
    if (params.activeTabId === params.tabs[0]?.id && params.editorRef.current) {
      mainSketchCode = params.editorRef.current.getValue();
    } else {
      mainSketchCode = params.tabs[0]?.content || params.code;
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
    params.setIoRegistry,
    params.tabs,
  ]);

  const handleCompileAndStart = useCallback(() => {
    if (!params.ensureBackendConnected("Simulation starten")) return;
    params.setDebugMessages([]);

    let mainSketchCode: string = "";
    if (params.editorRef.current) {
      try {
        mainSketchCode = params.editorRef.current.getValue();
      } catch (error) {
        console.error("[CLIENT] Error getting code from editor:", error);
      }
    }

    if (!mainSketchCode && params.tabs.length > 0 && params.tabs[0]?.content) {
      mainSketchCode = params.tabs[0].content;
    }

    if (!mainSketchCode && params.code) {
      mainSketchCode = params.code;
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
    logger.info(`[CLIENT] Compile & Start with ${headers.length} headers`);
    logger.info(`[CLIENT] Code length: ${mainSketchCode.length} bytes`);
    logger.info(
      `[CLIENT] Main code from: ${params.editorRef.current ? "editor" : params.tabs[0]?.content ? "tabs" : "state"}`,
    );
    logger.info(
      `[CLIENT] Tabs: ${params.tabs
        .map((t) => `${t.name}(${t.content.length}b)`)
        .join(", ")}`,
    );

    clearOutputs();
    setCompilationStatus("compiling");
    setArduinoCliStatus("compiling");

    compileMutation.mutate(
      { code: mainSketchCode, headers },
      {
        onSuccess: (data) => {
          logger.info(
            `[CLIENT] Compile response: ${JSON.stringify(data, null, 2)}`,
          );

          setArduinoCliStatus(data.success ? "success" : "error");

          if (data.success) {
            logger.info(`[CLIENT] Compile SUCCESS, output: ${data.output}`);
            setCompilerErrors([]);
            setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
          } else {
            logger.info(`[CLIENT] Compile FAILED, errors: ${data.errors}`);
            let errs: any[] = [];
            let errText = "";
            if (Array.isArray(data.errors)) {
              errs = data.errors;
              errText = errs
                .map((e: any) =>
                  `${e.file}${e.line ? `:${e.line}` : ""}${e.column ? `:${e.column}` : ""} ${e.type}: ${e.message}`
                )
                .join("\n");
            } else if (typeof data.errors === "string") {
              errs = [
                { file: "", line: 0, column: 0, type: "error", message: data.errors },
              ];
              errText = data.errors;
            }
            setCompilerErrors(errs);
            setCliOutput(errText || "✗ Arduino-CLI Compilation failed.");
          }

          if (data?.success) {
            startSimulationInternal();
            setCompilationStatus("success");
            setHasCompiledOnce(true);
            params.setIsModified(false);

            setTimeout(() => {
              setArduinoCliStatus("idle");
            }, 2000);
          } else {
            setCompilationStatus("error");
            params.toast({
              title: "Compilation Completed with Errors",
              description:
                "Simulation will not start due to compilation errors.",
              variant: "destructive",
            });

            setTimeout(() => {
              setArduinoCliStatus("idle");
            }, 2000);
          }
        },
        onError: () => {
          setCompilationStatus("error");
          setArduinoCliStatus("error");
          params.toast({
            title: "Compilation Failed",
            description: "Simulation will not start due to compilation errors.",
            variant: "destructive",
          });

          setTimeout(() => {
            setArduinoCliStatus("idle");
          }, 2000);
        },
      },
    );
  }, [
    clearOutputs,
    params.code,
    compileMutation,
    params.editorRef,
    params.ensureBackendConnected,
    params.resetPinUI,
    params.setDebugMessages,
    params.setIsModified,
    startSimulationInternal,
    params.tabs,
    params.toast,
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
      setSimulationStatus("stopped");
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
