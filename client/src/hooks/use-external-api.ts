import { useEffect } from "react";
import { isBoardPin } from "@shared/board-pins";
import { type BoardId, DEFAULT_BOARD_ID, type RuntimeKind } from "@shared/boards";
import {
  SimulatorActionType, API_VERSION, SimulatorEventType,
  type ExternalStateData, type SimulatorMessage, type SimulatorResponse, type SimulatorEventMessage, type SimulationStateEventData, type ServerStatusEventData, type OperationErrorEventData,
} from "@/types/external-api";

interface UseExternalApiParams {
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
  onSerialInput: (data: string, port?: number) => void;
  /** Called when a SET_SIMULATION_TIMEOUT message is received. */
  onSetSimulationTimeout: (timeout: number) => void;
  /** Called when a SET_OUTPUT_TAB message is received. */
  onSetOutputTab: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  /** Returns the current simulation state (used for GET_SIMULATION_STATE responses). */
  getSimulationState: () => string;
  /** The selected board and runtime (API 1.5.0); without it pins are not checked against a board and GET_STATE answers with the state only. */
  getBoardInfo?: () => { board: BoardId; boardName: string; runtime?: RuntimeKind; serialPorts?: number };
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
    getBoardInfo,
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

  /** An error text when the selected board has no such pin (API 1.5.0); `undefined` if the pin is fine or no board is known. */
  const pinError = (pin: number): string | undefined => {
    const info = getBoardInfo?.();
    return info && !isBoardPin(info.board, pin) ? `pin ${pin} does not exist on ${info.boardName}` : undefined;
  };

  const handlePinState = (payload: unknown): void => {
    const p = payload as { pin?: unknown; value?: unknown };
    if (typeof p?.pin !== "number" || typeof p?.value !== "number") {
      sendMessageToParent({ type: SimulatorActionType.SET_PIN_STATE, success: false, error: "payload.pin and payload.value must be numbers" }, allowedOrigin);
      return;
    }
    const error = pinError(p.pin);
    if (error) {
      sendMessageToParent({ type: SimulatorActionType.SET_PIN_STATE, success: false, error }, allowedOrigin);
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
    const pin = (payload as { pin: number }).pin;
    const error = pinError(pin);
    if (error) {
      sendMessageToParent({ type: SimulatorActionType.GET_PIN_STATE, success: false, error }, allowedOrigin);
      return;
    }
    sendMessageToParent({ type: SimulatorActionType.GET_PIN_STATE, success: true, data: getPinState(pin) }, allowedOrigin);
  };

  const handleBatchSetPinState = (payload: unknown): void => {
    if (!Array.isArray((payload as { pins?: unknown })?.pins)) {
      sendMessageToParent({ type: SimulatorActionType.BATCH_SET_PIN_STATE, success: false, error: "payload.pins must be an array" }, allowedOrigin);
      return;
    }
    const entries = (payload as { pins: Array<{ pin?: unknown; value?: unknown }> }).pins
      .filter((pinState): pinState is { pin: number; value: number } => typeof pinState?.pin === "number" && typeof pinState?.value === "number");
    // All or nothing: a pin the board does not have rejects the whole batch (API 1.5.0).
    const errors = entries.map(({ pin }) => pinError(pin)).filter((error): error is string => error !== undefined);
    if (errors.length > 0) {
      sendMessageToParent({ type: SimulatorActionType.BATCH_SET_PIN_STATE, success: false, error: errors.join("; ") }, allowedOrigin);
      return;
    }
    for (const { pin, value } of entries) onSetPinState(pin, value);
    sendMessageToParent({ type: SimulatorActionType.BATCH_SET_PIN_STATE, success: true }, allowedOrigin);
  };

  const handleSerialInput = (payload: unknown): void => {
    if (typeof (payload as { data?: unknown })?.data !== "string") {
      sendMessageToParent({ type: SimulatorActionType.SERIAL_INPUT, success: false, error: "payload.data must be a string" }, allowedOrigin);
      return;
    }
    const { data, port } = payload as { data: string; port?: unknown };
    if (port === undefined || port === 0) {
      onSerialInput(data);
    } else {
      const ports = getBoardInfo?.()?.serialPorts ?? 1;
      if (!Number.isInteger(port) || (port as number) < 0 || (port as number) >= ports) {
        sendMessageToParent({ type: SimulatorActionType.SERIAL_INPUT, success: false, error: `payload.port must be an integer from 0 to ${ports - 1}` }, allowedOrigin);
        return;
      }
      onSerialInput(data, port as number);
    }
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

  const handleGetFullState = (): void => {
    const info = getBoardInfo?.();
    const data: ExternalStateData = {
      board: info?.board ?? DEFAULT_BOARD_ID,
      boardName: info?.boardName ?? "Arduino UNO",
      ...(info?.runtime ? { runtime: info.runtime } : {}),
      state: getSimulationState(),
      serialPorts: info?.serialPorts ?? 1,
    };
    sendMessageToParent({ type: SimulatorActionType.GET_STATE, success: true, data }, allowedOrigin);
  };

  const handleGetServerStatus = (): void => {
    const status = getServerStatus();
    sendMessageToParent({ type: SimulatorActionType.GET_SERVER_STATUS, success: true, data: status }, allowedOrigin);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (allowedOrigin !== "*" && event.origin !== allowedOrigin) return;
      // Embedded, only the embedding page itself may drive the simulator.
      if (globalThis.parent !== globalThis.window && event.source !== globalThis.parent) return;
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
        case SimulatorActionType.GET_STATE:
          handleGetFullState();
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
function getAllowedOrigin(): string {
  return _allowedOriginRef.value;
}

/**
 * Sends a SERIAL_OUTPUT_EVENT to the parent frame with serial data.
 * Automatically uses the configured allowed origin and includes API version.
 * Safely handles errors to prevent serial output from blocking the simulator.
 * @param output - The serial output string to send.
 * @param port - The serial port (`Serial1`–`Serial3` on the Mega 2560); the event carries it only when it is not 0.
 */
export function emitSerialOutput(output: string, port = 0): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.SERIAL_OUTPUT_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.SERIAL_OUTPUT_EVENT,
      ...(port === 0 ? {} : { port }),
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
  state: "IDLE" | "QUEUED_FOR_COMPILING" | "COMPILING" | "QUEUED_FOR_SIMULATION" | "RUNNING" | "PAUSED" | "ERROR",
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

/**
 * Sends a server-side operation error to the parent frame.
 * The payload is forwarded unchanged so external clients can distinguish
 * admission, rate-limit, and future operation errors without client policy.
 */
export function emitOperationErrorEvent(data: OperationErrorEventData): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.OPERATION_ERROR_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.OPERATION_ERROR_EVENT,
      success: false,
      data,
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch {
    // Silently ignore — postMessage errors are expected when not embedded
  }
}
