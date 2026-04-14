import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { ServerStatus } from "@/hooks/use-backend-health";

// ── Helpers ──────────────────────────────────────────────────────────────────

function simStateColor(status: SimulationStatus): string {
  switch (status) {
    case "running": return "text-emerald-400";
    case "paused": return "text-amber-300";
    case "compiling": return "text-blue-300";
    case "queued": return "text-violet-300";
    case "stopped": return "text-white/60";
    default: return "text-white/40";
  }
}

function simStateLabel(status: SimulationStatus): string {
  return status.toUpperCase();
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SimCockpitProps {
  batchStats?: unknown;
  simulationStatus?: SimulationStatus;
  sandboxMode?: string;
  workerIndex?: number;
  workerTotal?: number;
  backendReachable?: boolean;
  isConnected?: boolean;
  serverStatus?: ServerStatus;
  debugMode?: boolean;
}

export const SimCockpit: React.FC<SimCockpitProps> = React.memo(({
  simulationStatus = "idle",
  sandboxMode = "unknown",
  workerIndex,
  workerTotal,
  backendReachable = true,
  isConnected = true,
  serverStatus = null,
  debugMode = false,
}) => {
  const { lastHeartbeatAt } = useTelemetryStore();

  const wsActive = isConnected && lastHeartbeatAt && Date.now() - lastHeartbeatAt < 2000;
  const serverOnline = backendReachable && isConnected;

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
    <div className="hidden lg:flex items-center gap-4 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-4 py-2 text-[10px] uppercase tracking-wider font-medium shadow-2xl">

      {/* Server status indicator — always visible */}
      <div className="flex items-center gap-2">
        <div className="relative flex h-3 w-3">
          {serverOnline && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span className={clsx("relative inline-flex rounded-full h-3 w-3", serverOnline ? "bg-emerald-500" : "bg-red-600")}></span>
        </div>
        <div className="flex flex-col items-start">
          <span className="text-white/40 leading-none mb-0.5">Server</span>
          <span className={clsx("text-[9px] font-bold", serverOnline ? "text-emerald-400" : "text-red-400")}>
            {serverOnline ? "ONLINE" : (!backendReachable ? "HTTP DOWN" : "WS DOWN")}
          </span>
        </div>
      </div>

      {/* Simulation state — always visible */}
      <div className="flex flex-col items-start">
        <span className="text-white/40 leading-none mb-0.5">State</span>
        <span className={clsx("text-[9px] font-bold", simStateColor(simulationStatus))}>
          {simStateLabel(simulationStatus)}
        </span>
      </div>

      {/* Pool stats — visible when serverStatus is available */}
      {serverStatus && (
        <>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col items-start">
            <span className="text-white/40 leading-none mb-0.5">Runners</span>
            <span className="text-[9px] font-bold text-cyan-300">
              {serverStatus.pool.inUse}/{serverStatus.pool.total}
              {serverStatus.pool.queued > 0 && (
                <span className="text-amber-300 ml-1">+{serverStatus.pool.queued}q</span>
              )}
            </span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-white/40 leading-none mb-0.5">Compile</span>
            <span className="text-[9px] font-bold text-blue-300">
              {serverStatus.compile.active}/{serverStatus.compile.maxConcurrent}
              {serverStatus.compile.queued > 0 && (
                <span className="text-amber-300 ml-1">+{serverStatus.compile.queued}q</span>
              )}
            </span>
          </div>
        </>
      )}

      {/* Debug-only details */}
      {debugMode && (
        <>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col items-start">
            <span className="text-white/40 leading-none mb-0.5">WS Link</span>
            <span className={clsx("text-[9px] font-bold", wsActive ? "text-emerald-400" : "text-red-500")}>
              {wsActive ? "STABLE" : "DISCONNECTED"}
            </span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-white/40 leading-none mb-0.5">Mode</span>
            <span className={clsx("text-[9px] font-bold", sandboxModeColor)}>
              {sandboxModeLabel}
            </span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-white/40 leading-none mb-0.5">Worker</span>
            <span className="text-[9px] font-bold text-violet-300">{workerLabel}</span>
          </div>
        </>
      )}
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";
