import { useEffect } from "react";
import { SimulatorActionType, API_VERSION, SimulatorEventType } from "@/types/external-api";
import type { SimulatorMessage, SimulatorResponse, SimulatorEventMessage } from "@/types/external-api";

export interface UseExternalApiParams {
  /** Restrict inbound messages to this origin. Use "*" to allow all origins. */
  allowedOrigin: string;
  /** Called when a LOAD_CODE message is received. */
  onLoadCode: (code: string) => void;
  /** Called when a START_SIMULATION message is received. */
  onStartSimulation: () => void;
  /** Called when a STOP_SIMULATION message is received. */
  onStopSimulation: () => void;
  /** Called when a SET_PIN_STATE message is received. */
  onSetPinState: (pin: number, value: number) => void;
  /** Returns the current value of a pin (used for GET_PIN_STATE responses). */
  getPinState: (pin: number) => number;
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
  globalThis.postMessage(withVersion, targetOrigin);
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
  globalThis.postMessage(event, targetOrigin);
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
    onSetPinState,
    getPinState,
  } = params;

  // Store the allowed origin globally for use by event-sending functions
  useEffect(() => {
    _allowedOriginRef.value = allowedOrigin;
  }, [allowedOrigin]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      // ── Security check ──────────────────────────────────────────────────
      if (allowedOrigin !== "*" && event.origin !== allowedOrigin) {
        return;
      }

      const msg = event.data;

      // ── Guard: must be a plain object with a `type` string ───────────────
      if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") {
        return;
      }

      const message = msg as SimulatorMessage;

      switch (message.type) {
        case SimulatorActionType.LOAD_CODE: {
          const payload = message.payload as { code: string };
          onLoadCode(payload.code);
          break;
        }

        case SimulatorActionType.START_SIMULATION: {
          onStartSimulation();
          break;
        }

        case SimulatorActionType.STOP_SIMULATION: {
          onStopSimulation();
          break;
        }

        case SimulatorActionType.SET_PIN_STATE: {
          const payload = message.payload as { pin: number; value: number };
          onSetPinState(payload.pin, payload.value);
          break;
        }

        case SimulatorActionType.GET_PIN_STATE: {
          const payload = message.payload as { pin: number };
          const value = getPinState(payload.pin);
          sendMessageToParent(
            { type: SimulatorActionType.GET_PIN_STATE, success: true, data: value },
            allowedOrigin,
          );
          break;
        }

        case SimulatorActionType.BATCH_SET_PIN_STATE: {
          const payload = message.payload as { pins: Array<{ pin: number; value: number }> };
          if (Array.isArray(payload.pins)) {
            for (const pinState of payload.pins) {
              onSetPinState(pinState.pin, pinState.value);
            }
          }
          break;
        }

        default:
          // Unknown action — silently ignore
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [allowedOrigin, onLoadCode, onStartSimulation, onStopSimulation, onSetPinState, getPinState]);
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
  state: "RUNNING" | "STOPPED" | "PAUSED" | "ERROR",
  message?: string,
): void {
  try {
    const event: SimulatorEventMessage<typeof SimulatorEventType.SIMULATION_STATE_EVENT> = {
      version: API_VERSION,
      type: SimulatorEventType.SIMULATION_STATE_EVENT,
      success: true,
      data: { state, ...(message === undefined ? {} : { message }) },
    };
    sendEventToParent(event, getAllowedOrigin());
  } catch {
    // Silently ignore — postMessage errors are expected when not embedded
  }
}
