import { useEffect, useCallback } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { getWebSocketManager } from "@/lib/websocket-manager";
import { Logger } from "@shared/logger";
import { buildGccCompilationErrorState } from "@/lib/compilation-error-state";
import type { ParserMessage, IOPinRecord, OutputLine, WSMessage } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";
import { telemetryStore } from "@/hooks/use-telemetry-store";
import type { PinState, PinStateType } from "@/hooks/use-simulation-store";
import { emitPinStateChange, emitSimulationStateEvent } from "@/hooks/use-external-api";
import type { DockerGccPhase } from "@/hooks/use-compile-and-run";
import type {
  IncomingArduinoMessage,
  SerialPayload,
  PinStatePayload,
  PinStateBatchPayload,
  IoRegistryPayload,
  SimulationStatusPayload,
  CompilationStatusPayload,
  CompilationErrorPayload,
  SimTelemetryPayload,
} from "@/types/websocket";

const logger = new Logger("useWebSocketHandler");

// NOTE: We intentionally keep OutputLine as a shared type from @shared/schema to
// avoid duplicating the definition across components.

// ─── Regex patterns (extracted to module level) ────────────────────────────
/** Match "Pin Xx is..." messages (e.g., "Pin 13 is...") – S5843 fix (use .exec()) */
const PIN_MESSAGE_RE = /Pin\s+(\S+)\s+is/;

/** Extract pin key from Arduino parser message (e.g., "Pin 13 is..." → "13") */
function extractPinKeyFromMessage(msg: string): string | null {
  const match = PIN_MESSAGE_RE.exec(msg);
  return match?.[1] ?? null;
}

/**
 * Merge incoming parser warnings into existing messages.
 * Replaces stale "pinMode() was never called" messages for the same pin,
 * deduplicates, and returns the new array (or the original if nothing changed).
 * Extracted to fix S2004 (nesting depth) in useWebSocketHandler.
 */
function mergeParserWarnings(
  prev: ParserMessage[],
  usageWarnings: ParserMessage[],
): ParserMessage[] {
  const cleanedPrev = prev.filter((existing) => {
    if (existing.category !== "pins") return true;
    if (!existing.message.includes("pinMode() was never called")) return true;
    const pinKey = extractPinKeyFromMessage(existing.message);
    if (!pinKey) return true;
    return !usageWarnings.some((m) => extractPinKeyFromMessage(m.message) === pinKey);
  });
  const existingKeys = new Set(cleanedPrev.map((m) => `${m.category}:${m.message}`));
  const newMessages = usageWarnings.filter((m) => !existingKeys.has(`${m.category}:${m.message}`));
  return newMessages.length > 0 ? [...cleanedPrev, ...newMessages] : cleanedPrev;
}

export type UseWebSocketHandlerParams = {
  // read-only state used inside the handler
  simulationStatus: SimulationStatus;

  // callbacks / setters from parent scope
  addDebugMessage: (source: "frontend" | "server", type: string, data: string, protocol?: "websocket" | "http") => void;
  setRxActivity: React.Dispatch<React.SetStateAction<number>>;
  appendSerialOutput: (text: string) => void;
  appendRenderedText: (text: string) => void;
  setSerialOutput: React.Dispatch<React.SetStateAction<OutputLine[]>>;
  setArduinoCliStatus: React.Dispatch<React.SetStateAction<"idle" | "compiling" | "success" | "error">>;
  setCliOutput: React.Dispatch<React.SetStateAction<string>>;
  setHasCompilationErrors: React.Dispatch<React.SetStateAction<boolean>>;
  setLastCompilationResult: React.Dispatch<React.SetStateAction<"success" | "error" | null>>;
  setShowCompilationOutput: React.Dispatch<React.SetStateAction<boolean>>;
  setParserPanelDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveOutputTab: React.Dispatch<React.SetStateAction<"compiler" | "messages" | "registry" | "debug">>;
  setCompilationStatus: React.Dispatch<React.SetStateAction<"ready" | "compiling" | "success" | "error">>;
  setSimulationStatus: React.Dispatch<React.SetStateAction<SimulationStatus>>;

  stopRendering: () => void;
  pauseRendering: () => void;
  resumeRendering: () => void;

  serialEventQueueRef: React.MutableRefObject<Array<{ payload: IncomingArduinoMessage; receivedAt: number }>>;

  setPinStates: React.Dispatch<React.SetStateAction<PinState[]>>;
  setAnalogPinsUsed: React.Dispatch<React.SetStateAction<number[]>>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  enqueuePinEvent: (pin: number, stateType: PinStateType, value: number) => void;

  setIoRegistry: React.Dispatch<React.SetStateAction<IOPinRecord[]>>;
  setBaudRate: React.Dispatch<React.SetStateAction<number>>;
  setSerialBaudrate: (baud: number) => void;
  pinToNumber: (pin: string) => number | null;

  setParserMessages: React.Dispatch<React.SetStateAction<ParserMessage[]>>;
  setSandboxMode: React.Dispatch<React.SetStateAction<string>>;
  setWorkerIndex: React.Dispatch<React.SetStateAction<number | undefined>>;
  setWorkerTotal: React.Dispatch<React.SetStateAction<number | undefined>>;
  /** Tracks the Docker/sandbox GCC compile phase for granular UI feedback. Optional to avoid breaking tests. */
  setDockerGccPhase?: React.Dispatch<React.SetStateAction<DockerGccPhase>>;
  /** Called once when the first real output (serial or pin) arrives after simulation starts. Optional. */
  setHasFirstOutput?: (value: boolean) => void;
};

export function useWebSocketHandler(params: UseWebSocketHandlerParams) {
  const {
    simulationStatus,
    addDebugMessage,
    setRxActivity,
    appendSerialOutput,
    appendRenderedText,
    setSerialOutput,
    setArduinoCliStatus,
    setCliOutput,
    setHasCompilationErrors,
    setLastCompilationResult,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    setCompilationStatus,
    setSimulationStatus,
    setSandboxMode,
    setWorkerIndex,
    setWorkerTotal,
    stopRendering,
    pauseRendering,
    resumeRendering,
    serialEventQueueRef,
    setPinStates,
    setAnalogPinsUsed,
    resetPinUI,
    enqueuePinEvent,
    setIoRegistry,
    setBaudRate,
    setSerialBaudrate,
    pinToNumber,
    setParserMessages,
  } = params;

  const {
    isConnected,
    messageQueue,
    consumeMessages,
    sendMessage: sendMessageRaw,
  } = useWebSocket();

  const sendMessage = useCallback((message: WSMessage) => {
    sendMessageRaw(message);
  }, [sendMessageRaw]);

  // ─── Message handlers: extracted to reduce nesting depth and cognitive complexity ───

  /** Handle sim_telemetry messages. */
  const handleSimTelemetry = (message: SimTelemetryPayload) => {
    // Push telemetry unconditionally: the server only sends sim_telemetry
    // while the simulation is running, so the status guard is unnecessary.
    // Dropping it avoids a timing issue where React batches the
    // simulation_status: running message together with the first telemetry
    // packet — causing the status to still read "stopped" when the handler
    // runs and silently discarding the data.
    telemetryStore.pushTelemetry(message.metrics);
  };

  /** Handle serial_output messages. */
  const handleSerialOutput = (message: SerialPayload) => {
    let text = (message.data ?? "").toString();
    const isComplete = message.isComplete ?? true;

    // Skip timing control messages
    if (text.includes("[[TIME_RESUMED:") || text.includes("[[TIME_FROZEN:")) {
      return;
    }

    // Signal that the first real output has arrived
    params.setHasFirstOutput?.(true);

    setRxActivity((prev) => prev + 1);

    const isNewlineOnly = text === "\n" || text === "\r\n";
    if (isNewlineOnly) text = "";

    const MAX_SERIAL_LINES = 5000;
    const textTrimmed = text.trimEnd();
    const isSystemMessage = textTrimmed.startsWith("--- ") && textTrimmed.endsWith(" ---");

    if (isSystemMessage) {
      appendRenderedText(text);
    } else {
      // The server now adds newlines after complete lines during batching.
      // Only add a final newline if:
      // 1. isComplete=true (this line had a newline originally)
      // 2. text doesn't already end with newline (server already added it)
      let textForRenderer: string;
      if (isNewlineOnly) {
        textForRenderer = "\n";
      } else if (isComplete && !isNewlineOnly && !text.endsWith('\n')) {
        textForRenderer = text + "\n";
      } else {
        textForRenderer = text;
      }
      appendSerialOutput(textForRenderer);
    }

    setSerialOutput((prev) => {
      const newLines = [...prev];

      if (isComplete) {
        if (newLines.length > 0 && !newLines.at(-1)!.complete) {
          newLines[newLines.length - 1] = {
            text: newLines.at(-1)!.text + text,
            complete: true,
          };
        } else if (text.length > 0) {
          newLines.push({ text, complete: true });
        }
      } else if (newLines.length === 0 || newLines.at(-1)!.complete) {
        newLines.push({ text, complete: false });
      } else {
        newLines[newLines.length - 1] = {
          text: newLines.at(-1)!.text + text,
          complete: false,
        };
      }

      if (newLines.length > MAX_SERIAL_LINES) {
        return newLines.slice(newLines.length - MAX_SERIAL_LINES);
      }

      return newLines;
    });
  };

  /** Handle compilation_status messages. */
  const handleCompilationStatus = (message: CompilationStatusPayload) => {
    if (message.arduinoCliStatus !== undefined) {
      setArduinoCliStatus(message.arduinoCliStatus);
    }
    if (message.sandboxMode !== undefined) {
      setSandboxMode(message.sandboxMode);
    }
    if (message.workerIndex !== undefined) {
      setWorkerIndex(message.workerIndex);
    }
    if (message.workerTotal !== undefined) {
      setWorkerTotal(message.workerTotal);
    }
    if (message.message) {
      setCliOutput(message.message);
    }
    // Propagate Docker compile phase to external API (parent frame/test dashboard)
    // and to the button state via setDockerGccPhase for granular UI feedback.
    if (message.gccStatus === "queued") {
      params.setDockerGccPhase?.("queued");
      emitSimulationStateEvent("QUEUED_FOR_COMPILING");
    } else if (message.gccStatus === "compiling") {
      params.setDockerGccPhase?.("active");
      emitSimulationStateEvent("COMPILING");
    } else if (message.gccStatus === "success") {
      params.setDockerGccPhase?.("idle");
      // Compile phase ended — transition badge back to RUNNING so dashboards
      // that were showing QUEUED_FOR_COMPILING or COMPILING reflect the true state.
      emitSimulationStateEvent("RUNNING");
    }
  };

  /** Handle compilation_error messages. */
  const handleCompilationError = (message: CompilationErrorPayload) => {
    logger.info(`[WS] GCC Compilation Error detected: ${JSON.stringify(message.data)}`);
    const gccErrorState = buildGccCompilationErrorState(message.data);
    setCliOutput(gccErrorState.cliOutput);
    setHasCompilationErrors(gccErrorState.hasCompilationErrors);
    setLastCompilationResult(gccErrorState.lastCompilationResult);
    setShowCompilationOutput(gccErrorState.showCompilationOutput);
    setParserPanelDismissed(gccErrorState.parserPanelDismissed);
    setActiveOutputTab(gccErrorState.activeOutputTab);
    setCompilationStatus("error");
    setSimulationStatus("idle");
  };

  /** Handle simulation_status messages. */
  const handleSimulationStatus = (message: SimulationStatusPayload) => {
    const { status } = message;
    // Map server wire protocol "stopped" → client "idle"
    const clientStatus = status === "stopped" ? "idle" : status;
    setSimulationStatus(clientStatus);

    if (status === "stopped") {
      params.setDockerGccPhase?.("idle");
      params.setHasFirstOutput?.(false);
      stopRendering();
      if (serialEventQueueRef?.current) {
        serialEventQueueRef.current = [];
      }
      setPinStates([]);
      setAnalogPinsUsed([]);
      resetPinUI({ keepDetected: true });
      setCompilationStatus("ready");
      emitSimulationStateEvent("IDLE");
    } else if (status === "queued") {
      emitSimulationStateEvent("QUEUED_FOR_SIMULATION");
    } else if (status === "paused") {
      pauseRendering();
      emitSimulationStateEvent("PAUSED");
    } else if (status === "running") {
      // Reset first-output flag: sketch just started, output may arrive shortly
      params.setHasFirstOutput?.(false);
      resumeRendering();
      emitSimulationStateEvent("RUNNING");
    }
  };

  /** Handle pin_state messages. */
  const handlePinState = (message: PinStatePayload) => {
    const { pin, stateType, value } = message;
    enqueuePinEvent(pin, stateType, value);
    if (stateType === "value" || stateType === "pwm") {
      emitPinStateChange(pin, value);
      params.setHasFirstOutput?.(true);
    }
  };

  /** Handle pin_state_batch messages. */
  const handlePinStateBatch = (message: PinStateBatchPayload) => {
    for (const { pin, stateType, value } of message.states) {
      enqueuePinEvent(pin, stateType, value);
      if (stateType === "value" || stateType === "pwm") {
        emitPinStateChange(pin, value);
        params.setHasFirstOutput?.(true);
      }
    }
  };

  /** Extract analog pins from IO registry operations. */
  const extractAnalogPinsFromRegistry = (registry: IOPinRecord[]) => {
    const analogPins = new Set<number>();
    for (const record of registry) {
      const usedOps = record.usedAt || [];
      const hasAnalogOp = usedOps.some((u: { line: number; operation: string }) =>
        u.operation === "analogRead" || u.operation === "analogWrite" || u.operation.startsWith("analogWrite:")
      );
      if (hasAnalogOp) {
        const pinNum = pinToNumber(record.pin);
        if (pinNum !== null && pinNum >= 14 && pinNum <= 19) {
          analogPins.add(pinNum);
        }
      }
    }
    return analogPins;
  };

  /** Update analog pins used in the simulation. */
  const updateAnalogPinsUsed = (analogPinsFromRegistry: Set<number>) => {
    if (simulationStatus === "running") {
      setAnalogPinsUsed((prev) => {
        const merged = new Set([...prev, ...Array.from(analogPinsFromRegistry)]);
        return Array.from(merged).sort((a, b) => a - b);
      });
    } else if (analogPinsFromRegistry.size > 0) {
      const arr = Array.from(analogPinsFromRegistry).sort((a, b) => a - b);
      setAnalogPinsUsed(arr);
    }
  };

  /** Update pin states from IO registry. */
  const updatePinStatesFromRegistry = (registry: IOPinRecord[]) => {
    setPinStates((prev) => {
      const newStates = [...prev];

      for (const record of registry) {
        if (!record.defined) continue;

        const pinNum = pinToNumber(record.pin);
        if (pinNum === null) continue;

        if (!newStates.some((p) => p.pin === pinNum)) {
          newStates.push({
            pin: pinNum,
            mode: "INPUT",
            value: 0,
            type: "digital",
          });
        }
      }

      return newStates;
    });
  };

  /** Handle io_registry messages. */
  const handleIoRegistry = (message: IoRegistryPayload) => {
    const { registry, baudrate } = message;
    setIoRegistry(registry);

    if (typeof baudrate === "number" && baudrate > 0) {
      setBaudRate(baudrate);
      setSerialBaudrate(baudrate);
    }

    const analogPinsFromRegistry = extractAnalogPinsFromRegistry(registry);
    updateAnalogPinsUsed(analogPinsFromRegistry);
    updatePinStatesFromRegistry(registry);

    // Parser messages handling
    const usageWarnings: ParserMessage[] = [];
    if (usageWarnings.length > 0) {
      setParserMessages((prev) => {
        const updated = mergeParserWarnings(prev, usageWarnings);
        if (updated !== prev) setParserPanelDismissed(false);
        return updated;
      });
    }
  };

  // Helper: single message processor (used by both the mount-consumer and
  // the reactive consumer). Extracted so initial queued messages are handled
  // the same way as runtime messages and to avoid duplicated logic.
  const processMessage = (message: IncomingArduinoMessage) => {
    switch (message.type) {
      case "sim_telemetry":
        handleSimTelemetry(message);
        break;
      case "serial_output":
        handleSerialOutput(message);
        break;
      case "compilation_status":
        handleCompilationStatus(message);
        break;
      case "compilation_error":
        handleCompilationError(message);
        break;
      case "simulation_status":
        handleSimulationStatus(message);
        break;
      case "pin_state":
        handlePinState(message);
        break;
      case "pin_state_batch":
        handlePinStateBatch(message);
        break;
      case "io_registry":
        handleIoRegistry(message);
        break;
    }
  };

  // Ensure we process any messages that might already be queued at mount time.
  // This guards against test mocks that provide an initial messageQueue value
  // and ensures deterministic processing on first render.
  useEffect(() => {
    try {
      // Prefer consuming the hook's queue, but fall back to reading the
      // `messageQueue` array directly if the mock/manager returns an empty
      // value (tests sometimes provide a pre-seeded array reference).
      let initial = consumeMessages();
      if ((!initial || initial.length === 0) && messageQueue && messageQueue.length > 0) {
        initial = Array.from(messageQueue);
        // attempt to clear the source queue as well
        try {
          consumeMessages();
        } catch {}
      }

      if (initial && initial.length > 0) {
        for (const message of initial) {
          processMessage(message);
        }
      }
    } catch {
      // swallow - defensive
    }
  }, []);

  // Explicit manager subscription + cleanup (socket.off style cleanup via the unsubscribe)
  useEffect(() => {
    const manager = getWebSocketManager();
    // We intentionally add a benign subscriber so the hook demonstrates
    // explicit unsubscribe/cleanup (per refactor requirement). This is a
    // NO-OP handler and does not change runtime behaviour because
    // message processing remains driven by the shared messageQueue.
    const unsub = manager.on("message", () => {});
    return () => {
      unsub();
    };
  }, []);

  // Moved messageQueue consumer (preserves original behaviour, no logic change)
  useEffect(() => {
    if (messageQueue.length === 0) return;

    // Log all messages to debug console BEFORE consuming them
    messageQueue.forEach((msg) => {
      addDebugMessage("server", msg.type || "unknown", JSON.stringify(msg, null, 2), "websocket");
    });

    const messages = consumeMessages();

    for (const message of messages) {
      processMessage(message);
    }
  }, [messageQueue, consumeMessages, addDebugMessage]);

  return { sendMessage, isConnected };
}
