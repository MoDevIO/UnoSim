import { useCallback } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Logger } from "@shared/logger";
import type { IOPinRecord, OutputLine, ParserMessage } from "@shared/schema";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import type {
  CompileConfig,
  CompileResult,
  CompilerError,
} from "@/types/websocket";
import { buildCompileCommand } from "./compile-command-builder";
import { isCompileResult } from "@/types/websocket";

const logger = new Logger("use-compile-controller");

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

export type DebugMessageParams = {
  source: "frontend" | "server";
  type: string;
  data: string;
  protocol?: "websocket" | "http";
};

/** UI Feedback Adapter interface for compile controller */
interface UiFeedbackAdapter {
  logCompileRequest: (codeLength: number) => void;
  logCompilationSuccess: () => void;
  logCompilationError: (errors: CompilationErrors) => void;
  triggerCompileErrorGlitch: () => void;
  showCompileSuccessToast: () => void;
  showCompileErrorToast: () => void;
  showBackendUnreachableToast: () => void;
  showCompilationFailedWithErrorsToast: () => void;
  showNoCodeToast: () => void;
  setCompileSuccessOutput: (output: string) => void;
  setCompileErrorOutput: (errors: CompilationErrors) => void;
}

export type CompilationErrors = CompilerError[] | string | undefined;

export interface UseCompileControllerParams {
  // State
  compilationStatus: CompilationStatus;
  setCompilationStatus: SetState<CompilationStatus>;
  arduinoCliStatus: "idle" | "compiling" | "success" | "error";
  setArduinoCliStatus: SetState<"idle" | "compiling" | "success" | "error">;
  hasCompilationErrors: boolean;
  setHasCompilationErrors: SetState<boolean>;
  compilerErrors: CompilerError[];
  setCompilerErrors: SetState<CompilerError[]>;
  lastCompilationResult: CompilationResultType;
  setLastCompilationResult: SetState<CompilationResultType>;
  cliOutput: string;
  setCliOutput: SetState<string>;

  // Callbacks
  setParserMessages: SetState<ParserMessage[]>;
  setParserPanelDismissed: SetState<boolean>;
  setIoRegistry: SetState<IOPinRecord[]>;
  setIsModified: SetState<boolean>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;

  // UI Feedback
  uiFeedback: UiFeedbackAdapter;
  isBackendUnreachableError: (error: unknown) => boolean;

  // Editor
  editorRef: React.RefObject<{ getValue: () => string } | null>;
  tabs: Array<{ id: string; name: string; content: string }>;
  activeTabId: string | null;
  code: string;

  // Simulation coordination
  clearSerialOutput: () => void;
  setSerialOutput: SetState<OutputLine[]>;
}

interface UseCompileControllerResult {
  compileMutation: UseMutationResult<CompileResult, unknown, CompileConfig, unknown>;
  handleCompile: () => void;
  handleClearCompilationOutput: () => void;
  clearOutputs: () => void;
}

export function useCompileController(params: UseCompileControllerParams): UseCompileControllerResult {
  const clearOutputs = useCallback(() => {
    params.setCliOutput("");
    params.setSerialOutput([]);
    params.clearSerialOutput();
    params.setParserMessages([]);
  }, [params]);

  const compileMutation = useMutation<CompileResult, unknown, CompileConfig, unknown>({
    mutationFn: async (payload: CompileConfig): Promise<CompileResult> => {
      params.setArduinoCliStatus("compiling");
      params.setLastCompilationResult(null);
      params.uiFeedback.logCompileRequest(payload.code.length);
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
      params.setArduinoCliStatus("error");
      params.uiFeedback.triggerCompileErrorGlitch();
      if (params.isBackendUnreachableError(error)) {
        params.uiFeedback.showBackendUnreachableToast();
      } else {
        params.uiFeedback.showCompileErrorToast();
      }
    },
  });

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

  const handleCompileSuccess = useCallback(
    (data: CompileResult) => {
      params.setArduinoCliStatus("success");
      params.setHasCompilationErrors(false);
      params.setLastCompilationResult("success");
      params.setCompilerErrors([]);
      params.uiFeedback.setCompileSuccessOutput(data.output ?? "");
      params.uiFeedback.logCompilationSuccess();
      params.setParserMessages(data.parserMessages ?? []);
      if (data.parserMessages && data.parserMessages.length > 0) {
        params.setParserPanelDismissed(false);
      }
      params.uiFeedback.showCompileSuccessToast();
      initializeEmptyRegistry();
    },
    [params, initializeEmptyRegistry],
  );

  const handleCompileError = useCallback(
    (data: CompileResult) => {
      params.setArduinoCliStatus("error");
      params.setHasCompilationErrors(true);
      params.setLastCompilationResult("error");
      let errs: CompilerError[] = [];

      if (Array.isArray(data.errors)) {
        errs = data.errors;
      } else if (typeof data.errors === "string") {
        errs = [{ file: "", line: 0, column: 0, type: "error", message: data.errors }];
      }

      params.setCompilerErrors(errs);
      params.uiFeedback.triggerCompileErrorGlitch();
      params.uiFeedback.setCompileErrorOutput(data.errors);
      params.uiFeedback.logCompilationError(data.errors);
      params.setParserMessages(data.parserMessages ?? []);
      if (data.parserMessages && data.parserMessages.length > 0) {
        params.setParserPanelDismissed(false);
      }
      params.uiFeedback.showCompileErrorToast();
    },
    [params],
  );

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
      params.uiFeedback.showNoCodeToast();
      return;
    }

    const { headers } = buildCompileCommand(mainSketchCode, params.tabs);
    logger.info(`[CLIENT] Compiling with ${headers.length} headers`);
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
    params.uiFeedback,
  ]);

  const handleClearCompilationOutput = useCallback(() => {
    params.setCliOutput("");
    params.setLastCompilationResult(null);
    params.setParserMessages([]);
  }, [params]);

  return {
    compileMutation,
    handleCompile,
    handleClearCompilationOutput,
    clearOutputs,
  };
}
