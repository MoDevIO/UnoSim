import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";

type BatchStats = { lastBatchMs: number; lastBatchSize: number; lastFrameAt: number };

type SimulationStatus = "running" | "stopped" | "paused";

type SimulatorSidebarProps = {
  pinMonitorVisible: boolean;
  pinStates: any[];
  batchStats: BatchStats;
  simulationStatus: SimulationStatus | undefined;
  txActivity: number;
  rxActivity: number;
  // telemetry info (useTelemetry hook)
  telemetryData?: any;
  rates?: {
    serialOutputPerSecond: number;
    serialBytesPerSecond: number;
    serialDroppedBytesPerSecond: number;
    serialBytesTotal: number;
  };
  onReset: () => void;
  onPinToggle: (pin: number, newValue: number) => void;
  analogPins: number[];
  onAnalogChange: (pin: number, newValue: number) => void;
  isMobile?: boolean;
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
        <div className={isMobile ? "" : ""}>
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
