import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import type { SimulationStatus } from "@shared/types/arduino.types";

export const SimCockpit: React.FC<{ 
  batchStats?: unknown;
  simulationStatus?: SimulationStatus;
  sandboxMode?: string;
  workerIndex?: number;
  workerTotal?: number;
}> = React.memo(({ simulationStatus = "idle", sandboxMode = "unknown", workerIndex, workerTotal }) => {
  const { lastHeartbeatAt } = useTelemetryStore();

  // Show 0 values when paused or stopped
  const isSimActive = simulationStatus === "running";
  const isActive = isSimActive && lastHeartbeatAt && Date.now() - lastHeartbeatAt < 2000;

  let sandboxModeColor = "text-white/50";
  let sandboxModeLabel = "Unknown";

  if (sandboxMode === "docker-sandbox") {
    sandboxModeColor = "text-cyan-300";
    sandboxModeLabel = "Docker Sandbox";
  } else if (sandboxMode === "local-limited") {
    sandboxModeColor = "text-amber-300";
    sandboxModeLabel = "Local Limited";
  }

  const workerLabel =
    workerIndex !== undefined && workerTotal !== undefined
      ? `#${workerIndex + 1} / ${workerTotal}`
      : "—";

  return (
    <div className="hidden lg:flex items-center gap-6 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-4 py-2 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
      {/* Health Indicator - Link State Only */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-white/40 leading-none mb-1 text-right">Link State</span>
          <span className={clsx("text-[9px] font-bold", isActive ? "text-emerald-400" : "text-red-500")}>
            {isActive ? "STABLE" : "DISCONNECTED"}
          </span>
        </div>
        <div className="relative flex h-3 w-3">
          {isActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span className={clsx("relative inline-flex rounded-full h-3 w-3", isActive ? "bg-emerald-500" : "bg-red-600")}></span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-white/40 leading-none mb-1 text-right">Sandbox Mode</span>
          <span className={clsx("text-[9px] font-bold", sandboxModeColor)}>
            {sandboxModeLabel}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-white/40 leading-none mb-1 text-right">Worker</span>
          <span className="text-[9px] font-bold text-violet-300">{workerLabel}</span>
        </div>
      </div>
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";