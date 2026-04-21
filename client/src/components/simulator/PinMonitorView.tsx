import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";
import type { BatchStats, PinState } from "@/hooks/use-simulation-store";

type SimulationStatus = "idle" | "running" | "compiling" | "queued" | "paused";

type PinMonitorViewProps = {
  readonly pinMonitorVisible: boolean;
  readonly pinStates: PinState[];
  readonly batchStats: BatchStats;
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
  const isRunning = simulationStatus !== "idle";

  return (
    <div className={isMobile ? "h-full w-full" : "h-full w-full flex flex-col gap-3 p-2 overflow-y-auto"}>
      {pinMonitorVisible && (
        <div>
          <PinMonitor pinStates={pinStates} batchStats={batchStats} />
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
