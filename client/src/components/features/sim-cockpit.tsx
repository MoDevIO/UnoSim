import React, { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import type { SimulationStatus, ClientState } from "@shared/types/arduino.types";
import type { CompilationStatus } from "@/types/compilation.types";
import type { ConnectionState } from "@/lib/websocket-manager";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum ms any state label stays visible before switching to a new one. */
const STATE_MIN_MS = 600;

// ── Pure helpers ──────────────────────────────────────────────────────────────

function deriveClientState(
  simulationStatus: SimulationStatus,
  compilationStatus: CompilationStatus,
): ClientState {
  if (simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
  if (simulationStatus === "running") return "RUNNING";
  if (simulationStatus === "paused") return "PAUSED";
  if (compilationStatus === "compiling") return "COMPILING";
  if (compilationStatus === "error") return "ERROR";
  return "IDLE";
}

function clientStateColor(state: ClientState): string {
  switch (state) {
    case "RUNNING": return "text-emerald-400";
    case "PAUSED": return "text-amber-300";
    case "COMPILING":
    case "QUEUED_FOR_COMPILING": return "text-blue-300";
    case "QUEUED_FOR_SIMULATION": return "text-violet-300";
    case "ERROR": return "text-red-400";
    default: return "text-white/50";
  }
}

function compileDotClass(status: CompilationStatus): string {
  if (status === "compiling") return "bg-blue-400 animate-pulse";
  if (status === "error") return "bg-red-500";
  return "bg-white/30";
}

/**
 * WS dot — based on wsConnectionState only (not simulation telemetry).
 * gray = never connected | amber(pulse) = connecting | green = connected | red = connection lost
 */
function wsDotClass(wsState: ConnectionState, hasEverConnected: boolean): string {
  if (wsState === "connected") return "bg-emerald-400";
  if (wsState === "connecting" || wsState === "reconnecting") return "bg-amber-400 animate-pulse";
  if (hasEverConnected) return "bg-red-500";
  return "bg-white/30";
}

/** True when WS previously connected but is now disconnected/lost. */
function isWsError(wsState: ConnectionState, hasEverConnected: boolean): boolean {
  if (wsState === "connected" || wsState === "connecting" || wsState === "reconnecting") return false;
  return hasEverConnected;
}

function simulationModeLabel(sandboxMode: string): string {
  if (sandboxMode === "docker-sandbox") return "DOCKER";
  if (sandboxMode === "local-limited") return "LOCAL";
  return "—";
}

function simulationModeColorClass(sandboxMode: string): string {
  if (sandboxMode === "docker-sandbox") return "text-cyan-300";
  if (sandboxMode === "local-limited") return "text-amber-300";
  return "text-white/40";
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatCellProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly valueClass?: string;
}

/** A compact 2-row stat cell: dim label on top, bright value below. */
function StatCell({ label, value, valueClass }: StatCellProps) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span
        className="uppercase tracking-wider text-cyan-500/50 whitespace-nowrap"
        style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}
      >
        {label}
      </span>
      <span
        className={clsx("font-bold font-mono whitespace-nowrap", valueClass ?? "text-white/50")}
        style={{ fontSize: "calc(11px * var(--ui-font-scale))" }}
      >
        {value}
      </span>
    </div>
  );
}

function ColSep() {
  return <div className="w-px h-5 bg-white/10 self-center mx-0.5 shrink-0" />;
}

// ── Component interface ───────────────────────────────────────────────────────

interface SimCockpitProps {
  batchStats?: unknown;
  simulationStatus?: SimulationStatus;
  compilationStatus?: CompilationStatus;
  sandboxMode?: string;
  workerIndex?: number;
  workerTotal?: number;
  backendReachable?: boolean;
  isConnected?: boolean;
  wsConnectionState?: ConnectionState;
  wsHasEverConnected?: boolean;
  baudRate?: number;
  debugMode?: boolean;
  /** @deprecated kept for prop compatibility; no longer used for WS dot logic */
  serverStatus?: unknown;
}

export const SimCockpit: React.FC<SimCockpitProps> = React.memo(({
  simulationStatus = "idle",
  compilationStatus = "ready",
  sandboxMode = "unknown",
  backendReachable = true,
  wsConnectionState = "disconnected",
  wsHasEverConnected = false,
  workerIndex,
  workerTotal,
  debugMode = false,
}) => {

  // ── Compilation dot visual delay ───────────────────────────────────────
  // Keep the blue dot visible for at least STATE_MIN_MS even on fast compiles.
  const [visualCompStatus, setVisualCompStatus] = useState<CompilationStatus>(compilationStatus);
  const httpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (compilationStatus === "compiling") {
      if (httpTimerRef.current) clearTimeout(httpTimerRef.current);
      setVisualCompStatus("compiling");
    } else {
      httpTimerRef.current = setTimeout(() => {
        setVisualCompStatus(compilationStatus);
      }, STATE_MIN_MS);
    }
    return () => {
      if (httpTimerRef.current) {
        clearTimeout(httpTimerRef.current);
        httpTimerRef.current = null;
      }
    };
  }, [compilationStatus]);

  // ── Client state visual delay ──────────────────────────────────────────
  // Show active states immediately; delay the downgrade back to IDLE so it
  // stays readable for at least STATE_MIN_MS.
  const clientState = deriveClientState(simulationStatus, compilationStatus);
  const [visualClientState, setVisualClientState] = useState<ClientState>(clientState);
  const clientStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (clientState === "IDLE") {
      clientStateTimerRef.current = setTimeout(() => {
        setVisualClientState(clientState);
      }, STATE_MIN_MS);
    } else {
      if (clientStateTimerRef.current) clearTimeout(clientStateTimerRef.current);
      setVisualClientState(clientState);
    }
    return () => {
      if (clientStateTimerRef.current) {
        clearTimeout(clientStateTimerRef.current);
        clientStateTimerRef.current = null;
      }
    };
  }, [clientState]);

  const wsError = isWsError(wsConnectionState, wsHasEverConnected);

  // ── Debug mode: 3-group status row ───────────────────────────────────
  if (debugMode) {
    // Compile slot: only visible while a compilation is in progress.
    const compileSlotVal = visualCompStatus === "compiling"
      && !wsError
      && workerIndex !== undefined
      && workerTotal !== undefined
      ? `#${workerIndex + 1}/${workerTotal}`
      : null;

    // Simulation runner: only visible while simulation is active (running/paused/queued).
    const simActive = simulationStatus === "running" || simulationStatus === "paused" || simulationStatus === "queued";
    const simSlotVal = simActive
      && !wsError
      && workerIndex !== undefined
      && workerTotal !== undefined
      ? `#${workerIndex + 1}/${workerTotal}`
      : null;

    return (
      <div
        className="hidden lg:flex items-center gap-2 text-[10px] font-medium"
        data-testid="sim-cockpit-debug"
      >
        {/* GROUP 1: CLIENT state */}
        <StatCell
          label="CLIENT"
          value={visualClientState}
          valueClass={clientStateColor(visualClientState)}
        />

        <ColSep />

        {/* GROUP 2: COMPILATION — HTTP dot + slot (slot only while compiling) */}
        <StatCell
          label="COMPILATION"
          value={(
            <span className="flex items-center gap-1">
              <span className="text-white/50">HTTP:</span>
              <span className={clsx("inline-block w-2 h-2 rounded-full", compileDotClass(visualCompStatus))} />
              {compileSlotVal && (
                <>
                  <span className="text-white/30">|</span>
                  <span className="text-white/50">SLOT:</span>
                  <span className="text-white/50">{compileSlotVal}</span>
                </>
              )}
            </span>
          )}
        />

        <ColSep />

        {/* GROUP 3: SIMULATION — WS dot + mode + runner (mode/runner only while active) */}
        <StatCell
          label="SIMULATION"
          value={(
            <span className="flex items-center gap-1">
              <span className="text-white/50">WS:</span>
              <span className={clsx("inline-block w-2 h-2 rounded-full", wsDotClass(wsConnectionState, wsHasEverConnected))} />
              {!wsError && simSlotVal && (
                <>
                  <span className="text-white/30">|</span>
                  <span className={clsx("font-bold font-mono whitespace-nowrap", simulationModeColorClass(sandboxMode))}>
                    {simulationModeLabel(sandboxMode)}
                  </span>
                  <span className="text-white/30">|</span>
                  <span className="text-cyan-300 font-bold font-mono whitespace-nowrap">{simSlotVal}</span>
                </>
              )}
            </span>
          )}
        />
      </div>
    );
  }

  // ── Normal mode: minimal SERVER/OFFLINE pill ──────────────────────────
  const httpDotClass = backendReachable ? "bg-emerald-500" : "bg-red-600";
  const httpTextClass = backendReachable ? "text-emerald-400" : "text-red-400";

  return (
    <div className="hidden lg:flex items-center gap-2 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
      <div className="relative flex h-2.5 w-2.5">
        {backendReachable && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={clsx("relative inline-flex rounded-full h-2.5 w-2.5", httpDotClass)} />
      </div>
      <span className={clsx("text-[9px] font-bold", httpTextClass)}>
        {backendReachable ? "SERVER" : "OFFLINE"}
      </span>
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";

