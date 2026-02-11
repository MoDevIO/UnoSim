import { useDebugMode } from "@/hooks/use-debug-mode-store";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

interface SerialMonitorDebugHeaderProps {
  simulationStatus?: "running" | "stopped" | "paused";
}

export function SerialMonitorDebugHeader({
  simulationStatus = "stopped",
}: SerialMonitorDebugHeaderProps) {
  const { debugMode } = useDebugMode();
  const { last: telemetry } = useTelemetryStore();

  const isRunning = simulationStatus !== "stopped";

  if (!debugMode || !isRunning || !telemetry) {
    return null;
  }

  const dropped = telemetry.serialDroppedBytesPerSecond ?? 0;
  const bytes = telemetry.serialBytesPerSecond ?? 0;
  const chunks = telemetry.serialOutputPerSecond ?? 0;
  const total = (telemetry.serialBytesTotal ?? 0) / 1024; // Convert to KB

  const droppedColor = dropped > 0 ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="bg-muted/50 border-b border-muted-foreground/30 px-3 h-8 flex items-center justify-between gap-4 flex-shrink-0 text-ui-xs font-mono">
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">
          Serial /s: <span className="text-cyan-400">{chunks.toFixed(1)}</span>
        </span>
        <span className="text-muted-foreground">
          Bytes /s: <span className="text-cyan-400">{bytes.toFixed(1)}</span> B
        </span>
        <span className={droppedColor}>
          Dropped /s: <span className={dropped > 0 ? "font-bold" : ""}>{dropped.toFixed(1)}</span> B
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">
          Total: <span className="text-cyan-400">{total.toFixed(1)}</span> KB
        </span>
      </div>
    </div>
  );
}
