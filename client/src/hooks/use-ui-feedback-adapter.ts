import type { DebugProtocol, DebugSender } from "@/hooks/use-debug-console";
import type { RuntimeKind } from "@shared/boards";
import type { CompilerError } from "@/types/websocket";

export type DebugMessageParams = {
  source: DebugSender;
  type: string;
  data: string;
  protocol?: DebugProtocol;
};

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

/**
 * Compilation errors for CLI output - can be array of errors, string, or undefined
 */
export type CompilationErrors = CompilerError[] | string | undefined;

function formatCompilerDiagnosticMessage(message: string): string {
  const memoryLinePattern = /(?=data section exceeds available space|Sketch uses\b|Der Sketch verwendet\b|Global variables use\b|Globale Variablen verwenden\b)/gi;
  const lines = message.split(memoryLinePattern).map((line) => line.trim()).filter(Boolean);
  const flashLine = lines.find((line) => /^(?:Sketch uses|Der Sketch verwendet)\b/i.test(line));
  const sramLine = lines.find((line) => /^(?:Global variables use|Globale Variablen verwenden)\b/i.test(line));
  const memoryLines = lines.filter((line) =>
    /^(?:Not enough memory|data section exceeds available space|Memory usage exceeds)/i.test(line),
  );

  if (!flashLine || !sramLine || memoryLines.length === 0) {
    return message;
  }

  return [
    "Memory error:",
    memoryLines.join("\n"),
    "",
    "Flash usage:",
    flashLine,
    "",
    "SRAM usage:",
    sramLine,
  ].join("\n");
}

export interface UseUiFeedbackAdapterParams {
  // Toast callback
  toast: (args: {
    title: string;
    description?: string;
    variant?: "destructive";
  }) => void;

  // Debug message callback
  addDebugMessage: (params: DebugMessageParams) => void;

  // Error glitch trigger
  triggerErrorGlitch: () => void;

  // CLI Output setter (for pin conflict warnings)
  setCliOutput: SetState<string>;

  // Pin conflict state setter
  setPendingPinConflicts: SetState<number[]>;
}

export interface UseUiFeedbackAdapterResult {
  // Toast notifications
  showCompileSuccessToast: () => void;
  showCompileErrorToast: () => void;
  showCompilationFailedWithErrorsToast: () => void;
  showNoCodeToast: () => void;
  showSimulationStartedToast: () => void;
  showStartFailedToast: (message: string) => void;
  showCodeModifiedToast: () => void;
  showPauseFailedToast: () => void;
  showResumeFailedToast: () => void;
  showResettingToast: () => void;
  showBackendUnreachableToast: () => void;

  // Debug messages
  logCompileRequest: (codeLength: number) => void;
  logCompilationSuccess: () => void;
  logCompilationError: (errors: CompilationErrors) => void;
  /** `runtime` names where the command goes: the WebSocket (host mock, default) or the browser emulation's worker. */
  logStopSimulation: (runtime?: RuntimeKind) => void;
  logPauseSimulation: (runtime?: RuntimeKind) => void;
  logResumeSimulation: (runtime?: RuntimeKind) => void;
  logStartSimulation: (timeout: number, hasCode: boolean, runtime?: RuntimeKind) => void;
  logStartSimulationFallback: () => void;

  // Error handling
  triggerCompileErrorGlitch: () => void;

  // CLI Output updates
  setCompileSuccessOutput: (output: string | undefined) => void;
  setCompileErrorOutput: (errors: CompilationErrors) => void;
  showPinConflictWarning: (pins: number[]) => void;

  // Error message extraction
  extractErrorMessage: (error: unknown) => string;
}

/**
 * UI Feedback Adapter - kapselt alle UI-Seiteneffekte
 *
 * Verantwortlichkeiten:
 * ✅ Toast-Benachrichtigungen erzeugen
 * ✅ Debug-Meldungen formatieren und senden
 * ✅ CLI-Output aktualisieren
 * ✅ Error-Glitch auslösen
 * ✅ Pin-Conflict-Warnings anzeigen
 *
 * Keine Verantwortlichkeiten:
 * ❌ Compile-/Simulation-State
 * ❌ WebSocket-Steuerung
 * ❌ Fachliche Entscheidungen
 * ❌ Lifecycle-Management
 */
export function useUiFeedbackAdapter(params: UseUiFeedbackAdapterParams): UseUiFeedbackAdapterResult {
  /**
   * Helper: Toast erzeugen
   */
  const showToast = (title: string, description: string, variant?: "destructive") => {
    params.toast({ title, description, variant: variant ?? undefined });
  };

  /**
   * Helper: Debug-Message erzeugen
   */
  const logDebug = (source: DebugSender, type: string, data: string, protocol?: DebugProtocol) => {
    params.addDebugMessage({ source, type, data, protocol: protocol ?? "http" });
  };

  /**
   * Extract error message from unknown error type
   * Safely formats any value without producing [object Object]
   */
  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error === undefined) {
      return "undefined";
    }
    if (error === null) {
      return "null";
    }
    try {
      const json = JSON.stringify(error, null, 2);
      if (json) {
        return json;
      }
    } catch {
      // Ignore JSON stringify errors
    }
    // Fallback: use toString() for primitives, describe for objects
    return Object.prototype.toString.call(error);
  };

  // ============================================================
  // Toast notifications (12 Varianten)
  // ============================================================

  const showCompileSuccessToast = () => {
    showToast("Arduino-CLI Compilation succeeded", "Your sketch has been compiled successfully");
  };

  const showCompileErrorToast = () => {
    showToast("Arduino-CLI Compilation failed", "There were errors in your sketch", "destructive");
  };

  const showCompilationFailedWithErrorsToast = () => {
    showToast("Compilation Completed with Errors", "Simulation will not start due to compilation errors.", "destructive");
  };

  const showNoCodeToast = () => {
    showToast("No Code", "Please write some code before compiling", "destructive");
  };

  const showSimulationStartedToast = () => {
    showToast("Simulation Started", "Arduino simulation is now running");
  };

  const showStartFailedToast = (message: string) => {
    showToast("Start Failed", message || "Could not start simulation", "destructive");
  };

  const showCodeModifiedToast = () => {
    showToast("Code Modified", "Compile to apply your latest changes");
  };

  const showPauseFailedToast = () => {
    showToast("Pause failed", "Could not pause simulation", "destructive");
  };

  const showResumeFailedToast = () => {
    showToast("Resume failed", "Could not resume simulation", "destructive");
  };

  const showResettingToast = () => {
    showToast("Resetting...", "Recompiling and restarting simulation");
  };

  const showBackendUnreachableToast = () => {
    showToast("Backend unreachable", "API server unreachable. Please check the backend or reload.", "destructive");
  };

  // ============================================================
  // Debug messages (8 Varianten)
  // ============================================================

  const logCompileRequest = (codeLength: number) => {
    logDebug("frontend", "compile_request", JSON.stringify({ endpoint: "POST /api/compile", codeLength }, null, 2));
  };

  const logCompilationSuccess = () => {
    logDebug("server", "compile_response", JSON.stringify({ success: true }, null, 2));
  };

  const logCompilationError = (errors: CompilerError[] | string | undefined) => {
    logDebug("server", "compilation_error", JSON.stringify({ type: "compilation_error", data: errors }, null, 2));
    logDebug("server", "compile_response", JSON.stringify({ success: false }, null, 2));
  };

  /** A run command: over the WebSocket for the host mock, as a call to the worker for the browser emulation. */
  const logRunCommand = (command: string, message: object, runtime?: RuntimeKind) => {
    if (runtime === "browser") logDebug("frontend", `browser: ${command}`, JSON.stringify({ command, runtime: "browser emulation (Web Worker)", ...message }, null, 2), "worker");
    else logDebug("frontend", `${command}_simulation`, JSON.stringify({ type: `${command}_simulation`, ...message }, null, 2), "websocket");
  };

  const logStopSimulation = (runtime?: RuntimeKind) => logRunCommand("stop", {}, runtime);
  const logPauseSimulation = (runtime?: RuntimeKind) => logRunCommand("pause", {}, runtime);
  const logResumeSimulation = (runtime?: RuntimeKind) => logRunCommand("resume", {}, runtime);

  const logStartSimulation = (timeout: number, hasCode: boolean, runtime?: RuntimeKind) => {
    const startMsg: { type: "start_simulation"; timeout: number; code?: string } = {
      type: "start_simulation",
      timeout,
    };
    if (hasCode) {
      startMsg.code = "<code present>";
    }

    if (runtime === "browser") logRunCommand("start", { timeout, image: "from the compile result" }, runtime);
    else logDebug("frontend", "start_simulation", JSON.stringify(startMsg, null, 2), "websocket");
  };

  const logStartSimulationFallback = () => {
    logDebug("frontend", "start_simulation", "Immediate send failed, falling back to buffered send", "websocket");
  };

  // ============================================================
  // Error handling
  // ============================================================

  const triggerCompileErrorGlitch = () => {
    params.triggerErrorGlitch();
  };

  // ============================================================
  // CLI Output updates
  // ============================================================

  const setCompileSuccessOutput = (output: string | undefined) => {
    params.setCliOutput(output || "✓ Arduino-CLI Compilation succeeded.");
  };

  const setCompileErrorOutput = (errors: CompilerError[] | string | undefined) => {
    let errText = "";

    if (Array.isArray(errors)) {
      errText = errors
        .map((e) => {
          const lineStr = e.line ? `:${e.line}` : "";
          const columnStr = e.column ? `:${e.column}` : "";
          const location = `${e.file}${lineStr}${columnStr}`;
          return `${location} ${e.type}: ${formatCompilerDiagnosticMessage(e.message)}`;
        })
        .join("\n");
    } else if (typeof errors === "string") {
      errText = errors;
    }

    params.setCliOutput(errText || "✗ Arduino-CLI Compilation failed.");
  };

  const showPinConflictWarning = (pins: number[]) => {
    const names = pins
      .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
      .join(", ");

    params.setCliOutput(
      (prev) =>
        (prev ? prev + "\n\n" : "") +
        `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`,
    );
    params.setPendingPinConflicts([]);
  };

  return {
    // Toast notifications
    showCompileSuccessToast,
    showCompileErrorToast,
    showCompilationFailedWithErrorsToast,
    showNoCodeToast,
    showSimulationStartedToast,
    showStartFailedToast,
    showCodeModifiedToast,
    showPauseFailedToast,
    showResumeFailedToast,
    showResettingToast,
    showBackendUnreachableToast,

    // Debug messages
    logCompileRequest,
    logCompilationSuccess,
    logCompilationError,
    logStopSimulation,
    logPauseSimulation,
    logResumeSimulation,
    logStartSimulation,
    logStartSimulationFallback,

    // Error handling
    triggerCompileErrorGlitch,

    // CLI Output updates
    setCompileSuccessOutput,
    setCompileErrorOutput,
    showPinConflictWarning,

    // Error message extraction
    extractErrorMessage,
  };
}
