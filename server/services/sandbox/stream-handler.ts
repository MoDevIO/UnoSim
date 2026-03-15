/**
 * StreamHandler: Manages I/O stream processing, pin state changes, and backpressure
 * Extracted from Etappe B: I/O Streams & Buffer Handling refactoring
 */

import type { IProcessController } from "../process-controller";
import type { PinStateBatcher } from "../pin-state-batcher";
import type { SerialOutputBatcher } from "../serial-output-batcher";
import type { RegistryManager } from "../registry-manager";
import { Logger } from "@shared/logger";

interface StreamHandlerCallbacks {
  onPinState?: (pin: number, type: "mode" | "value" | "pwm", value: number) => void;
  onOutput?: (line: string, isComplete?: boolean) => void;
  onError?: (line: string) => void;
}

interface StreamHandlerState {
  pinStateBatcher: PinStateBatcher | null;
  serialOutputBatcher: SerialOutputBatcher | null;
  backpressurePaused: boolean;
  isPaused: boolean;
  baudrate: number;
  registryManager: RegistryManager;
}

export class StreamHandler {
  private readonly logger = new Logger("StreamHandler");

  constructor(private readonly processController: IProcessController) {}

  /**
   * Handle pin state changes (mode, value, pwm) with optional batcher or fallback
   */
  handlePinStateChange(
    pin: number,
    type: "mode" | "value" | "pwm",
    value: number,
    state: StreamHandlerState,
    callbacks: StreamHandlerCallbacks,
  ): void {
    if (state.pinStateBatcher) {
      state.pinStateBatcher.enqueue(pin, type, value);
    } else if (callbacks.onPinState) {
      // Fallback if batcher not initialized
      callbacks.onPinState(pin, type, value);
    }
  }

  /**
   * Handle serial output event with backpressure management
   */
  handleSerialEvent(data: string, state: StreamHandlerState, callbacks: StreamHandlerCallbacks): void {
    // Check backpressure: if batcher exists and overloaded, pause child process
    if (
      state.serialOutputBatcher &&
      !state.backpressurePaused &&
      !state.isPaused &&
      state.baudrate > 300 && // don't throttle at very low baudrate
      state.serialOutputBatcher.isOverloaded()
    ) {
      this.logger.info("Backpressure: buffer overloaded, sending SIGSTOP");
      this.processController.kill("SIGSTOP");
      state.backpressurePaused = true;
    }

    // Route through SerialOutputBatcher for rate limiting
    if (state.serialOutputBatcher) {
      state.serialOutputBatcher.enqueue(data);
    } else if (callbacks.onOutput) {
      // Fallback if batcher not initialized
      callbacks.onOutput(data, true);
    }
  }

  /**
   * Handle a parsed line from stderr/stdout
   * Dispatches to appropriate handler based on message type
   */
  handleParsedLine(
    parsed: any,
    state: StreamHandlerState,
    callbacks: StreamHandlerCallbacks,
  ): void {
    switch (parsed.type) {
      case "registry_start":
        state.registryManager.startCollection();
        break;

      case "registry_end":
        state.registryManager.finishCollection();
        break;

      case "registry_pin":
        state.registryManager.addPin(parsed.pinRecord);
        break;

      case "pin_mode":
        state.registryManager.updatePinMode(parsed.pin, parsed.mode);
        this.handlePinStateChange(parsed.pin, "mode", parsed.mode, state, callbacks);
        break;

      case "pin_value":
        this.handlePinStateChange(parsed.pin, "value", parsed.value, state, callbacks);
        break;

      case "pin_pwm":
        this.handlePinStateChange(parsed.pin, "pwm", parsed.value, state, callbacks);
        break;

      case "serial_event":
        this.handleSerialEvent(parsed.data, state, callbacks);
        break;

      case "ignored":
        // Debug markers - do nothing
        break;

      case "text":
        if (callbacks.onError) {
          this.logger.warn(`[STDERR]: ${parsed.line}`);
          callbacks.onError(parsed.line);
        }
        break;
    }
  }
}
