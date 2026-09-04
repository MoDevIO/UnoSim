import type { CompilerError } from "@/types/websocket";

export type DebugMessageParams = {
  source: "frontend" | "server";
  type: string;
  data: string;
  protocol?: "websocket" | "http";
};

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

/**
 * Compilation errors for CLI output - can be array of errors, string, or undefined
 */
export type CompilationErrors = CompilerError[] | string | undefined;

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
  logStopSimulation: () => void;
  logPauseSimulation: () => void;
  logResumeSimulation: () => void;
  logStartSimulation: (timeout: number, hasCode: boolean) => void;
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
  const logDebug = (source: "frontend" | "server", type: string, data: string, protocol?: "websocket" | "http") => {
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
    logDebug("server", "compilation_status", JSON.stringify({ success: true }, null, 2));
  };

  const logCompilationError = (errors: CompilerError[] | string | undefined) => {
    logDebug("server", "compilation_error", JSON.stringify({ type: "compilation_error", data: errors }, null, 2));
    logDebug("server", "compilation_status", JSON.stringify({ success: false }, null, 2));
  };

  const logStopSimulation = () => {
    logDebug("frontend", "stop_simulation", JSON.stringify({ type: "stop_simulation" }, null, 2), "websocket");
  };

  const logPauseSimulation = () => {
    logDebug("frontend", "pause_simulation", JSON.stringify({ type: "pause_simulation" }, null, 2), "websocket");
  };

  const logResumeSimulation = () => {
    logDebug("frontend", "resume_simulation", JSON.stringify({ type: "resume_simulation" }, null, 2), "websocket");
  };

  const logStartSimulation = (timeout: number, hasCode: boolean) => {
    const startMsg: { type: "start_simulation"; timeout: number; code?: string } = {
      type: "start_simulation",
      timeout,
    };
    if (hasCode) {
      startMsg.code = "<code present>";
    }

    logDebug("frontend", "start_simulation", JSON.stringify(startMsg, null, 2), "websocket");
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
          return `${location} ${e.type}: ${e.message}`;
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
