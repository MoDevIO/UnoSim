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

  // ── Normal mode: minimal server indicator ──────────────────────────────
  if (!debugMode) {
    return (
      <div className="hidden lg:flex items-center gap-2 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
        <div className="relative flex h-2.5 w-2.5">
          {serverOnline && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", serverOnline ? "bg-emerald-500" : "bg-red-600")} />
        </div>
        <span className={clsx("text-[9px] font-bold", serverOnline ? "text-emerald-400" : "text-red-400")}>
          {serverOnline ? "SERVER" : (!backendReachable ? "OFFLINE" : "WS ✗")}
        </span>
      </div>
    );
  }

  // ── Debug mode: compact single-line strip ──────────────────────────────

  const modeLabel = sandboxMode === "docker-sandbox" ? "Docker"
    : sandboxMode === "local-limited" ? "Local" : "—";
  const modeColor = sandboxMode === "docker-sandbox" ? "text-cyan-300"
    : sandboxMode === "local-limited" ? "text-amber-300" : "text-white/40";

  const runnerLabel = workerIndex !== undefined && workerTotal !== undefined
    ? `#${workerIndex + 1}/${workerTotal}` : "—";

  return (
    <div className="hidden lg:flex items-center gap-3 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
      {/* Server dot + label */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex h-2.5 w-2.5">
          {serverOnline && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", serverOnline ? "bg-emerald-500" : "bg-red-600")} />
        </div>
        <span className={clsx("text-[9px] font-bold", serverOnline ? "text-emerald-400" : "text-red-400")}>
          {serverOnline ? "ON" : (!backendReachable ? "OFF" : "WS✗")}
        </span>
      </div>

      <span className="text-white/15">|</span>

      {/* Simulation state */}
      <span className={clsx("text-[9px] font-bold", simStateColor(simulationStatus))}>
        {simulationStatus.toUpperCase()}
      </span>

      {/* Pool + Compile stats */}
      {serverStatus && (
        <>
          <span className="text-white/15">|</span>
          <span className="text-[9px]">
            <span className="text-white/40">Pool </span>
            <span className="text-cyan-300 font-bold">
              {serverStatus.pool.inUse}/{serverStatus.pool.total}
            </span>
            {serverStatus.pool.queued > 0 && (
              <span className="text-amber-300 font-bold ml-0.5">+{serverStatus.pool.queued}q</span>
            )}
          </span>
          <span className="text-[9px]">
            <span className="text-white/40">GCC </span>
            <span className="text-blue-300 font-bold">
              {serverStatus.compile.active}/{serverStatus.compile.maxConcurrent}
            </span>
            {serverStatus.compile.queued > 0 && (
              <span className="text-amber-300 font-bold ml-0.5">+{serverStatus.compile.queued}q</span>
            )}
          </span>
        </>
      )}

      <span className="text-white/15">|</span>

      {/* WS heartbeat */}
      <span className="text-[9px]">
        <span className="text-white/40">WS </span>
        <span className={clsx("inline-block h-1.5 w-1.5 rounded-full align-middle", wsActive ? "bg-emerald-400" : "bg-red-500")} />
      </span>

      {/* Sandbox mode */}
      <span className={clsx("text-[9px] font-bold", modeColor)}>{modeLabel}</span>

      {/* Runner index */}
      <span className="text-[9px]">
        <span className="text-white/40">Runner </span>
        <span className="text-violet-300 font-bold">{runnerLabel}</span>
      </span>
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";
