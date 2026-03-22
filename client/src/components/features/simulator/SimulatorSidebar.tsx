import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";
import type { PinState, BatchStats } from "@/hooks/use-simulation-store";

type SimulationStatus = "running" | "stopped" | "paused";

type SimulatorSidebarProps = {
  readonly pinMonitorVisible: boolean;
  readonly pinStates: PinState[];
  readonly batchStats: BatchStats;
  readonly simulationStatus: SimulationStatus | undefined;
  readonly txActivity: number;
  readonly rxActivity: number;
  readonly onReset: () => void;
  readonly onPinToggle: (pin: number, newValue: number) => void;
  readonly analogPins: number[];
  readonly onAnalogChange: (pin: number, newValue: number) => void;
  readonly isMobile?: boolean;
};

export default function SimulatorSidebar({
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
}: SimulatorSidebarProps) {
  // Pure UI/presentation component — receives data + callbacks from parent hooks.
  const isRunning = simulationStatus !== "stopped";

  return (
    <div className={isMobile ? "h-full w-full" : "h-full w-full flex flex-col gap-3 p-2 overflow-y-auto"}>
      {pinMonitorVisible && (
        <div>
          <PinMonitor pinStates={pinStates} batchStats={batchStats} />
      {/* telemetry display could be added here if desired */}
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
