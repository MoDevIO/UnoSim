/**
 * External API types for the postMessage remote control interface.
 *
 * This module defines the protocol for external websites to control
 * the Arduino simulator via window.postMessage.
 */

/** API Version for backward compatibility and feature negotiation. */
export const API_VERSION = "1.1.0";

/**
 * All actions supported by the simulator's remote control interface (inbound).
 */
export enum SimulatorActionType {
  /** Load code into the editor */
  LOAD_CODE = "LOAD_CODE",
  /** Compile and start the simulation */
  START_SIMULATION = "START_SIMULATION",
  /** Stop the running simulation */
  STOP_SIMULATION = "STOP_SIMULATION",
  /** Set the value of a digital or analog pin */
  SET_PIN_STATE = "SET_PIN_STATE",
  /** Request the current value of a pin (triggers a RESPONSE message) */
  GET_PIN_STATE = "GET_PIN_STATE",
  /** Set multiple pins in a single operation (batch) */
  BATCH_SET_PIN_STATE = "BATCH_SET_PIN_STATE",
}

/**
 * All events emitted by the simulator (outbound).
 * These are sent proactively from the simulator to the parent frame.
 */
export enum SimulatorEventType {
  /** A pin's state (digital or analog value) has changed */
  ON_PIN_CHANGE = "ON_PIN_CHANGE",
  /** The simulation's overall state has changed (RUNNING, STOPPED, ERROR) */
  SIMULATION_STATE_CHANGED = "SIMULATION_STATE_CHANGED",
}

/**
 * Payload for LOAD_CODE messages.
 */
export interface LoadCodePayload {
  code: string;
}

/**
 * Payload for SET_PIN_STATE messages.
 */
export interface SetPinStatePayload {
  pin: number;
  value: number;
}

/**
 * Payload for GET_PIN_STATE messages.
 */
export interface GetPinStatePayload {
  pin: number;
}

/**
 * Payload for BATCH_SET_PIN_STATE messages.
 * Allows setting multiple pins in a single operation for efficiency.
 */
export interface BatchSetPinStatePayload {
  pins: Array<{ pin: number; value: number }>;
}

/** Union of all payload types keyed by action type */
type PayloadMap = {
  [SimulatorActionType.LOAD_CODE]: LoadCodePayload;
  [SimulatorActionType.START_SIMULATION]: undefined;
  [SimulatorActionType.STOP_SIMULATION]: undefined;
  [SimulatorActionType.SET_PIN_STATE]: SetPinStatePayload;
  [SimulatorActionType.GET_PIN_STATE]: GetPinStatePayload;
  [SimulatorActionType.BATCH_SET_PIN_STATE]: BatchSetPinStatePayload;
};

/**
 * Payload for ON_PIN_CHANGE events.
 */
export interface OnPinChangePayload {
  pin: number;
  value: number;
}

/**
 * Payload for SIMULATION_STATE_CHANGED events.
 */
export interface SimulationStateChangedPayload {
  state: "RUNNING" | "STOPPED" | "PAUSED" | "ERROR";
  message?: string;
}

/**
 * Inbound message from an external website.
 *
 * @example
 * window.postMessage({ type: "LOAD_CODE", payload: { code: "void setup() {}" } }, "*");
 */
export type SimulatorMessage<T extends SimulatorActionType = SimulatorActionType> = {
  type: T;
  payload: PayloadMap[T];
};

/**
 * Response message sent back to the parent frame via postMessage.
 * Includes version for backward compatibility negotiation.
 */
export interface SimulatorResponse {
  /** API version (semantic versioning: major.minor.patch) */
  version: string;
  /** The action this response corresponds to */
  type: string;
  /** Whether the action was processed successfully */
  success: boolean;
  /** Optional data payload (e.g. pin value for GET_PIN_STATE) */
  data?: unknown;
  /** Error message when success is false */
  error?: string;
}

/**
 * Event message emitted proactively by the simulator.
 * These are sent without request and inform the parent of state changes.
 */
export type SimulatorEventMessage<T extends SimulatorEventType = SimulatorEventType> = {
  version: string;
  type: T;
  payload: T extends SimulatorEventType.ON_PIN_CHANGE
    ? OnPinChangePayload
    : T extends SimulatorEventType.SIMULATION_STATE_CHANGED
      ? SimulationStateChangedPayload
      : never;
}
