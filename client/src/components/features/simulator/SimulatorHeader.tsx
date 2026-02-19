import React from "react";
import { Play, Zap, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Props = {
  simulationStatus: "idle" | "running" | "compiling" | "stopped" | "paused";
  simulateDisabled?: boolean;
  isCompiling?: boolean;
  isStarting?: boolean;
  isStopping?: boolean;
  isPausing?: boolean;
  isResuming?: boolean;
  onSimulate?: () => void;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  simulationTimeout?: number;
  onTimeoutChange?: (n: number) => void;
  onCompile: () => void;
  onCompileAndStart: () => void;
  board?: string;
};

function getStatusTextClass(status: Props["simulationStatus"]) {
  switch (status) {
    case "idle":
      return "text-gray-500 italic";
    case "running":
      return "text-green-600";
    case "stopped":
      return "text-gray-600";
    default:
      return "";
  }
}

function SimulatorHeader({
  simulationStatus,
  simulateDisabled = false,
  isCompiling = false,
  isStarting = false,
  isPausing = false,
  isResuming = false,
  onSimulate,
  onStop,
  onPause,
  onResume,
  simulationTimeout,
  onCompile,
  onCompileAndStart,
  board = "Arduino UNO",
}: Props) {
  // keep a stable ref to the latest status so the click handler can be memoized
  const statusRef = React.useRef(simulationStatus);
  React.useEffect(() => {
    statusRef.current = simulationStatus;
  }, [simulationStatus]);

  const handleSimulateClick = React.useCallback(() => {
    const status = statusRef.current;
    if (status === "running") {
      onStop?.();
      return;
    }
    if (status === "paused") {
      onResume?.();
      return;
    }
    onSimulate?.();
  }, [onSimulate, onStop, onResume]);

  return (
    <div className="flex items-center gap-2">
      {/* Simulate toggle (compact desktop) */}
      <div className="hidden md:flex items-center gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSimulateClick}
            disabled={isCompiling || isStarting || simulateDisabled}
            data-testid="button-simulate-toggle"
            title={
              simulationStatus === "running"
                ? "Stop Simulation"
                : simulationStatus === "paused"
                ? "Resume Simulation"
                : "Start Simulation"
            }
            aria-label={
              simulationStatus === "running"
                ? "Stop Simulation"
                : simulationStatus === "paused"
                ? "Resume Simulation"
                : "Start Simulation"
            }
            className={`flex items-center gap-1 px-2 ${simulateDisabled ? 'opacity-50 cursor-not-allowed bg-gray-500' : simulationStatus === 'running' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
          >
            <Play className="h-4 w-4" />
            <span className="text-ui-xs">
              {simulationStatus === "running" ? "Stop" : simulationStatus === "paused" ? "Resume" : "Start"}
            </span>
          </Button>

          {/* Pause / Resume small control to the right of Start */}
          {(simulationStatus === "running" || simulationStatus === "paused") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (simulationStatus === "running") {
                  onPause?.();
                } else if (simulationStatus === "paused") {
                  onResume?.();
                }
              }}
              disabled={isPausing || isResuming}
              className="h-[var(--ui-button-height)] px-2"
              data-testid="button-pause-resume"
              title={simulationStatus === "running" ? "Pause Simulation" : "Resume Simulation"}
            >
              <span className="text-ui-xs">{simulationStatus === "running" ? "Pause" : "Resume"}</span>
            </Button>
          )}
        </div>

        {/* timeout display + small setter */}
        <div className="px-2 py-1 rounded-md border bg-muted/50 text-ui-xs flex items-center gap-2 select-none">
          <span className="text-xs">{simulationTimeout ?? 60}s</span>
        </div>
      </div>

      {/* Simulate toggle (mobile) */}
      <div className="md:hidden flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSimulateClick}
          disabled={isCompiling || isStarting || simulateDisabled}
          className="flex items-center gap-1 px-2"
          data-testid="button-simulate-toggle-mobile"
          title={
            simulationStatus === "running"
              ? "Stop Simulation"
              : simulationStatus === "paused"
              ? "Resume Simulation"
              : "Start Simulation"
          }
          aria-label={
            simulationStatus === "running"
              ? "Stop Simulation"
              : simulationStatus === "paused"
              ? "Resume Simulation"
              : "Start Simulation"
          }
        >
          <Play className="h-4 w-4" />
        </Button>

        {(simulationStatus === "running" || simulationStatus === "paused") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (simulationStatus === "running") onPause?.();
              else onResume?.();
            }}
            disabled={isPausing || isResuming}
            className="h-[var(--ui-button-height)] px-2"
            data-testid="button-pause-resume-mobile"
            title={simulationStatus === "running" ? "Pause" : "Resume"}
          >
            <span className="text-ui-xs">{simulationStatus === "running" ? "Pause" : "Resume"}</span>
          </Button>
        )}
      </div>

      {/* Compile button + small action menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="secondary"
            onClick={onCompile}
            disabled={isCompiling}
            className="flex items-center gap-2"
            title="Compile"
            data-testid="simulator-compile-button"
          >
            <Zap className="h-4 w-4" />
            <span className="text-ui-xs">Compile</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-40">
          <DropdownMenuItem onSelect={onCompile}>Compile</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCompileAndStart}>Compile & Run</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Board selector (display-only for now) */}
      <div className="px-2 py-1 rounded-md border bg-muted/50 text-ui-xs flex items-center gap-2 select-none">
        <Server className="h-4 w-4 opacity-80" />
        <span className="truncate max-w-[120px]">{board}</span>
      </div>

      {/* Status text (keeps visual parity with previous header) */}
      <div className={`px-2 py-0.5 text-ui-xs font-medium ${getStatusTextClass(simulationStatus)}`} data-testid="simulator-status-badge">
        {simulationStatus}
      </div>
    </div>
  );
}

// Memoize to reduce unnecessary re-renders and improve DOM stability during E2E interactions
export const MemoizedSimulatorHeader = React.memo(SimulatorHeader);
export default SimulatorHeader;
