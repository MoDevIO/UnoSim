import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { ServerStatus } from "@/hooks/use-backend-health";

// ── Pure helpers (extracted to keep component CC ≤ 15) ───────────────────────

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

/** Full label for normal-mode server indicator. */
function serverStatusLabel(serverOnline: boolean, backendReachable: boolean): string {
  if (serverOnline) return "SERVER";
  if (backendReachable) return "WS ✗";
  return "OFFLINE";
}

/** Abbreviated label used in the debug strip. */
function serverStatusShortLabel(serverOnline: boolean, backendReachable: boolean): string {
  if (serverOnline) return "ON";
  if (backendReachable) return "WS✗";
  return "OFF";
}

function sandboxModeLabel(sandboxMode: string): string {
  if (sandboxMode === "docker-sandbox") return "Docker";
  if (sandboxMode === "local-limited") return "Local";
  return "—";
}

function sandboxModeColorClass(sandboxMode: string): string {
  if (sandboxMode === "docker-sandbox") return "text-cyan-300";
  if (sandboxMode === "local-limited") return "text-amber-300";
  return "text-white/40";
}

function runnerIndexLabel(workerIndex?: number, workerTotal?: number): string {
  if (workerIndex !== undefined && workerTotal !== undefined) {
    return `#${workerIndex + 1}/${workerTotal}`;
  }
  return "—";
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

  const wsActive = isConnected && !!lastHeartbeatAt && Date.now() - lastHeartbeatAt < 2000;
  const serverOnline = backendReachable && isConnected;

  // Pre-compute all conditional class names — keeps JSX branch-free
  const dotClass = serverOnline ? "bg-emerald-500" : "bg-red-600";
  const textClass = serverOnline ? "text-emerald-400" : "text-red-400";
  const wsClass = wsActive ? "bg-emerald-400" : "bg-red-500";

  // ── Debug mode: compact single-line strip ──────────────────────────────
  if (debugMode) {
    return (
      <div className="hidden lg:flex items-center gap-3 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium shadow-2xl">

        {/* Server dot + short label */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex h-2.5 w-2.5">
            {serverOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", dotClass)} />
          </div>
          <span className={clsx("text-[9px] font-bold", textClass)}>
            {serverStatusShortLabel(serverOnline, backendReachable)}
          </span>
        </div>

        <span className="text-white/15">|</span>

        {/* Simulation state */}
        <span className={clsx("text-[9px] font-bold", simStateColor(simulationStatus))}>
          {simulationStatus.toUpperCase()}
        </span>

        {/* Pool + GCC stats when server status is available */}
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

        {/* WS heartbeat dot */}
        <span className="text-[9px]">
          <span className="text-white/40">WS </span>
          <span className={clsx("inline-block h-1.5 w-1.5 rounded-full align-middle", wsClass)} />
        </span>

        {/* Sandbox mode */}
        <span className={clsx("text-[9px] font-bold", sandboxModeColorClass(sandboxMode))}>
          {sandboxModeLabel(sandboxMode)}
        </span>

        {/* Runner index */}
        <span className="text-[9px]">
          <span className="text-white/40">Runner </span>
          <span className="text-violet-300 font-bold">{runnerIndexLabel(workerIndex, workerTotal)}</span>
        </span>
      </div>
    );
  }

  // ── Normal mode: minimal server indicator only ─────────────────────────
  return (
    <div className="hidden lg:flex items-center gap-2 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
      <div className="relative flex h-2.5 w-2.5">
        {serverOnline && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", dotClass)} />
      </div>
      <span className={clsx("text-[9px] font-bold", textClass)}>
        {serverStatusLabel(serverOnline, backendReachable)}
      </span>
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";

