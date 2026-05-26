// Shared Arduino-related type aliases for better consistency across the codebase.

/**
 * Pin mode values used by the simulator and parser.
 *
 * This type is intentionally aligned with the Arduino API: "INPUT" | "OUTPUT" | "INPUT_PULLUP".
 * Using a shared type ensures consistent typings and reduces redundant union literals.
 */
export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

/**
 * Categories of pin state changes emitted by the simulator over WebSocket.
 *
 * - "mode" : pinMode() was called (digital input/output/pullup configuration)
 * - "value": digitalRead/Write value changed (HIGH/LOW)
 * - "pwm"  : analogWrite/analogRead value changed (0-1023)
 *
 * Must stay aligned with the `stateType` Zod enum in shared/schema.ts.
 */
export type PinStateChange = "mode" | "value" | "pwm";

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
  | "paused";

/**
 * Runtime status used for components that only care about active/pause/idle state.
 */
export type RuntimeSimulationStatus = Extract<SimulationStatus, "running" | "paused" | "idle">;

/**
 * High-level client state exposed via the debug header and external API.
 *
 * Derived from `simulationStatus` + `compilationStatus` to give a single
 * label that covers the full lifecycle:
 *
 *   IDLE → QUEUED_FOR_COMPILING → COMPILING → QUEUED_FOR_SIMULATION → RUNNING ⇄ PAUSED
 *
 * The header debug strip groups these into three functional areas:
 *   1. Client-Status  (this type)
 *   2. Compilation / HTTP-Stack  (HTTP dot + Slot X/Y)
 *   3. Simulation / WS-Stack    (WS dot + docker/local + Runner #X/Y)
 */
export type ClientState =
  | "IDLE"
  | "QUEUED_FOR_COMPILING"
  | "COMPILING"
  | "QUEUED_FOR_SIMULATION"
  | "RUNNING_STARTING"
  | "RUNNING"
  | "PAUSED"
  | "ERROR";
