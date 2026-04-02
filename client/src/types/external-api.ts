/**
 * External API types for the postMessage remote control interface.
 *
 * This module defines the protocol for external websites to control
 * the Arduino simulator via window.postMessage.
 */

/**
 * All actions supported by the simulator's remote control interface.
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

/** Union of all payload types keyed by action type */
type PayloadMap = {
  [SimulatorActionType.LOAD_CODE]: LoadCodePayload;
  [SimulatorActionType.START_SIMULATION]: undefined;
  [SimulatorActionType.STOP_SIMULATION]: undefined;
  [SimulatorActionType.SET_PIN_STATE]: SetPinStatePayload;
  [SimulatorActionType.GET_PIN_STATE]: GetPinStatePayload;
};

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
 */
export interface SimulatorResponse {
  /** The action this response corresponds to */
  type: string;
  /** Whether the action was processed successfully */
  success: boolean;
  /** Optional data payload (e.g. pin value for GET_PIN_STATE) */
  data?: unknown;
  /** Error message when success is false */
  error?: string;
}
