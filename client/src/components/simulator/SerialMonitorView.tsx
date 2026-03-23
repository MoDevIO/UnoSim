import React, { lazy, useState, useEffect, useRef } from "react";
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
    );
  }

  if (showSerialMonitor) {
    return (
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
          <div className="flex items-center justify-between px-[var(--header-padding-x)] h-[var(--ui-header-height)] bg-muted border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground mr-1" strokeWidth={1.5} />
              <span className="font-semibold tracking-wide uppercase text-muted-foreground/80" style={{ fontSize: "var(--fs-body-xs)" }}>Serial Output</span>
              {debugMode && (simulationStatus === "running" || simulationStatus === "paused") ? (
                <div className="flex items-center gap-3 ml-2 border-l border-muted-foreground/20 pl-4">
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
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                onClick={cycleSerialViewMode}
                data-testid="button-serial-view-toggle"
                aria-label={SERIAL_VIEW_LABELS[serialViewMode]}
                title={SERIAL_VIEW_LABELS[serialViewMode]}
              >
                {getSerialViewIcon(serialViewMode)}
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
