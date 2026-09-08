import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";
import type { PinState } from "@/hooks/use-simulation-store";
import type { SimulationStatus } from "@shared/types/arduino.types";

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
  readonly isMobile?: boolean;
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
  isMobile = false,
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
        <ArduinoBoard
          pinStates={pinStates}
          isSimulationRunning={isRunning}
          simulationStatus={simulationStatus === "running" || simulationStatus === "paused" ? simulationStatus : "idle"}
          txActive={txActivity}
          rxActive={rxActivity}
          onReset={onReset}
          onPinToggle={onPinToggle}
          analogPins={analogPins}
          onAnalogChange={onAnalogChange}
        />
      </div>
    </div>
  );
}
