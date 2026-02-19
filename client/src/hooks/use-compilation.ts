import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Logger } from "@shared/logger";
import type { IOPinRecord, ParserMessage } from "@shared/schema";

const logger = new Logger("useCompilation");

type CompilationStatus = "ready" | "compiling" | "success" | "error";
type CliStatus = "idle" | "compiling" | "success" | "error";

type SetState<T> = (value: T | ((prev: T) => T)) => void;



type CompilePayload = {
  code: string;
  headers?: Array<{ name: string; content: string }>;
};

type UseCompilationParams = {
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
  setHasCompiledOnce: SetState<boolean>;
  setIsModified: SetState<boolean>;
  ensureBackendConnected: (reason: string) => boolean;
  isBackendUnreachableError: (error: unknown) => boolean;
  triggerErrorGlitch: () => void;
  toast: (args: {
    title: string;
    description?: string;
    variant?: "destructive";
  }) => void;
  startSimulation: () => void;
};

import { useSimulationUi } from "@/hooks/use-simulation-ui";

export function useCompilation({
  editorRef,
  tabs,
  activeTabId,
  code,
  setSerialOutput,
  clearSerialOutput,
  setParserMessages,
  setParserPanelDismissed,
  resetPinUI,
  setIoRegistry,
  setHasCompiledOnce,
  setIsModified,
  ensureBackendConnected,
  isBackendUnreachableError,
  triggerErrorGlitch,
  toast,
  startSimulation,
}: UseCompilationParams) {
  // pull debug helpers from UI context (provider owns debug state)
  const { addDebugMessage, setDebugMessages } = useSimulationUi();
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>(
    "ready",
  );
  const [arduinoCliStatus, setArduinoCliStatus] = useState<CliStatus>("idle");
  const [gccStatus, setGccStatus] = useState<CliStatus>("idle");
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<
    "success" | "error" | null
  >(null);
  const [cliOutput, setCliOutput] = useState("");

  const doUploadOnCompileSuccessRef = useRef(false);
  const lastCompilePayloadRef = useRef<CompilePayload | null>(null);

  const clearOutputs = useCallback(() => {
    setCliOutput("");
    setSerialOutput([]);
    clearSerialOutput();  // Clear baudrate-rendered text + renderer queue
    setParserMessages([]);
  }, [setCliOutput, setSerialOutput, clearSerialOutput, setParserMessages]);

  const uploadMutation = useMutation({
    mutationFn: async (payload: CompilePayload) => {
      addDebugMessage?.(
        "frontend",
        "upload_request",
        JSON.stringify(
          { endpoint: "POST /api/upload", codeLength: payload.code.length },
          null,
          2,
        ),
        "http",
      );
      const response = await apiRequest("POST", "/api/upload", payload);
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return await response.json();
        } catch (err) {
          const txt = await response.text();
          return { success: response.ok, raw: txt } as any;
        }
      }
      const txt = await response.text();
      return { success: response.ok, raw: txt } as any;
    },
    onSuccess: (data) => {
      if (data && (data as any).success) {
        toast({
          title: "Upload started",
          description: "Upload initiated to connected device.",
        });
      } else if (data && typeof (data as any).raw === "string") {
        const txt = String((data as any).raw || "").trim();
        if (txt.length === 0) {
          toast({
            title: "Upload started",
            description: "Upload initiated to connected device.",
          });
        } else {
          toast({ title: "Upload response", description: txt.slice(0, 200) });
        }
      } else {
        toast({
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
      const backendDown = isBackendUnreachableError(err);
      toast({
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

  const compileMutation = useMutation({
    mutationFn: async (payload: CompilePayload) => {
      setArduinoCliStatus("compiling");
      setLastCompilationResult(null);
      addDebugMessage?.(
        "frontend",
        "compile_request",
        JSON.stringify(
          { endpoint: "POST /api/compile", codeLength: payload.code.length },
          null,
          2,
        ),
        "http",
      );
      const response = await apiRequest("POST", "/api/compile", payload);
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return await response.json();
        } catch (err) {
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
        setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
        addDebugMessage?.(
          "server",
          "compilation_status",
          JSON.stringify({ gccStatus: "success" }, null, 2),
          "http",
        );
      } else {
        setArduinoCliStatus("error");
        setHasCompilationErrors(true);
        setLastCompilationResult("error");
        triggerErrorGlitch();
        setCliOutput(data.errors || "✗ Arduino-CLI Compilation failed.");
        addDebugMessage?.(
          "server",
          "compilation_error",
          JSON.stringify(
            { type: "compilation_error", data: data.errors },
            null,
            2,
          ),
          "http",
        );
        addDebugMessage?.(
          "server",
          "compilation_status",
          JSON.stringify({ gccStatus: "error" }, null, 2),
          "http",
        );
      }

      if (data.parserMessages && Array.isArray(data.parserMessages)) {
        setParserMessages(data.parserMessages);
        if (data.parserMessages.length > 0) {
          setParserPanelDismissed(false);
        }
      }

      toast({
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
              logger.info(
                `[CLIENT] Uploading compiled artifact... ${JSON.stringify(payload)}`,
              );
              uploadMutation.mutate(payload);
            } else {
              toast({
                title: "Upload failed",
                description: "No compiled artifact available to upload.",
                variant: "destructive",
              });
            }
          } else {
            toast({
              title: "Upload canceled",
              description: "Compilation failed — upload canceled.",
              variant: "destructive",
            });
          }
        }
      } catch (err) {
        logger.error(`Error handling post-compile upload: ${String(err)}`);
      }
    },
    onError: (error) => {
      setArduinoCliStatus("error");
      triggerErrorGlitch();
      const backendDown = isBackendUnreachableError(error);
      toast({
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

  const handleCompile = useCallback(() => {
    clearOutputs();
    resetPinUI();
    const pins: IOPinRecord[] = [];
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    setIoRegistry(pins);

    let mainSketchCode: string;
    if (activeTabId === tabs[0]?.id && editorRef.current) {
      mainSketchCode = editorRef.current.getValue();
    } else {
      mainSketchCode = tabs[0]?.content || code;
    }

    const headers = tabs.slice(1).map((tab) => ({
      name: tab.name,
      content: tab.content,
    }));
    logger.info(`[CLIENT] Compiling with ${headers.length} headers`);
    lastCompilePayloadRef.current = { code: mainSketchCode, headers };
    compileMutation.mutate({ code: mainSketchCode, headers });
  }, [
    activeTabId,
    clearOutputs,
    code,
    compileMutation,
    editorRef,
    resetPinUI,
    setIoRegistry,
    tabs,
  ]);

  const handleCompileAndStart = useCallback(() => {
    if (!ensureBackendConnected("Simulation starten")) return;
// clear debug messages via provider
      setDebugMessages?.([]);

    let mainSketchCode: string = "";
    if (editorRef.current) {
      try {
        mainSketchCode = editorRef.current.getValue();
      } catch (error) {
        logger.error(`[CLIENT] Error getting code from editor: ${String(error)}`);
      }
    }

    if (!mainSketchCode && tabs.length > 0 && tabs[0]?.content) {
      mainSketchCode = tabs[0].content;
    }

    if (!mainSketchCode && code) {
      mainSketchCode = code;
    }

    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      toast({
        title: "No Code",
        description: "Please write some code before compiling",
        variant: "destructive",
      });
      return;
    }

    const headers = tabs.slice(1).map((tab) => ({
      name: tab.name,
      content: tab.content,
    }));
    logger.info(`[CLIENT] Compile & Start with ${headers.length} headers`);
    logger.info(`[CLIENT] Code length: ${mainSketchCode.length} bytes`);
    logger.info(
      `[CLIENT] Main code from: ${editorRef.current ? "editor" : tabs[0]?.content ? "tabs" : "state"}`,
    );
    logger.info(
      `[CLIENT] Tabs: ${tabs
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
            setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
          } else {
            logger.info(`[CLIENT] Compile FAILED, errors: ${data.errors}`);
            setCliOutput(data.errors || "✗ Arduino-CLI Compilation failed.");
          }

          if (data?.success) {
            startSimulation();
            setCompilationStatus("success");
            setHasCompiledOnce(true);
            setIsModified(false);

            setTimeout(() => {
              setArduinoCliStatus("idle");
            }, 2000);
          } else {
            setCompilationStatus("error");
            toast({
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
          toast({
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
    code,
    compileMutation,
    editorRef,
    ensureBackendConnected,
    resetPinUI,
    setDebugMessages,
    setIsModified,
    setHasCompiledOnce,
    startSimulation,
    tabs,
    toast,
  ]);

  const handleClearCompilationOutput = useCallback(() => {
    setCliOutput("");
    setLastCompilationResult(null);
    setParserMessages([]);
  }, [setCliOutput, setLastCompilationResult, setParserMessages]);

  return {
    compilationStatus,
    setCompilationStatus,
    arduinoCliStatus,
    setArduinoCliStatus,
    gccStatus,
    setGccStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
    lastCompilationResult,
    setLastCompilationResult,
    cliOutput,
    setCliOutput,
    compileMutation,
    handleCompile,
    handleCompileAndStart,
    handleClearCompilationOutput,
    clearOutputs,
  };
}
