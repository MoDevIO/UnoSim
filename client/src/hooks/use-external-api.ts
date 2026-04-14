import { useEffect } from "react";
import { SimulatorActionType, API_VERSION, SimulatorEventType } from "@/types/external-api";
import type { SimulatorMessage, SimulatorResponse, SimulatorEventMessage, SimulationStateEventData, ServerStatusEventData } from "@/types/external-api";

export interface UseExternalApiParams {
  /** Restrict inbound messages to this origin. Use "*" to allow all origins. */
  allowedOrigin: string;
  /** Called when a LOAD_CODE message is received. */
  onLoadCode: (code: string) => void;
  /** Called when a START_SIMULATION message is received. */
  onStartSimulation: () => void;
  /** Called when a STOP_SIMULATION message is received. */
  onStopSimulation: () => void;
  /** Called when a PAUSE_SIMULATION message is received. */
  onPauseSimulation: () => void;
  /** Called when a RESUME_SIMULATION message is received. */
  onResumeSimulation: () => void;
  /** Called when a SET_PIN_STATE message is received. */
  onSetPinState: (pin: number, value: number) => void;
  /** Returns the current value of a pin (used for GET_PIN_STATE responses). */
  getPinState: (pin: number) => number;
  /** Called when a SERIAL_INPUT message is received. */
  onSerialInput: (data: string) => void;
  /** Called when a SET_SIMULATION_TIMEOUT message is received. */
  onSetSimulationTimeout: (timeout: number) => void;
  /** Called when a SET_OUTPUT_TAB message is received. */
  onSetOutputTab: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  /** Returns the current simulation state (used for GET_SIMULATION_STATE responses). */
  getSimulationState: () => string;
  /** Returns the current server status for GET_SERVER_STATUS responses. */
  getServerStatus: () => ServerStatusEventData | null;
}

// Global storage for the allowed origin (set by useExternalApi hook)
const _allowedOriginRef = { value: "*" };

/**
 * Sends a response message to the parent frame.
 * Automatically includes the API version for backward compatibility negotiation.
 *
 * @param response - The response payload to send. May or may not include version already.
 * @param targetOrigin - The target origin for the postMessage call.
 *   Pass the parent origin explicitly to prevent data leakage (S2819).
 *   Use `"*"` only when the caller intentionally allows any receiver.
 */
export function sendMessageToParent(
  response: Partial<SimulatorResponse>,
  targetOrigin: string,
): void {
  const withVersion: SimulatorResponse = {
    ...response,
    version: API_VERSION,
  } as SimulatorResponse;
  (globalThis.parent ?? globalThis).postMessage(withVersion, targetOrigin);
}

/**
 * Sends an event message (emitted proactively by the simulator) to the parent frame.
 * Automatically includes the API version.
 *
 * @param event - The event message to send (already includes version and type).
 * @param targetOrigin - The target origin for the postMessage call.
 */
export function sendEventToParent(
  event: SimulatorEventMessage,
  targetOrigin: string,
): void {
  (globalThis.parent ?? globalThis).postMessage(event, targetOrigin);
}

/**
 * Hook that listens for inbound `window.postMessage` messages and
 * dispatches them to the appropriate simulator callbacks.
 *
 * Security: messages from origins other than `allowedOrigin` are silently
 * dropped (unless `allowedOrigin` is `"*"`).
 */
export function useExternalApi(params: UseExternalApiParams): void {
  const {
    allowedOrigin,
    onLoadCode,
    onStartSimulation,
    onStopSimulation,
    onPauseSimulation,
    onResumeSimulation,
    onSetPinState,
    getPinState,
    onSerialInput,
    onSetSimulationTimeout,
    onSetOutputTab,
    getSimulationState,
    getServerStatus,
  } = params;

  // Store the allowed origin globally for use by event-sending functions
  useEffect(() => {
    _allowedOriginRef.value = allowedOrigin;
  }, [allowedOrigin]);

  // ── Action handler dispatchers ──────────────────────────────────────────
  const handleLoadCode = (payload: unknown): void => {
    if (typeof (payload as { code?: unknown })?.code !== "string") {
      sendMessageToParent({ type: SimulatorActionType.LOAD_CODE, success: false, error: "payload.code must be a string" }, allowedOrigin);
      return;
    }
    onLoadCode((payload as { code: string }).code);
    sendMessageToParent({ type: SimulatorActionType.LOAD_CODE, success: true }, allowedOrigin);
  };

  const handlePinState = (payload: unknown): void => {
    const p = payload as { pin?: unknown; value?: unknown };
    if (typeof p?.pin !== "number" || typeof p?.value !== "number") {
      sendMessageToParent({ type: SimulatorActionType.SET_PIN_STATE, success: false, error: "payload.pin and payload.value must be numbers" }, allowedOrigin);
      return;
    }
    onSetPinState(p.pin, p.value);
    sendMessageToParent({ type: SimulatorActionType.SET_PIN_STATE, success: true }, allowedOrigin);
  };

  const handleGetPinState = (payload: unknown): void => {
    if (typeof (payload as { pin?: unknown })?.pin !== "number") {
      sendMessageToParent({ type: SimulatorActionType.GET_PIN_STATE, success: false, error: "payload.pin must be a number" }, allowedOrigin);
      return;
    }
    const value = getPinState((payload as { pin: number }).pin);
    sendMessageToParent({ type: SimulatorActionType.GET_PIN_STATE, success: true, data: value }, allowedOrigin);
  };

  const handleBatchSetPinState = (payload: unknown): void => {
    if (!Array.isArray((payload as { pins?: unknown })?.pins)) {
      sendMessageToParent({ type: SimulatorActionType.BATCH_SET_PIN_STATE, success: false, error: "payload.pins must be an array" }, allowedOrigin);
      return;
    }
    for (const pinState of (payload as { pins: Array<{ pin?: unknown; value?: unknown }> }).pins) {
      if (typeof pinState?.pin === "number" && typeof pinState?.value === "number") {
        onSetPinState(pinState.pin, pinState.value);
      }
    }
    sendMessageToParent({ type: SimulatorActionType.BATCH_SET_PIN_STATE, success: true }, allowedOrigin);
  };

  const handleSerialInput = (payload: unknown): void => {
    if (typeof (payload as { data?: unknown })?.data !== "string") {
      sendMessageToParent({ type: SimulatorActionType.SERIAL_INPUT, success: false, error: "payload.data must be a string" }, allowedOrigin);
      return;
    }
    onSerialInput((payload as { data: string }).data);
    sendMessageToParent({ type: SimulatorActionType.SERIAL_INPUT, success: true }, allowedOrigin);
  };

  const handleSetTimeout = (payload: unknown): void => {
    if (typeof (payload as { timeout?: unknown })?.timeout !== "number" || (payload as { timeout: number }).timeout < 0) {
      sendMessageToParent({ type: SimulatorActionType.SET_SIMULATION_TIMEOUT, success: false, error: "payload.timeout must be a non-negative number" }, allowedOrigin);
      return;
    }
    onSetSimulationTimeout((payload as { timeout: number }).timeout / 1000);
    sendMessageToParent({ type: SimulatorActionType.SET_SIMULATION_TIMEOUT, success: true }, allowedOrigin);
  };

  const handleSetOutputTab = (payload: unknown): void => {
    const validTabs = ["compiler", "messages", "registry", "debug"];
    if (typeof (payload as { tab?: unknown })?.tab !== "string" || !validTabs.includes((payload as { tab: string }).tab)) {
      sendMessageToParent({ type: SimulatorActionType.SET_OUTPUT_TAB, success: false, error: `payload.tab must be one of: ${validTabs.join(", ")}` }, allowedOrigin);
      return;
    }
    onSetOutputTab((payload as { tab: "compiler" | "messages" | "registry" | "debug" }).tab);
    sendMessageToParent({ type: SimulatorActionType.SET_OUTPUT_TAB, success: true }, allowedOrigin);
  };

  const handleGetState = (): void => {
    const state = getSimulationState();
    sendMessageToParent({ type: SimulatorActionType.GET_SIMULATION_STATE, success: true, data: state }, allowedOrigin);
  };

  const handleGetServerStatus = (): void => {
    const status = getServerStatus();
    sendMessageToParent({ type: SimulatorActionType.GET_SERVER_STATUS, success: true, data: status }, allowedOrigin);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (allowedOrigin !== "*" && event.origin !== allowedOrigin) return;
      const msg = event.data;
      if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") return;
      const message = msg as SimulatorMessage;

      switch (message.type) {
        case SimulatorActionType.LOAD_CODE:
          handleLoadCode(message.payload);
          break;
        case SimulatorActionType.START_SIMULATION:
          onStartSimulation();
          sendMessageToParent({ type: SimulatorActionType.START_SIMULATION, success: true }, allowedOrigin);
          break;
        case SimulatorActionType.STOP_SIMULATION:
          onStopSimulation();
          sendMessageToParent({ type: SimulatorActionType.STOP_SIMULATION, success: true }, allowedOrigin);
          break;
        case SimulatorActionType.PAUSE_SIMULATION:
          onPauseSimulation();
          sendMessageToParent({ type: SimulatorActionType.PAUSE_SIMULATION, success: true }, allowedOrigin);
          break;
        case SimulatorActionType.RESUME_SIMULATION:
          onResumeSimulation();
          sendMessageToParent({ type: SimulatorActionType.RESUME_SIMULATION, success: true }, allowedOrigin);
          break;
        case SimulatorActionType.SET_PIN_STATE:
          handlePinState(message.payload);
          break;
        case SimulatorActionType.GET_PIN_STATE:
          handleGetPinState(message.payload);
          break;
        case SimulatorActionType.BATCH_SET_PIN_STATE:
          handleBatchSetPinState(message.payload);
          break;
        case SimulatorActionType.SERIAL_INPUT:
          handleSerialInput(message.payload);
          break;
        case SimulatorActionType.SET_SIMULATION_TIMEOUT:
          handleSetTimeout(message.payload);
          break;
        case SimulatorActionType.SET_OUTPUT_TAB:
          handleSetOutputTab(message.payload);
          break;
        case SimulatorActionType.GET_SIMULATION_STATE:
          handleGetState();
          break;
        case SimulatorActionType.GET_SERVER_STATUS:
          handleGetServerStatus();
          break;
        // default: silently ignore unknown actions
      }
    };

    globalThis.addEventListener("message", handleMessage);
    return () => {
      globalThis.removeEventListener("message", handleMessage);
    };
  }, [
    allowedOrigin, onLoadCode, onStartSimulation, onStopSimulation,
    onPauseSimulation, onResumeSimulation, onSetPinState, getPinState,
    onSerialInput, onSetSimulationTimeout, onSetOutputTab, getSimulationState, getServerStatus,
  ]);
}

/**
 * Gets the currently configured allowed origin for external API communication.
 * Defaults to "*" if useExternalApi has not been called yet.
 * @internal Used by other hooks to send events with the correct origin.
 */
export function getAllowedOrigin(): string {
  return _allowedOriginRef.value;
}

/**
 * Sends a SERIAL_OUTPUT_EVENT to the parent frame with serial data.
 * Automatically uses the configured allowed origin and includes API version.
 * Safely handles errors to prevent serial output from blocking the simulator.
 * @param output - The serial output string to send.
 */
export function emitSerialOutput(output: string): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.SERIAL_OUTPUT_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.SERIAL_OUTPUT_EVENT,
      success: true,
      data: output,
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch (error) {
    // Silently ignore postMessage errors to prevent disrupting serial output
    // This is expected when the simulator is not embedded in an iframe
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[External API] Serial event send failed (expected when not in iframe):", error);
    }
  }
}

/**
 * Sends a PIN_STATE_CHANGE_EVENT to the parent frame when a pin changes value.
 * @param pin - Pin number (0-13 digital, 14-19 = A0-A5 analog)
 * @param value - New pin value
 */
export function emitPinStateChange(pin: number, value: number): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.PIN_STATE_CHANGE_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.PIN_STATE_CHANGE_EVENT,
      success: true,
      data: { pin, value },
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch {
    // Silently ignore — postMessage errors are expected when not embedded
  }
}

/**
 * Sends a SIMULATION_STATE_EVENT to the parent frame when the simulation state changes.
 * @param state - New simulation state
 * @param message - Optional human-readable message
 */
export function emitSimulationStateEvent(
  state: "RUNNING" | "STOPPED" | "PAUSED" | "ERROR" | "COMPILING" | "QUEUED",
  message?: string,
): void {
  try {
    const data: SimulationStateEventData = { state };
    if (message !== undefined) data.message = message;
    const event: SimulatorEventMessage<typeof SimulatorEventType.SIMULATION_STATE_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.SIMULATION_STATE_EVENT,
      success: true,
      data,
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch {
    // Silently ignore — postMessage errors are expected when not embedded
  }
}

/**
 * Sends a SERVER_STATUS_EVENT to the parent frame with current pool / compile stats.
 * Called periodically so test harnesses can measure queue times.
 * @param data - Server status snapshot from use-backend-health
 */
export function emitServerStatusEvent(data: ServerStatusEventData): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.SERVER_STATUS_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.SERVER_STATUS_EVENT,
      success: true,
      data,
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch {
    // Silently ignore — postMessage errors are expected when not embedded
  }
}
