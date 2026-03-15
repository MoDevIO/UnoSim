import React from "react";
import { SerialMonitorView, SerialViewMode } from "@/components/simulator/SerialMonitorView";
import SimulatorSidebar from "@/components/features/simulator/SimulatorSidebar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { OutputLine } from "@shared/schema";
import type { TelemetryMetrics } from "@/hooks/use-telemetry-store";
import type { PinState, BatchStats } from "@/hooks/use-simulation-store";

interface SimulatorOutputContainerProps {
  renderedSerialOutput: OutputLine[];
  serialOutput: OutputLine[];
  isConnected: boolean;
  simulationStatus: "running" | "stopped" | "paused";
  handleSerialSend: (message: string) => void;
  handleClearSerialOutput: () => void;
  showSerialMonitor: boolean;
  showSerialPlotter: boolean;
  serialViewMode: SerialViewMode;
  cycleSerialViewMode: () => void;
  autoScrollEnabled: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;
  serialInputValue: string;
  setSerialInputValue: (value: string) => void;
  handleSerialInputKeyDown: (e: React.KeyboardEvent) => void;
  handleSerialInputSend: () => void;
  debugMode: boolean;
  telemetryData: { last: TelemetryMetrics | null } | null;
  baudRate: number;

  pinMonitorVisible: boolean;
  pinStates: PinState[];
  batchStats: BatchStats;
  txActivity: number;
  rxActivity: number;
  handleReset: () => void;
  handlePinToggle: (pin: number, newValue: number) => void;
  analogPinsUsed: number[];
  handleAnalogChange: (pin: number, newValue: number) => void;
}

export default function SimulatorOutputContainer({
  renderedSerialOutput,
  serialOutput,
  isConnected,
  simulationStatus,
  handleSerialSend,
  handleClearSerialOutput,
  showSerialMonitor,
  showSerialPlotter,
  serialViewMode,
  cycleSerialViewMode,
  autoScrollEnabled,
  setAutoScrollEnabled,
  serialInputValue,
  setSerialInputValue,
  handleSerialInputKeyDown,
  handleSerialInputSend,
  debugMode,
  telemetryData,
  baudRate,
  pinMonitorVisible,
  pinStates,
  batchStats,
  txActivity,
  rxActivity,
  handleReset,
  handlePinToggle,
  analogPinsUsed,
  handleAnalogChange,
}: SimulatorOutputContainerProps) {
  return (
    <ResizablePanel defaultSize={50} minSize={20} id="output-panel">
      <ResizablePanelGroup direction="vertical" id="output-layout">
        <ResizablePanel defaultSize={50} minSize={20} id="serial-panel">
          <SerialMonitorView
            renderedSerialOutput={renderedSerialOutput}
            serialOutput={serialOutput}
            isConnected={isConnected}
            simulationStatus={simulationStatus}
            handleSerialSend={handleSerialSend}
            handleClearSerialOutput={handleClearSerialOutput}
            showSerialMonitor={showSerialMonitor}
            showSerialPlotter={showSerialPlotter}
            serialViewMode={serialViewMode}
            cycleSerialViewMode={cycleSerialViewMode}
            autoScrollEnabled={autoScrollEnabled}
            setAutoScrollEnabled={setAutoScrollEnabled}
            serialInputValue={serialInputValue}
            setSerialInputValue={setSerialInputValue}
            handleSerialInputKeyDown={handleSerialInputKeyDown}
            handleSerialInputSend={handleSerialInputSend}
            debugMode={debugMode}
            telemetryData={telemetryData}
            baudRate={baudRate}
          />
        </ResizablePanel>

        <ResizableHandle withHandle data-testid="vertical-resizer-board" />

        <ResizablePanel defaultSize={50} minSize={20} id="board-panel">
          <SimulatorSidebar
            pinMonitorVisible={pinMonitorVisible}
            pinStates={pinStates}
            batchStats={batchStats}
            simulationStatus={simulationStatus}
            txActivity={txActivity}
            rxActivity={rxActivity}
            onReset={handleReset}
            onPinToggle={handlePinToggle}
            analogPins={analogPinsUsed}
            onAnalogChange={handleAnalogChange}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
  );
}
