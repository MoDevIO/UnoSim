/**
 * External API types for the postMessage remote control interface.
 *
 * This module defines the protocol for external websites to control
 * the Arduino simulator via window.postMessage.
 */

/** API Version for backward compatibility and feature negotiation. */
export const API_VERSION = "1.3.0";

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
  /** Pause a running simulation (preserves state) */
  PAUSE_SIMULATION = "PAUSE_SIMULATION",
  /** Resume a paused simulation */
  RESUME_SIMULATION = "RESUME_SIMULATION",
  /** Set the value of a digital or analog pin */
  SET_PIN_STATE = "SET_PIN_STATE",
  /** Request the current value of a pin (triggers a RESPONSE message) */
  GET_PIN_STATE = "GET_PIN_STATE",
  /** Set multiple pins in a single operation (batch) */
  BATCH_SET_PIN_STATE = "BATCH_SET_PIN_STATE",
  /** Send serial input data to the running simulation */
  SERIAL_INPUT = "SERIAL_INPUT",
  /** Change the simulation timeout (in milliseconds) */
  SET_SIMULATION_TIMEOUT = "SET_SIMULATION_TIMEOUT",
  /** Switch the active output tab (compiler, messages, registry, debug) */
  SET_OUTPUT_TAB = "SET_OUTPUT_TAB",
  /** Query the current simulation state (triggers a RESPONSE message) */
  GET_SIMULATION_STATE = "GET_SIMULATION_STATE",
  /** Query the current server/pool status (triggers a RESPONSE message) */
  GET_SERVER_STATUS = "GET_SERVER_STATUS",
}

/**
 * All events emitted by the simulator (outbound).
 * These are sent proactively from the simulator to the parent frame.
 */
export enum SimulatorEventType {
  /** A pin's state (digital or analog value) has changed */
  PIN_STATE_CHANGE_EVENT = "PIN_STATE_CHANGE_EVENT",
  /** The simulation's overall state has changed (RUNNING, STOPPED, ERROR) */
  SIMULATION_STATE_EVENT = "SIMULATION_STATE_EVENT",
  /** Data has been output over the serial interface (Serial.print, etc.) */
  SERIAL_OUTPUT_EVENT = "SERIAL_OUTPUT_EVENT",
  /** The server/pool status has changed (runner pool, compile queue, reachability) */
  SERVER_STATUS_EVENT = "SERVER_STATUS_EVENT",
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

/**
 * Payload for SERIAL_INPUT messages.
 */
export interface SerialInputPayload {
  data: string;
}

/**
 * Payload for SET_SIMULATION_TIMEOUT messages.
 */
export interface SetSimulationTimeoutPayload {
  timeout: number;
}

/**
 * Payload for SET_OUTPUT_TAB messages.
 */
export interface SetOutputTabPayload {
  tab: "compiler" | "messages" | "registry" | "debug";
}

/** Union of all payload types keyed by action type */
type PayloadMap = {
  [SimulatorActionType.LOAD_CODE]: LoadCodePayload;
  [SimulatorActionType.START_SIMULATION]: undefined;
  [SimulatorActionType.STOP_SIMULATION]: undefined;
  [SimulatorActionType.PAUSE_SIMULATION]: undefined;
  [SimulatorActionType.RESUME_SIMULATION]: undefined;
  [SimulatorActionType.SET_PIN_STATE]: SetPinStatePayload;
  [SimulatorActionType.GET_PIN_STATE]: GetPinStatePayload;
  [SimulatorActionType.BATCH_SET_PIN_STATE]: BatchSetPinStatePayload;
  [SimulatorActionType.SERIAL_INPUT]: SerialInputPayload;
  [SimulatorActionType.SET_SIMULATION_TIMEOUT]: SetSimulationTimeoutPayload;
  [SimulatorActionType.SET_OUTPUT_TAB]: SetOutputTabPayload;
  [SimulatorActionType.GET_SIMULATION_STATE]: undefined;
  [SimulatorActionType.GET_SERVER_STATUS]: undefined;
};

/**
 * Payload for PIN_STATE_CHANGE_EVENT events.
 */
export interface PinStateChangeEventData {
  pin: number;
  value: number;
}

/**
 * Data for SIMULATION_STATE_EVENT events.
 */
export interface SimulationStateEventData {
  state: "RUNNING" | "STOPPED" | "PAUSED" | "ERROR" | "COMPILING" | "QUEUED";
  message?: string;
}

/**
 * Data for SERVER_STATUS_EVENT events.
 * Reports server reachability, runner pool stats, and compile queue stats.
 */
export interface ServerStatusEventData {
  /** True when the server HTTP endpoint is reachable */
  serverReachable: boolean;
  pool: {
    /** Total runner slots allocated */
    total: number;
    /** Runner slots currently idle */
    available: number;
    /** Runner slots actively running a simulation */
    inUse: number;
    /** Requests waiting for a free runner */
    queued: number;
  };
  compile: {
    /** Compile jobs currently in progress */
    active: number;
    /** Compile jobs waiting for a free slot */
    queued: number;
    /** Maximum concurrent compile jobs allowed */
    maxConcurrent: number;
  };
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
 * The `data` field matches the format documented in EXTERNAL_API.md.
 */
export type SimulatorEventMessage<T extends SimulatorEventType = SimulatorEventType> = {
  version: string;
  type: T;
  success: true; // Events always report success
  data: T extends SimulatorEventType.PIN_STATE_CHANGE_EVENT
    ? PinStateChangeEventData
    : T extends SimulatorEventType.SIMULATION_STATE_EVENT
      ? SimulationStateEventData
      : T extends SimulatorEventType.SERIAL_OUTPUT_EVENT
        ? string
        : T extends SimulatorEventType.SERVER_STATUS_EVENT
          ? ServerStatusEventData
          : never;
}
