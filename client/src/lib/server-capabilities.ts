export interface ServerCapabilities {
  readonly canCompile: boolean;
  readonly canSimulate: boolean;
  readonly canUseTutor: boolean;
  readonly canConfigureTutor: boolean;
  readonly canUseServerExamples: boolean;
  readonly canUseRealtimeControls: boolean;
}

const AVAILABLE_CAPABILITIES: ServerCapabilities = Object.freeze({
  canCompile: true,
  canSimulate: true,
  canUseTutor: true,
  canConfigureTutor: true,
  canUseServerExamples: true,
  canUseRealtimeControls: true,
});

const OFFLINE_CAPABILITIES: ServerCapabilities = Object.freeze({
  canCompile: false,
  canSimulate: false,
  canUseTutor: false,
  canConfigureTutor: false,
  canUseServerExamples: false,
  canUseRealtimeControls: false,
});

/** Only the controls of a running browser emulation, which needs no server (plan P3.5). */
const BROWSER_RUN_OFFLINE_CAPABILITIES: ServerCapabilities = Object.freeze({
  ...OFFLINE_CAPABILITIES,
  canSimulate: true,
  canUseRealtimeControls: true,
});

/**
 * Derives every server-dependent UI capability from backendReachable. A
 * running browser emulation keeps its own controls (pause, stop, serial input,
 * pins) while the server is gone; compile, examples and the tutor stay offline.
 */
export function getServerCapabilities(
  backendReachable: boolean,
  browserRunActive = false,
): ServerCapabilities {
  if (backendReachable) return AVAILABLE_CAPABILITIES;
  return browserRunActive ? BROWSER_RUN_OFFLINE_CAPABILITIES : OFFLINE_CAPABILITIES;
}

export interface SimulateControlInput {
  readonly canSimulate: boolean;
  readonly simulationStatus: string;
  readonly backendReachable: boolean;
  readonly isConnected: boolean;
  /** A start, stop, pause, resume or compile request is in flight. */
  readonly busy: boolean;
  /** The current or latest run is a browser run: it needs no server once it exists. */
  readonly browserRun: boolean;
}

/**
 * Whether the Start / Pause / Resume control is disabled. Starting needs the server (the compile), and so
 * does resuming a server-side run. A paused run of the browser emulation does not: pause, resume and
 * stop work without a connection (plan P3.5).
 */
export function isSimulateControlDisabled({ canSimulate, simulationStatus, backendReachable, isConnected, busy, browserRun }: SimulateControlInput): boolean {
  if (!canSimulate || busy) return true;
  const needsServer = simulationStatus === "idle" || (simulationStatus === "paused" && !browserRun);
  return needsServer && (!backendReachable || !isConnected);
}

