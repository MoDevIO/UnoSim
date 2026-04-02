import { useEffect } from "react";
import { SimulatorActionType } from "@/types/external-api";
import type { SimulatorMessage, SimulatorResponse } from "@/types/external-api";

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

/**
 * Sends a response message to the parent frame.
 *
 * @param response - The response payload to send.
 * @param targetOrigin - The target origin for the postMessage call.
 *   Pass the parent origin explicitly to prevent data leakage (S2819).
 *   Use `"*"` only when the caller intentionally allows any receiver.
 */
export function sendMessageToParent(
  response: SimulatorResponse,
  targetOrigin: string,
): void {
  globalThis.postMessage(response, targetOrigin);
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
