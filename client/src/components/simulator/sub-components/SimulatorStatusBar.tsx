/**
 * SimulatorStatusBar Component
 *
 * Displays compilation status, error messages, and system feedback.
 * Reduces ArduinoSimulatorPage monolith by isolating status display logic.
 */

import { AlertCircle, CheckCircle, Clock } from "lucide-react";

export interface SimulatorStatusBarProps {
  /** Current compilation status: idle, compiling, success, error */
  readonly compilationStatus?: "idle" | "compiling" | "success" | "error";
  /** Human-readable compilation status message */
  readonly statusMessage?: string;
  /** Whether last compilation was successful */
  readonly hasCompiledOnce?: boolean;
  /** Current Arduino CLI status for multi-stage compiles */
  readonly arduinoCliStatus?: "idle" | "compiling" | "success" | "error";
  /** GCC status if using local compiler */
  readonly gccStatus?: "idle" | "compiling" | "success" | "error";
  /** Error details to display */
  readonly lastError?: string | null;
  /** Whether simulation is currently running */
  readonly isSimulationRunning?: boolean;
  /** Whether simulation is paused */
  readonly isSimulationPaused?: boolean;
}

/**
 * Status bar component that displays current compilation and simulation state.
 * Broken out from ArduinoSimulatorPage to reduce monolith size and improve readability.
 */
export function SimulatorStatusBar({
  compilationStatus = "idle",
  statusMessage,
  hasCompiledOnce = false,
  arduinoCliStatus,
  gccStatus,
  lastError,
  isSimulationRunning = false,
  isSimulationPaused = false,
}: SimulatorStatusBarProps) {
  const getStatusIcon = () => {
    switch (compilationStatus) {
      case "compiling":
        return <Clock className="w-4 h-4 animate-spin text-yellow-500" />;
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    if (statusMessage) return statusMessage;
    
    if (isSimulationRunning) {
      return isSimulationPaused ? "Simulation paused" : "Simulation running";
    }

    switch (compilationStatus) {
      case "compiling":
        return "Compiling...";
      case "success":
        return hasCompiledOnce ? "Ready" : "Compiled successfully";
      case "error":
        return "Compilation failed";
      default:
        return "Ready to compile";
    }
  };

  const getStatusColor = () => {
    if (isSimulationRunning || isSimulationPaused) return "bg-blue-50";
    if (compilationStatus === "error") return "bg-red-50";
    if (compilationStatus === "success") return "bg-green-50";
    if (compilationStatus === "compiling") return "bg-yellow-50";
    return "bg-gray-50";
  };

  return (
    <div className={`border-t border-gray-200 px-4 py-2 text-sm flex items-center gap-3 h-10 ${getStatusColor()}`}>
      {getStatusIcon()}
      
      <span className="flex-1 font-medium text-gray-700">
        {getStatusText()}
      </span>

      {/* Sub-status indicators */}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        {arduinoCliStatus && arduinoCliStatus !== "idle" && (
          <span className="px-2 py-1 rounded bg-white border border-gray-300">
            CLI: {arduinoCliStatus}
          </span>
        )}
        {gccStatus && gccStatus !== "idle" && (
          <span className="px-2 py-1 rounded bg-white border border-gray-300">
            GCC: {gccStatus}
          </span>
        )}
      </div>

      {/* Error indicator */}
      {lastError && compilationStatus === "error" && (
        <div
          className="text-red-600 truncate max-w-xs cursor-help"
          title={lastError}
        >
          {lastError.slice(0, 50)}
          {lastError.length > 50 ? "..." : ""}
        </div>
      )}
    </div>
  );
}
