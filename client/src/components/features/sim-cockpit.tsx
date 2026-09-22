import React, { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { CircleCheck, CircleX } from "lucide-react";
import { ToolbarStatusIcon } from "@/components/ui/toolbar-status-icon";
import { StatusDot } from "@/components/ui/status-dot";
import { getStatusTextClass, type ApplicationStatus } from "@/lib/status-semantics";
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
  pendingExternalStart: boolean = false,
): ClientState {
  // pendingExternalStart means START_SIMULATION was received before the WS
  // connected (or before the backend was reachable).  The instance is waiting
  // for the compile + WS handshake phase — NOT for a simulation runner slot.
  // Without this check, simulationStatus === "queued" (set client-side by
  // handleExternalStartSimulation) would make the badge show QUEUED_FOR_SIMULATION
  // while the instance is actually queued for compilation.
  if (pendingExternalStart) return "QUEUED_FOR_COMPILING";
  if (compilationStatus === "compiling") return "COMPILING";
  if (simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
  if (simulationStatus === "running") return "RUNNING";
  if (simulationStatus === "paused") return "PAUSED";
  if (compilationStatus === "error") return "ERROR";
  return "IDLE";
}

function clientStateTone(state: ClientState): ApplicationStatus {
  switch (state) {
    case "RUNNING": return "success";
    case "PAUSED": return "warning";
    case "RUNNING_STARTING":
    case "COMPILING":
    case "QUEUED_FOR_COMPILING":
    case "QUEUED_FOR_SIMULATION": return "busy";
    case "ERROR": return "error";
    default: return "idle";
  }
}

function clientStateColor(state: ClientState): string {
  return getStatusTextClass(clientStateTone(state));
}

function compilationStatusTone(status: CompilationStatus): ApplicationStatus {
  if (status === "compiling") return "busy";
  if (status === "error") return "error";
  return "success";
}

function compilationStatusLabel(status: CompilationStatus): string {
  switch (status) {
    case "ready": return "HTTP ready";
    case "compiling": return "HTTP compiling";
    case "success": return "HTTP success";
    case "error": return "HTTP error";
  }
}

/** WS status is based on connection state only, not simulation telemetry. */
function wsStatusTone(wsState: ConnectionState, hasEverConnected: boolean): ApplicationStatus {
  if (wsState === "connected") return "success";
  if (wsState === "connecting" || wsState === "reconnecting") return "busy";
  return hasEverConnected ? "error" : "idle";
}

function wsStatusLabel(wsState: ConnectionState, hasEverConnected: boolean): string {
  if (wsState === "connected") return "WebSocket connected";
  if (wsState === "connecting") return "WebSocket connecting";
  if (wsState === "reconnecting") return "WebSocket reconnecting";
  return hasEverConnected ? "WebSocket disconnected" : "WebSocket not connected";
}

/** True when WS previously connected but is now disconnected/lost. */
function isWsError(wsState: ConnectionState, hasEverConnected: boolean): boolean {
  if (wsState === "connected" || wsState === "connecting" || wsState === "reconnecting") return false;
  return hasEverConnected;
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
  workerIndex?: number;
  workerTotal?: number;
  backendReachable?: boolean;
  isConnected?: boolean;
  wsConnectionState?: ConnectionState;
  wsHasEverConnected?: boolean;
  baudRate?: number;
  debugMode?: boolean;
  /** When true, a START_SIMULATION arrived before the WS connected; the instance
   *  is waiting for compilation, not for a simulation runner slot. Without this
   *  flag deriveClientState incorrectly shows QUEUED_FOR_SIMULATION instead of
   *  QUEUED_FOR_COMPILING because simulationStatus is set to "queued" client-side
   *  by handleExternalStartSimulation. */
  pendingExternalStart?: boolean;
  /** @deprecated kept for prop compatibility; no longer used for WS dot logic */
  serverStatus?: unknown;
}

export const SimCockpit: React.FC<SimCockpitProps> = React.memo(({
  simulationStatus = "idle",
  compilationStatus = "ready",
  backendReachable = true,
  wsConnectionState = "disconnected",
  wsHasEverConnected = false,
  workerIndex,
  workerTotal,
  debugMode = false,
  pendingExternalStart = false,
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
  const clientState = deriveClientState(simulationStatus, compilationStatus, pendingExternalStart);
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
          value={<span data-testid="client-state-badge">{visualClientState}</span>}
          valueClass={clientStateColor(visualClientState)}
        />

        <ColSep />

        {/* GROUP 2: COMPILATION — HTTP dot + slot (slot only while compiling) */}
        <StatCell
          label="COMPILATION"
          value={(
            <span className="flex items-center gap-1">
              <span className="text-white/50">HTTP:</span>
              <StatusDot
                status={compilationStatusTone(visualCompStatus)}
                label={compilationStatusLabel(visualCompStatus)}
                pulse={visualCompStatus === "compiling"}
              />
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
              <StatusDot
                status={wsStatusTone(wsConnectionState, wsHasEverConnected)}
                label={wsStatusLabel(wsConnectionState, wsHasEverConnected)}
                pulse={wsConnectionState === "connecting" || wsConnectionState === "reconnecting"}
              />
              {!wsError && simSlotVal && (
                <>
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

  // ── Normal mode: icon-only server status ─────────────────────────────
  return (
    <ToolbarStatusIcon
      className="hidden lg:flex"
      icon={backendReachable
        ? <CircleCheck aria-hidden="true" />
        : <CircleX aria-hidden="true" />}
      label={backendReachable ? "Server connected" : "Server offline"}
      status={backendReachable ? "success" : "error"}
    />
  );
});

SimCockpit.displayName = "SimCockpit";
