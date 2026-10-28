import { lazy, Suspense } from "react";
import type { BoardId } from "@shared/boards";
import { PinMonitor } from "@/components/features/pin-monitor";
import type { PinState } from "@/hooks/use-simulation-store";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { ServerCapabilities } from "@/lib/server-capabilities";

// The board view (component, pin polling, overlays) loads with its own chunk: it fetches the board SVG
// anyway before it can draw, and keeping it off the initial load path leaves room for further boards
// (plan P6.5). The fallback holds the space so the layout does not jump.
const ArduinoBoard = lazy(() =>
  import("@/components/features/arduino-board").then((module) => ({ default: module.ArduinoBoard })),
);

type PinMonitorViewProps = {
  readonly pinMonitorVisible: boolean;
  readonly pinStates: PinState[];
  readonly simulationStatus: SimulationStatus;
  readonly txActivity: number;
  readonly rxActivity: number;
  readonly onReset: () => void;
  readonly onPinToggle: (pin: number, newValue: number) => void;
  readonly analogPins: number[];
  readonly onAnalogChange: (pin: number, newValue: number) => void;
  readonly capabilities?: ServerCapabilities;
  readonly isMobile?: boolean;
  readonly boardId?: BoardId;
};

export function PinMonitorView({
  pinMonitorVisible,
  pinStates,
  simulationStatus,
  txActivity,
  rxActivity,
  onReset,
  onPinToggle,
  analogPins,
  onAnalogChange,
  capabilities,
  isMobile = false,
  boardId,
}: PinMonitorViewProps) {
  const isRunning = simulationStatus !== "idle";

  return (
    <div className={isMobile ? "h-full w-full flex flex-col overflow-y-auto" : "h-full w-full flex flex-col gap-3 p-2 overflow-y-auto"}>
      {pinMonitorVisible && (
        <div>
          <PinMonitor pinStates={pinStates} />
        </div>
      )}

      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="h-full w-full" data-testid="arduino-board-loading" />}>
          <ArduinoBoard
            pinStates={pinStates}
            isSimulationRunning={isRunning}
            simulationStatus={simulationStatus === "running" || simulationStatus === "paused" ? simulationStatus : "idle"}
            txActive={txActivity}
            rxActive={rxActivity}
            onReset={onReset}
            onPinToggle={onPinToggle}
            analogPins={analogPins}
            {...(boardId ? { boardId } : {})}
            onAnalogChange={onAnalogChange}
            controlsDisabled={capabilities ? !capabilities.canUseRealtimeControls : false}
          />
        </Suspense>
      </div>
    </div>
  );
}
