import React, { lazy, useState, useEffect, useRef } from "react";
import { Terminal, ChevronsDown, BarChart, Columns, Monitor, Trash2 } from "lucide-react";
import { PanelHeader } from "@/components/ui/panel-header";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { InputGroup } from "@/components/ui/input-group";
import { getSerialLineEnding } from "@/lib/serial-line-ending";
import { clsx } from "clsx";
import type { ServerCapabilities } from "@/lib/server-capabilities";
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

// View mode labels and icons
const SERIAL_VIEW_LABELS: Record<SerialViewMode, string> = {
  monitor: "Monitor only",
  plotter: "Plotter only",
  both: "Split view",
};

const getSerialViewIcon = (mode: SerialViewMode) => {
  switch (mode) {
    case "monitor":
      return <Terminal className="h-4 w-4" />;
    case "plotter":
      return <BarChart className="h-4 w-4" />;
    case "both":
      return <Columns className="h-4 w-4" />;
  }
};

const serialPortName = (port: number): string => (port === 0 ? "Serial" : `Serial${port}`);

/** Selector for the hardware serial port the monitor shows (boards with more than one: Mega 2560). */
function SerialPortSelector(props: {
  readonly count: number;
  readonly selected: number;
  readonly onSelect: (port: number) => void;
}) {
  const { count, selected, onSelect } = props;
  return (
    <div role="tablist" aria-label="Serial port" className="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5" data-testid="serial-port-selector">
      {Array.from({ length: count }, (_, port) => (
        <button
          key={port}
          type="button"
          role="tab"
          aria-selected={port === selected}
          className={clsx(
            "rounded px-2 py-0.5 font-mono text-ui-xs transition-colors",
            port === selected ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelect(port)}
          data-testid={`serial-port-${port}`}
        >
          {serialPortName(port)}
        </button>
      ))}
    </div>
  );
}

interface SerialContentAreaProps {
  showSerialMonitor: boolean;
  showSerialPlotter: boolean;
  serialOutput: OutputLine[];
  renderedSerialOutput: OutputLine[];
  isConnected: boolean;
  simulationStatus: RuntimeSimulationStatus;
  handleSerialSend: (message: string) => void;
  handleClearSerialOutput: () => void;
  autoScrollEnabled: boolean;
}

const SerialContentArea = ({
  showSerialMonitor,
  showSerialPlotter,
  serialOutput,
  renderedSerialOutput,
  isConnected,
  simulationStatus,
  handleSerialSend,
  handleClearSerialOutput,
  autoScrollEnabled,
}: SerialContentAreaProps) => {
  if (showSerialMonitor && showSerialPlotter) {
    return (
      <ResizablePanelGroup direction="horizontal" className="h-full" id="serial-split">
        <ResizablePanel defaultSize={50} minSize={20} id="serial-monitor-panel">
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0">
              <SerialMonitor
                output={renderedSerialOutput}
                isConnected={isConnected}
                isSimulationRunning={simulationStatus !== "idle"}
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
    );
  }

  if (showSerialMonitor) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0">
          <SerialMonitor
            output={renderedSerialOutput}
            isConnected={isConnected}
            isSimulationRunning={simulationStatus !== "idle"}
            onSendMessage={handleSerialSend}
            onClear={handleClearSerialOutput}
            showMonitor={showSerialMonitor}
            autoScrollEnabled={autoScrollEnabled}
            showHeader={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <React.Suspense fallback={<LoadingPlaceholder />}>
        <SerialPlotter output={serialOutput} />
      </React.Suspense>
    </div>
  );
};

export type SerialViewMode = "monitor" | "plotter" | "both";

import type { OutputLine } from "@shared/schema";
import type { RuntimeSimulationStatus } from "@shared/types/arduino.types";
import type { TelemetryMetrics } from "@/hooks/use-telemetry-store";

interface SerialMonitorViewProps {
  readonly renderedSerialOutput: OutputLine[];
  readonly serialOutput: OutputLine[];
  readonly isConnected: boolean;
  readonly capabilities?: ServerCapabilities;
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
  /** The port the monitor shows, the ports of the board (the selector appears above 1) and the setter. */
  readonly serialPort?: number;
  readonly serialPortCount?: number;
  readonly setSerialPort?: (port: number) => void;
  /** Sends the typed text followed by the chosen line ending, like the Arduino IDE serial monitor. */
  readonly handleSerialInputSend: (lineEnding: string) => void;
  readonly debugMode: boolean;
  readonly telemetryData: { last: TelemetryMetrics | null } | null;
  readonly baudRate: number;
}

export function SerialMonitorView(props: SerialMonitorViewProps) {
  const {
    renderedSerialOutput,
    serialOutput,
    isConnected,
    capabilities,
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
    handleSerialInputSend,
    debugMode,
    telemetryData,
    baudRate,
  } = props;
  const serialPort = props.serialPort ?? 0;
  const serialPortCount = props.serialPortCount ?? 1;

  const lastTelemetry = telemetryData?.last;
  const serialTelegramsPerSecond = lastTelemetry?.serialOutputPerSecond ?? 0;
  const serialBytesPerSecond = lastTelemetry?.serialBytesPerSecond ?? 0;
  const [fallbackSerialTelemetry, setFallbackSerialTelemetry] = useState({
    telegramsPerSecond: 0,
    bytesPerTelegram: 0,
  });

  const serialEventsRef = useRef<Array<{ ts: number; bytes: number }>>([]);
  const lastSerialIndexRef = useRef(0);

  // Track received serial_output messages to compute a local per-second rate.
  // Use whichever output list is actually being rendered (renderedSerialOutput
  // usually contains the visible text).
  useEffect(() => {
    const now = Date.now();
    const source = serialOutput.length > 0 ? serialOutput : renderedSerialOutput;

    // Reset when output is cleared
    if (source.length < lastSerialIndexRef.current) {
      lastSerialIndexRef.current = 0;
      serialEventsRef.current = [];
    }

    for (let i = lastSerialIndexRef.current; i < source.length; i += 1) {
      const bytes = source[i]?.text?.length ?? 0;
      serialEventsRef.current.push({ ts: now, bytes });
    }
    lastSerialIndexRef.current = source.length;

    // Keep only last 2 seconds of history
    const cutoff = now - 2000;
    serialEventsRef.current = serialEventsRef.current.filter((e) => e.ts >= cutoff);
  }, [serialOutput, renderedSerialOutput]);

  // Update fallback telemetry once per second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const windowStart = now - 1000;
      const window = serialEventsRef.current.filter((e) => e.ts >= windowStart);
      const count = window.length;
      const totalBytes = window.reduce((acc, e) => acc + e.bytes, 0);
      setFallbackSerialTelemetry({
        telegramsPerSecond: count,
        bytesPerTelegram: count > 0 ? totalBytes / count : 0,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const effectiveTelegramsPerSecond =
    serialTelegramsPerSecond > 0 ? serialTelegramsPerSecond : fallbackSerialTelemetry.telegramsPerSecond;
  const effectiveBytesPerTelegram =
    serialTelegramsPerSecond > 0 
      ? (serialBytesPerSecond / serialTelegramsPerSecond) 
      : fallbackSerialTelemetry.bytesPerTelegram;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        {/* Serial area: Unified container with a single static header */}
        <div className="h-full flex flex-col">
          <PanelHeader
            title="Serial Output"
            icon={<Monitor className="!h-5 !w-5" aria-hidden="true" strokeWidth={1.5} />}
            leadingContent={debugMode && (simulationStatus === "running" || simulationStatus === "paused") ? (
              <div className="ml-2 flex items-center gap-3 border-l pl-4">
                <div className="flex flex-col leading-tight">
                  <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Baud</span>
                  <span className="font-mono text-cyan-400" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }}>{baudRate}</span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Tel/s</span>
                  <span className="font-mono text-cyan-400" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }}>
                    {effectiveTelegramsPerSecond.toFixed(0)}/s
                  </span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Bytes/Telegramm</span>
                  <span className="font-mono text-cyan-400" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }}>
                    {effectiveBytesPerTelegram.toFixed(0)} B
                  </span>
                </div>
              </div>
            ) : undefined}
            actions={
              <>
              <ToolbarIconButton
                icon={getSerialViewIcon(serialViewMode)}
                label={SERIAL_VIEW_LABELS[serialViewMode]}
                onClick={cycleSerialViewMode}
                data-testid="button-serial-view-toggle"
              />
              <ToolbarIconButton
                icon={<ChevronsDown className="h-4 w-4" />}
                label={autoScrollEnabled ? "Autoscroll on" : "Autoscroll off"}
                className={clsx(
                  autoScrollEnabled ? "text-cyan-400" : "text-muted-foreground",
                )}
                onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
                disabled={serialViewMode === "plotter"}
                aria-pressed={autoScrollEnabled}
                data-testid="button-autoscroll"
              />
              <ToolbarIconButton
                icon={<Trash2 className="h-4 w-4" />}
                label="Clear serial output"
                destructive
                onClick={handleClearSerialOutput}
                data-testid="button-clear-serial"
              />
              </>
            }
          />

          {serialPortCount > 1 && props.setSerialPort && (
            <div className="flex shrink-0 items-center border-b border-border bg-muted/40 px-[var(--header-padding-x)] py-1">
              <SerialPortSelector count={serialPortCount} selected={serialPort} onSelect={props.setSerialPort} />
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 min-h-0">
            <SerialContentArea
              showSerialMonitor={showSerialMonitor}
              showSerialPlotter={showSerialPlotter}
              serialOutput={serialOutput}
              renderedSerialOutput={renderedSerialOutput}
              isConnected={isConnected}
              simulationStatus={simulationStatus}
              handleSerialSend={handleSerialSend}
              handleClearSerialOutput={handleClearSerialOutput}
              autoScrollEnabled={autoScrollEnabled}
            />
          </div>
        </div>
      </div>
      <div className="p-3 flex-shrink-0">
        <div className="w-full">
          <InputGroup
            type="text"
            placeholder={serialPort === 0 ? "Send to Arduino..." : `Send to ${serialPortName(serialPort)}...`}
            value={serialInputValue}
            onChange={(e) => setSerialInputValue(e.target.value)}
            onSubmit={() => handleSerialInputSend(getSerialLineEnding())}
            title={capabilities && !capabilities.canUseRealtimeControls ? "Server connection required" : undefined}
            submitDisabled={!serialInputValue.trim()}
            disabled={
              simulationStatus !== "running" ||
              (capabilities !== undefined && !capabilities.canUseRealtimeControls)
            }
          />
        </div>
        {capabilities && !capabilities.canUseRealtimeControls && (
          <output className="mt-1 text-ui-xs text-muted-foreground" aria-live="polite">
            Server connection required
          </output>
        )}
      </div>
    </div>
  );
}
