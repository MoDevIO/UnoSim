import React, { Suspense } from "react";
import { InputGroup } from "@/components/ui/input-group";
import { SerialMonitor } from "@/components/features/serial-monitor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Terminal, BarChart, Columns, Trash2, ChevronsDown, LayoutGrid, Table } from "lucide-react";
import { useSimulationUi } from "@/hooks/use-simulation-ui";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

const SerialPlotter = React.lazy(() => import("@/components/features/serial-plotter").then((m) => ({ default: m.SerialPlotter })));

const LoadingPlaceholder = () => (
  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
    <span className="text-ui-sm">Loading chart...</span>
  </div>
);

export const DebugConsole: React.FC = () => {
  const ui = useSimulationUi();
  const { toast } = useToast();
  const debugMessages = ui.debugMessages;
  const debugViewMode = ui.debugViewMode;
  const setDebugViewMode = ui.setDebugViewMode;
  const debugMessageFilter = ui.debugMessageFilter;
  const setDebugMessageFilter = ui.setDebugMessageFilter;
  const debugMessagesContainerRef = ui.debugMessagesContainerRef;
  const setDebugMessages = ui.setDebugMessages;

  if (!ui.debugMode) return null;

  return (
    <div className="border-t border-muted-foreground/20 bg-muted/50">
      <div className="px-3 h-[var(--ui-button-height)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-ui-sm text-muted-foreground whitespace-nowrap">Filter:</span>
          <select value={debugMessageFilter ?? ""} onChange={(e) => setDebugMessageFilter?.(e.target.value.toLowerCase())} className="flex-1 px-2 py-1 text-ui-sm bg-background border border-muted-foreground/20 rounded text-foreground min-w-0 max-w-xs">
            <option value="">All Types</option>
            {Array.from(new Set((debugMessages || []).map((m) => m.type))).sort().map((type) => (
              <option key={type} value={type.toLowerCase()}>{type}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setDebugViewMode?.(debugViewMode === "table" ? "tiles" : "table")} className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center text-ui-sm bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded hover:bg-cyan-600/30 transition-colors" title={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"}>
            {debugViewMode === "table" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Table className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => {
            const messages = (debugMessages || []).filter((m: any) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).map((m: any) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.sender.toUpperCase()} (${m.type}): ${m.content}`).join('\n');
            if (messages) {
              navigator.clipboard.writeText(messages);
              toast({ title: "Copied to clipboard", description: `${(debugMessages || []).filter((m: any) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length} messages` });
            }
          }} className="h-[var(--ui-button-height)] px-2 text-ui-sm bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded hover:bg-cyan-600/30 transition-colors">Copy</button>
          <button onClick={() => setDebugMessages?.([])} className="h-[var(--ui-button-height)] px-2 text-ui-sm bg-red-600/20 text-red-400 border border-red-600/40 rounded hover:bg-red-600/30 transition-colors">Clear</button>
        </div>
      </div>

      {debugViewMode === "table" ? (
        <ScrollArea className="h-48" viewportRef={debugMessagesContainerRef} thumbClassName="bg-status-success">
          <table className="w-full text-ui-sm border-collapse">
            <thead className="text-ui-sm text-muted-foreground bg-muted/30 sticky top-0">
              <tr>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Sender</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Message</th>
              </tr>
            </thead>
            <tbody className="text-ui-xs">
              {(debugMessages || []).filter((m: any) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).slice().reverse().map((m: any) => (
                <tr key={m.id} className="border-t border-muted-foreground/10">
                  <td className="p-2 align-top font-mono text-ui-sm">{new Date(m.timestamp).toLocaleTimeString()}</td>
                  <td className="p-2 align-top font-mono text-ui-sm">{m.sender}</td>
                  <td className="p-2 align-top font-mono text-ui-sm">{m.type}</td>
                  <td className="p-2 align-top break-words whitespace-pre-wrap text-ui-sm">{m.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      ) : (
        <ScrollArea className="h-48" viewportRef={debugMessagesContainerRef} thumbClassName="bg-status-success">
          <div className="p-3 space-y-3">
            {(debugMessages || []).filter((m: any) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).slice().reverse().map((m: any) => (
              <div key={m.id} className="p-2 border border-muted-foreground/10 rounded bg-background">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-ui-xs font-mono text-muted-foreground">{new Date(m.timestamp).toLocaleTimeString()}</div>
                  <div className="text-ui-xs font-mono text-muted-foreground">{m.sender}</div>
                </div>
                <div className="text-ui-xs font-mono mb-1 text-cyan-300">{m.type}</div>
                <pre className="text-ui-xs whitespace-pre-wrap break-words">{m.content}</pre>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};


export default function SimulatorOutputPanel(props: {
  simulationStatus?: string;
  serialOutput?: any[];
  renderedSerialOutput?: any[];
  serialViewMode?: "monitor" | "plotter" | "both";
  autoScrollEnabled?: boolean;
  setAutoScrollEnabled?: (v: boolean) => void;
  serialInputValue?: string;
  setSerialInputValue?: (v: string) => void;
  showSerialMonitor?: boolean;
  showSerialPlotter?: boolean;
  cycleSerialViewMode?: () => void;
  clearSerialOutput?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const { ensureBackendConnected } = useBackendHealth(queryClient);
  const { toast } = useToast();
  const { sendMessage } = useWebSocket();

  const telemetryData = useTelemetryStore();

  // Prefer props (page-provided) but fall back to provider/context values for
  // backwards compatibility. The provider may not be passed the page-level
  // serial state after the refactor, so prefer explicit props from the page.
  const ui = useSimulationUi();

  const serialOutput = props.serialOutput ?? ui.serialOutput ?? [];
  const renderedSerialOutput = props.renderedSerialOutput ?? ui.renderedSerialOutput ?? [];
  const serialViewMode = props.serialViewMode ?? ui.serialViewMode ?? "monitor";
  const autoScrollEnabled = props.autoScrollEnabled ?? ui.autoScrollEnabled ?? false;
  const setAutoScrollEnabled = props.setAutoScrollEnabled ?? ui.setAutoScrollEnabled;
  const serialInputValue = props.serialInputValue ?? ui.serialInputValue ?? "";
  const setSerialInputValue = props.setSerialInputValue ?? ui.setSerialInputValue;
  const showSerialMonitor = props.showSerialMonitor ?? ui.showSerialMonitor ?? true;
  const showSerialPlotter = props.showSerialPlotter ?? ui.showSerialPlotter ?? false;
  const cycleSerialViewMode = props.cycleSerialViewMode ?? ui.cycleSerialViewMode;
  const clearSerialOutput = props.clearSerialOutput ?? ui.clearSerialOutput;

  const simulationStatus = props.simulationStatus ?? ui.simulationStatus;
  const setTxActivity = ui.setTxActivity;
  const debugMode = ui.debugMode;

  const handleSerialSend = (message: string) => {
    if (!ensureBackendConnected("Serial senden")) return;

    if (simulationStatus !== "running") {
      toast({
        title: simulationStatus === "paused" ? "Simulation paused" : "Simulation not running",
        description:
          simulationStatus === "paused"
            ? "Resume the simulation to send serial input."
            : "Start the simulation to send serial input.",
        variant: "destructive",
      });
      return;
    }

    setTxActivity?.((prev) => prev + 1);
    sendMessage({ type: "serial_input", data: message });
  };

  const handleSerialInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSerialSend(serialInputValue);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Static Serial Header (always full width) */}
      <div className="bg-muted px-4 border-b border-border flex items-center h-[var(--ui-header-height)]">
        <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <span className="sr-only">Serial Output</span>
          </div>

          {debugMode && (simulationStatus === "running" || simulationStatus === "paused") && telemetryData.last ? (
            <div className="ml-4 flex items-center gap-4 text-xs text-muted-foreground border-l border-muted-foreground/30 pl-4">
              <div className="flex flex-col">
                <span className="text-ui-sm uppercase tracking-wider text-cyan-500/50">Serial Events</span>
                <span className="text-ui-sm font-mono text-cyan-400">{(telemetryData.last.serialOutputPerSecond ?? 0).toFixed(1)} /s</span>
              </div>
              <div className="flex flex-col">
                <span className="text-ui-xs uppercase tracking-wider text-cyan-500/50">Serial Bytes</span>
                <span className="text-ui-xs font-mono text-cyan-400">{(telemetryData.last.serialBytesPerSecond ?? 0).toFixed(1)} /s</span>
              </div>
            </div>
          ) : null}

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
              onClick={cycleSerialViewMode}
              data-testid="button-serial-view-toggle"
              aria-label={serialViewMode === "monitor" ? "Monitor only" : serialViewMode === "plotter" ? "Plotter only" : "Split view"}
              title={serialViewMode === "monitor" ? "Monitor only" : serialViewMode === "plotter" ? "Plotter only" : "Split view"}
            >
              {serialViewMode === "monitor" ? <Terminal className="h-4 w-4" /> : serialViewMode === "plotter" ? <BarChart className="h-4 w-4" /> : <Columns className="h-4 w-4" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={"h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"}
              onClick={() => setAutoScrollEnabled?.(!autoScrollEnabled)}
              disabled={serialViewMode === "plotter"}
              title={autoScrollEnabled ? "Autoscroll on" : "Autoscroll off"}
              aria-pressed={autoScrollEnabled}
              data-testid="button-autoscroll"
            >
              <ChevronsDown className={"h-4 w-4"} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
              onClick={() => clearSerialOutput?.()}
              aria-label="Clear serial output"
              title="Clear serial output"
              data-testid="button-clear-serial"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {/* Serial area */}
        {showSerialMonitor && showSerialPlotter ? (
          <ResizablePanelGroup direction="horizontal" className="h-full" id="serial-split">
            <ResizablePanel defaultSize={50} minSize={20} id="serial-monitor-panel">
              <div className="h-full flex flex-col">
                <div className="flex-1 min-h-0">
                  <SerialMonitor
                    output={renderedSerialOutput}
                    isConnected={true}
                    isSimulationRunning={simulationStatus !== "stopped"}
                    onSendMessage={handleSerialSend}
                    onClear={clearSerialOutput ?? (() => {})}
                    showMonitor={showSerialMonitor}
                    autoScrollEnabled={autoScrollEnabled}
                  />
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle data-testid="horizontal-resizer-serial" />

            <ResizablePanel defaultSize={50} minSize={20} id="serial-plot-panel">
              <div className="h-full">
                <Suspense fallback={<LoadingPlaceholder />}>
                  <SerialPlotter output={serialOutput} />
                </Suspense>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : showSerialMonitor ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0">
              <SerialMonitor
                output={renderedSerialOutput}
                isConnected={true}
                isSimulationRunning={simulationStatus !== "stopped"}
                onSendMessage={handleSerialSend}
                onClear={clearSerialOutput ?? (() => {})}
                showMonitor={showSerialMonitor}
                autoScrollEnabled={autoScrollEnabled}
              />
            </div>
          </div>
        ) : (
          <div className="h-full">
            <Suspense fallback={<LoadingPlaceholder />}>
              <SerialPlotter output={serialOutput} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 flex-shrink-0">
        <div className="w-full">
          <InputGroup
            type="text"
            placeholder="Send to Arduino..."
            value={serialInputValue}
            onChange={(e) => setSerialInputValue?.(e.target.value)}
            onKeyDown={handleSerialInputKeyDown}
            onSubmit={() => handleSerialSend(serialInputValue)}
            disabled={!serialInputValue.trim() || simulationStatus !== "running"}
            inputTestId="input-serial"
            buttonTestId="button-send-serial"
          />
        </div>
      </div>

      {/* Debug console: extracted so it can be shown as a dedicated "Telemetry" tab */}
      {/* DebugConsole component exported below for reuse in the Output tabs */}
    </div>
  );
}
