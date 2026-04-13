// Shared Arduino-related type aliases for better consistency across the codebase.

/**
 * Pin mode values used by the simulator and parser.
 *
 * This type is intentionally aligned with the Arduino API: "INPUT" | "OUTPUT" | "INPUT_PULLUP".
 * Using a shared type ensures consistent typings and reduces redundant union literals.
 */
export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

/**
 * Represents the simulator runtime status across UI and backend.
 *
 * This type is used in multiple components and services for consistent
 * state handling and avoids duplicated union literals.
 */
export type SimulationStatus =
  | "idle"
  | "running"
  | "compiling"
  | "queued"
  | "stopped"
  | "paused";

/**
 * Runtime status used for components that only care about active/pause/stop state.
 */
export type RuntimeSimulationStatus = Extract<SimulationStatus, "running" | "paused" | "stopped">;
