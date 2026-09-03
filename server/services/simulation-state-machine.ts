export type SimulationState = "stopped" | "starting" | "running" | "paused" | "error";

const transitions: Record<SimulationState, readonly SimulationState[]> = {
  stopped: ["starting"],
  starting: ["stopped", "running", "error"],
  running: ["paused", "stopped", "error"],
  paused: ["running", "stopped", "error"],
  error: [],
};

/** Pure lifecycle transition used by all execution controllers. */
export function canTransition(from: SimulationState, to: SimulationState): boolean {
  if (from === "error") return false;
  return transitions[from].includes(to);
}

export function transition(from: SimulationState, to: SimulationState): SimulationState {
  return canTransition(from, to) ? to : from;
}
