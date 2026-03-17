import React, { lazy } from "react";
import { Terminal, ChevronsDown, BarChart, Columns, Monitor, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { clsx } from "clsx";
import { SerialMonitor } from "@/components/features/serial-monitor";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

const SerialPlotter = lazy(() =>
  import("@/components/features/serial-plotter").then((m) => ({
    default: m.SerialPlotter,
  })),
);

const LoadingPlaceholder = () => (
  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
    <span className="text-ui-sm">Loading chart...</span>
  </div>
);

export type SerialViewMode = "monitor" | "plotter" | "both";

import type { OutputLine } from "@shared/schema";
import type { RuntimeSimulationStatus } from "@shared/types/arduino.types";
import type { TelemetryMetrics } from "@/hooks/use-telemetry-store";

interface SerialMonitorViewProps {
  readonly renderedSerialOutput: OutputLine[];
  readonly serialOutput: OutputLine[];
  readonly isConnected: boolean;
  readonly simulationStatus: RuntimeSimulationStatus;
  readonly handleSerialSend: (message: string) => void;
  readonly handleClearSerialOutput: () => void;
  readonly showSerialMonitor: boolean;
  readonly showSerialPlotter: boolean;
  readonly serialViewMode: SerialViewMode;
  readonly cycleSerialViewMode: () => void;
  readonly autoScrollEnabled: boolean;
  readonly setAutoScrollEnabled: (value: boolean) => void;
  readonly serialInputValue: string;
  readonly setSerialInputValue: (value: string) => void;
  readonly handleSerialInputKeyDown: (e: React.KeyboardEvent) => void;
  readonly handleSerialInputSend: () => void;
  readonly debugMode: boolean;
  readonly telemetryData: { last: TelemetryMetrics | null } | null;
  readonly baudRate: number;
}

export function SerialMonitorView(props: SerialMonitorViewProps) {
  const {
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
  } = props;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        {/* Serial area: Unified container with a single static header */}
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-[var(--header-padding-x)] h-[var(--ui-header-height)] bg-muted border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground mr-1" strokeWidth={1.5} />
              <span className="font-semibold text-xs tracking-wide uppercase text-muted-foreground/80">Serial Output</span>
              {debugMode && (simulationStatus === "running" || simulationStatus === "paused") ? (
                <div className="flex items-center gap-3 ml-2 border-l border-muted-foreground/20 pl-4">
                  {telemetryData?.last ? (
                    <div className="flex flex-col leading-tight">
                      <span className="text-[9px] uppercase tracking-wider text-cyan-500/50">Events</span>
                      <span className="text-[11px] font-mono text-cyan-400">
                        {(telemetryData.last.serialOutputPerSecond ?? 0).toFixed(0)}/s
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-col leading-tight">
                    <span className="text-[9px] uppercase tracking-wider text-cyan-500/50">Baud</span>
                    <span className="text-[11px] font-mono text-cyan-400">{baudRate}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                onClick={cycleSerialViewMode}
                data-testid="button-serial-view-toggle"
                aria-label={
                  serialViewMode === "monitor"
                    ? "Monitor only"
                    : serialViewMode === "plotter"
                    ? "Plotter only"
                    : "Split view"
                }
                title={
                  serialViewMode === "monitor"
                    ? "Monitor only"
                    : serialViewMode === "plotter"
                    ? "Plotter only"
                    : "Split view"
                }
              >
                {serialViewMode === "monitor" ? (
                  <Terminal className="h-4 w-4" />
                ) : serialViewMode === "plotter" ? (
                  <BarChart className="h-4 w-4" />
                ) : (
                  <Columns className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={clsx(
                  "h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center",
                  autoScrollEnabled ? "text-cyan-400" : "text-muted-foreground",
                )}
                onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
                disabled={serialViewMode === "plotter"}
                title={autoScrollEnabled ? "Autoscroll on" : "Autoscroll off"}
                aria-label={autoScrollEnabled ? "Autoscroll on" : "Autoscroll off"}
                aria-pressed={autoScrollEnabled}
                data-testid="button-autoscroll"
              >
                <ChevronsDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                onClick={handleClearSerialOutput}
                aria-label="Clear serial output"
                title="Clear serial output"
                data-testid="button-clear-serial"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-h-0">
            {showSerialMonitor && showSerialPlotter ? (
              <ResizablePanelGroup direction="horizontal" className="h-full" id="serial-split">
                <ResizablePanel defaultSize={50} minSize={20} id="serial-monitor-panel">
                  <div className="h-full flex flex-col">
                    <div className="flex-1 min-h-0">
                      <SerialMonitor
                        output={renderedSerialOutput}
                        isConnected={isConnected}
                        isSimulationRunning={simulationStatus !== "stopped"}
                        onSendMessage={handleSerialSend}
                        onClear={handleClearSerialOutput}
                        showMonitor={showSerialMonitor}
                        autoScrollEnabled={autoScrollEnabled}
                        showHeader={false}
                      />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle data-testid="horizontal-resizer-serial" />
                <ResizablePanel defaultSize={50} minSize={20} id="serial-plot-panel">
                  <div className="h-full">
                    <React.Suspense fallback={<LoadingPlaceholder />}>
                      <SerialPlotter output={serialOutput} />
                    </React.Suspense>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : showSerialMonitor ? (
              <div className="h-full flex flex-col">
                <div className="flex-1 min-h-0">
                  <SerialMonitor
                    output={renderedSerialOutput}
                    isConnected={isConnected}
                    isSimulationRunning={simulationStatus !== "stopped"}
                    onSendMessage={handleSerialSend}
                    onClear={handleClearSerialOutput}
                    showMonitor={showSerialMonitor}
                    autoScrollEnabled={autoScrollEnabled}
                    showHeader={false}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full">
                <React.Suspense fallback={<LoadingPlaceholder />}>
                  <SerialPlotter output={serialOutput} />
                </React.Suspense>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="p-3 flex-shrink-0">
        <div className="w-full">
          <InputGroup
            type="text"
            placeholder="Send to Arduino..."
            value={serialInputValue}
            onChange={(e) => setSerialInputValue(e.target.value)}
            onKeyDown={handleSerialInputKeyDown}
            onSubmit={handleSerialInputSend}
            disabled={!serialInputValue.trim() || simulationStatus !== "running"}
          />
        </div>
      </div>
    </div>
  );
}
