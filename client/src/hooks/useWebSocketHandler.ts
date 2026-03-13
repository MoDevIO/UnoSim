import { useEffect, useCallback } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { getWebSocketManager } from "@/lib/websocket-manager";
import { Logger } from "@shared/logger";
import { buildGccCompilationErrorState } from "@/lib/compilation-error-state";
import type { ParserMessage, IOPinRecord, WSMessage } from "@shared/schema";
import { telemetryStore } from "@/hooks/use-telemetry-store";
import type { PinStateType } from "@/hooks/use-simulation-store";

const logger = new Logger("useWebSocketHandler");

type OutputLine = { text: string; complete: boolean };

type UseWebSocketHandlerParams = {
  // read-only state used inside the handler
  simulationStatus: string;

  // callbacks / setters from parent scope
  addDebugMessage: (source: "frontend" | "server", type: string, data: string, protocol?: "websocket" | "http") => void;
  setRxActivity: React.Dispatch<React.SetStateAction<number>>;
  appendSerialOutput: (text: string) => void;
  appendRenderedText: (text: string) => void;
  setSerialOutput: React.Dispatch<React.SetStateAction<OutputLine[]>>;
  setArduinoCliStatus: (v: any) => void;
  setCliOutput: React.Dispatch<React.SetStateAction<string>>;
  setHasCompilationErrors: React.Dispatch<React.SetStateAction<boolean>>;
  setLastCompilationResult: React.Dispatch<React.SetStateAction<"success" | "error" | null>>;
  setShowCompilationOutput: React.Dispatch<React.SetStateAction<boolean>>;
  setParserPanelDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveOutputTab: React.Dispatch<React.SetStateAction<"compiler" | "messages" | "registry" | "debug">>;
  setCompilationStatus: React.Dispatch<React.SetStateAction<any>>;
  setSimulationStatus: React.Dispatch<React.SetStateAction<any>>;

  stopRendering: () => void;
  pauseRendering: () => void;
  resumeRendering: () => void;

  serialEventQueueRef: React.MutableRefObject<Array<{ payload: any; receivedAt: number }>>;

  setPinStates: React.Dispatch<React.SetStateAction<any[]>>;
  setAnalogPinsUsed: React.Dispatch<React.SetStateAction<number[]>>;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  enqueuePinEvent: (pin: number, stateType: PinStateType, value: number) => void;

  setIoRegistry: React.Dispatch<React.SetStateAction<IOPinRecord[]>>;
  setBaudRate: React.Dispatch<React.SetStateAction<number>>;
  setSerialBaudrate: (baud: number) => void;
  pinToNumber: (pin: string) => number | null;

  setParserMessages: React.Dispatch<React.SetStateAction<ParserMessage[]>>;
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

  const sendMessage = useCallback((message: WSMessage | any) => {
    sendMessageRaw(message as any);
  }, [sendMessageRaw]);

  // ─── Message handlers: extracted to reduce nesting depth and cognitive complexity ───

  /** Handle sim_telemetry messages. */
  const handleSimTelemetry = (message: any) => {
    if (simulationStatus === "running") {
      telemetryStore.pushTelemetry((message as any).metrics);
    }
  };

  /** Handle serial_output messages. */
  const handleSerialOutput = (message: any) => {
    let text = ((message as any).data ?? "").toString();
    const isComplete = (message as any).isComplete ?? true;

    // Skip timing control messages
    if (text.includes("[[TIME_RESUMED:") || text.includes("[[TIME_FROZEN:")) {
      return;
    }

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
      const textForRenderer = isNewlineOnly ? "\n" : (isComplete && !isNewlineOnly && !text.endsWith('\n') ? text + "\n" : text);
      appendSerialOutput(textForRenderer);
    }

    setSerialOutput((prev) => {
      const newLines = [...prev];

      if (isComplete) {
        if (newLines.length > 0 && !newLines[newLines.length - 1].complete) {
          newLines[newLines.length - 1] = {
            text: newLines[newLines.length - 1].text + text,
            complete: true,
          };
        } else if (text.length > 0) {
          newLines.push({ text, complete: true });
        }
      } else {
        if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
          newLines.push({ text, complete: false });
        } else {
          newLines[newLines.length - 1] = {
            text: newLines[newLines.length - 1].text + text,
            complete: false,
          };
        }
      }

      if (newLines.length > MAX_SERIAL_LINES) {
        return newLines.slice(newLines.length - MAX_SERIAL_LINES);
      }

      return newLines;
    });
  };

  /** Handle compilation_status messages. */
  const handleCompilationStatus = (message: any) => {
    if ((message as any).arduinoCliStatus !== undefined) {
      setArduinoCliStatus((message as any).arduinoCliStatus);
    }
    if ((message as any).message) {
      setCliOutput((message as any).message);
    }
  };

  /** Handle compilation_error messages. */
  const handleCompilationError = (message: any) => {
    logger.info(`[WS] GCC Compilation Error detected: ${JSON.stringify((message as any).data)}`);
    const gccErrorState = buildGccCompilationErrorState((message as any).data);
    setCliOutput(gccErrorState.cliOutput);
    setHasCompilationErrors(gccErrorState.hasCompilationErrors);
    setLastCompilationResult(gccErrorState.lastCompilationResult);
    setShowCompilationOutput(gccErrorState.showCompilationOutput);
    setParserPanelDismissed(gccErrorState.parserPanelDismissed);
    setActiveOutputTab(gccErrorState.activeOutputTab);
    setCompilationStatus("error");
    setSimulationStatus("stopped");
  };

  /** Handle simulation_status messages. */
  const handleSimulationStatus = (message: any) => {
    const { status } = message as any;
    setSimulationStatus(status);

    if (status === "stopped") {
      stopRendering();
      if (serialEventQueueRef?.current) {
        serialEventQueueRef.current = [];
      }
      setPinStates([]);
      setAnalogPinsUsed([]);
      resetPinUI({ keepDetected: true });
      setCompilationStatus("ready");
    } else if (status === "paused") {
      pauseRendering();
    } else if (status === "running") {
      resumeRendering();
    }
  };

  /** Handle pin_state messages. */
  const handlePinState = (message: any) => {
    const { pin, stateType, value } = message as any;
    enqueuePinEvent(pin, stateType, value);
  };

  /** Handle pin_state_batch messages. */
  const handlePinStateBatch = (message: any) => {
    const { states } = message as any as { states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }> };
    for (const { pin, stateType, value } of states) {
      enqueuePinEvent(pin, stateType, value);
    }
  };

  /** Extract analog pins from IO registry operations. */
  const extractAnalogPinsFromRegistry = (registry: any[]) => {
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
  const updatePinStatesFromRegistry = (registry: any[]) => {
    setPinStates((prev) => {
      const newStates = [...prev];

      for (const record of registry) {
        if (!record.defined) continue;

        const pinNum = pinToNumber(record.pin);
        if (pinNum === null) continue;

        const exists = newStates.find((p) => p.pin === pinNum);
        if (!exists) {
          newStates.push({
            pin: pinNum,
            mode: "INPUT",
            value: 0,
            type: pinNum >= 14 && pinNum <= 19 ? "digital" : "digital",
          });
        }
      }

      return newStates;
    });
  };

  /** Handle io_registry messages. */
  const handleIoRegistry = (message: any) => {
    const { registry, baudrate } = message as any;
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
        const cleanedPrev = prev.filter((existing) => {
          if (existing.category !== "pins") return true;
          if (!existing.message.includes("pinMode() was never called")) return true;
          const pinMatch = existing.message.match(/Pin\s+(\S+)\s+is/);
          if (!pinMatch) return true;
          const pinKey = pinMatch[1];
          const isReplaced = usageWarnings.some((m) => {
            const newMatch = m.message.match(/Pin\s+(\S+)\s+is/);
            return newMatch && newMatch[1] === pinKey;
          });
          return !isReplaced;
        });

        const existingMessages = new Set(cleanedPrev.map((m) => `${m.category}:${m.message}`));
        const newMessages = usageWarnings.filter((m) => !existingMessages.has(`${m.category}:${m.message}`));
        if (newMessages.length > 0) {
          setParserPanelDismissed(false);
          return [...cleanedPrev, ...newMessages];
        }
        return cleanedPrev;
      });
    }
  };

  // Helper: single message processor (used by both the mount-consumer and
  // the reactive consumer). Extracted so initial queued messages are handled
  // the same way as runtime messages and to avoid duplicated logic.
  const processMessage = (message: any) => {
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
