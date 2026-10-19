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
