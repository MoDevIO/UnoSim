// execution-phases/stream-phase.ts
// Verantwortlichkeit: Stream-/Output-Verarbeitung während der Ausführung
// - Runtime-Callbacks wrappen
// - Geparste Stream-Zeilen an StreamHandler delegieren
// - stderr-Fallback-Puffer verarbeiten

import type { Logger } from "@shared/logger";
import type { PinStateChange } from "@shared/types/arduino.types";
import type { ParsedStderrOutput, ArduinoOutputParser } from "../../arduino-output-parser";
import type { RegistryManager } from "../../registry-manager";
import type { StreamHandler } from "../stream-handler";
import type { ExecutionState } from "../execution-manager";

interface StreamCallbacks {
  onOutput: (line: string, isComplete?: boolean) => void;
  onError: (line: string) => void;
  onPinState?: (pin: number, type: PinStateChange, value: number) => void;
}

interface StreamDependencies {
  registryManager: RegistryManager;
  streamHandler: StreamHandler;
}

interface StreamCallbackDependencies {
  registryManager: Pick<RegistryManager, "isWaiting">;
  logger: Logger;
}

/**
 * Erstellt Runtime-Callbacks mit Queueing, Telemetrie-Erkennung und Batcher-Routing.
 */
export function createStreamCallbacks(
  onOutput: (line: string, isComplete?: boolean) => void,
  onError: (line: string) => void,
  onPinState: ((pin: number, type: PinStateChange, value: number) => void) | undefined,
  state: ExecutionState | undefined,
  deps: StreamCallbackDependencies,
): StreamCallbacks {
  return {
    onOutput: (line: string, isComplete?: boolean) => {
      if (typeof line === "string" && line.startsWith("[[SIM_TELEMETRY:") && line.endsWith("]]")) {
        try {
          const jsonStr = line.slice("[[SIM_TELEMETRY:".length, -2);
          const metrics = JSON.parse(jsonStr);
          if (state?.telemetryCallback) {
            state.telemetryCallback(metrics);
          }
          return;
        } catch (err) {
          deps.logger.warn(`Failed to parse telemetry marker: ${err}`);
        }
      }

      if (state?.serialOutputBatcher) {
        state.serialOutputBatcher.enqueue(line);
      } else if (onOutput && state?.processKilled === false) {
        onOutput(line, isComplete);
      }
    },
    onPinState: (pin: number, stateType: PinStateChange, value: number) => {
      if (state && deps.registryManager.isWaiting()) {
        state.messageQueue.push({
          type: "pinState",
          data: { pin, stateType, value },
        });
      } else if (onPinState) {
        onPinState(pin, stateType, value);
      }
    },
    onError: (line: string) => {
      if (onError) {
        onError(line);
      }
    },
  };
}

/**
 * Delegiert eine geparste stderr/stdout-Zeile an den bestehenden StreamHandler.
 */
export function delegateParsedLineToStreamHandler(
  parsed: ParsedStderrOutput,
  state: ExecutionState | undefined,
  callbacks: StreamCallbacks,
  deps: StreamDependencies,
): void {
  if (!state) return;

  const streamState = {
    pinStateBatcher: state.pinStateBatcher,
    serialOutputBatcher: state.serialOutputBatcher,
    backpressurePaused: state.backpressurePaused,
    isPaused: state.state === "paused",
    baudrate: state.baudrate,
    registryManager: deps.registryManager,
  };

  deps.streamHandler.handleParsedLine(parsed, streamState, callbacks);
  state.backpressurePaused = streamState.backpressurePaused;
}

/**
 * Verarbeitet gepufferte stderr-Daten, wenn kein Line-Streaming verfügbar ist.
 */
export function handleStderrFallbackData(
  data: Buffer,
  state: ExecutionState,
  callbacks: StreamCallbacks,
  deps: StreamDependencies & { stderrParser: ArduinoOutputParser },
): void {
  state.stderrFallbackBuffer += data.toString();
  const lines = state.stderrFallbackBuffer.split(/\r?\n/);
  state.stderrFallbackBuffer = lines.pop() || "";

  for (const line of lines) {
    if (!line) continue;
    const parsed = deps.stderrParser.parseStderrLine(line, state.processStartTime);
    delegateParsedLineToStreamHandler(parsed, state, callbacks, deps);
  }
}
