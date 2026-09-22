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

/** Derives every server-dependent UI capability from backendReachable. */
export function getServerCapabilities(
  backendReachable: boolean,
): ServerCapabilities {
  return backendReachable ? AVAILABLE_CAPABILITIES : OFFLINE_CAPABILITIES;
}
