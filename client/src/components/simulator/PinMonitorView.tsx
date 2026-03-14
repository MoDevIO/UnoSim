import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";

export type SimulationStatus = "running" | "stopped" | "paused";

export type PinMonitorViewProps = {
  pinMonitorVisible: boolean;
  pinStates: any[];
  batchStats: any;
  simulationStatus: SimulationStatus;
  txActivity: number;
  rxActivity: number;
  onReset: () => void;
  onPinToggle: (pin: number, newValue: number) => void;
  analogPins: number[];
  onAnalogChange: (pin: number, newValue: number) => void;
  isMobile?: boolean;
};

export function PinMonitorView({
  pinMonitorVisible,
  pinStates,
  batchStats,
  simulationStatus,
  txActivity,
  rxActivity,
  onReset,
  onPinToggle,
  analogPins,
  onAnalogChange,
  isMobile = false,
}: PinMonitorViewProps) {
  const isRunning = simulationStatus !== "stopped";

  return (
    <div className={isMobile ? "h-full w-full" : "h-full w-full flex flex-col gap-3 p-2 overflow-y-auto"}>
      {pinMonitorVisible && (
        <div className={isMobile ? "" : ""}>
          <PinMonitor pinStates={pinStates} batchStats={batchStats} />
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ArduinoBoard
          pinStates={pinStates}
          isSimulationRunning={isRunning}
          simulationStatus={simulationStatus}
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
