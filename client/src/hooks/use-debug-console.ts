import { retainTutorDebugMessages } from "@/lib/debug-retention";
import { readTutorDebugMessage } from "@/lib/tutor-diagnostic-events";
import { useState, useEffect, useRef, useCallback } from "react";
import { generateUuidV4 } from "@/lib/uuid";
import type { TutorDiagnosticEvent } from "@shared/tutor-diagnostics";

/** Transport of a logged message: HTTP, the WebSocket, or the browser emulation's worker. */
export type DebugProtocol = "websocket" | "http" | "worker";

/** Who sent a logged message: the server, the page itself, or the browser emulation. */
export type DebugSender = "server" | "frontend" | "browser";

export interface DebugMessage {
  id: string;
  timestamp: Date;
  sender: DebugSender;
  type: string;
  content: string;
  protocol?: DebugProtocol;
  category?: "tutor";
  details?: TutorDiagnosticEvent;
}

export function useDebugConsole(activeOutputTab: string) {
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try {
      return globalThis.localStorage.getItem("unoDebugMode") === "1";
    } catch {
      return false;
    }
  });

  const [{ messages: debugMessages, dropped: debugDroppedCount }, setLog] = useState<{ messages: DebugMessage[]; dropped: number }>({ messages: [], dropped: 0 });
  const setDebugMessages = useCallback<React.Dispatch<React.SetStateAction<DebugMessage[]>>>((value) => {
    setLog((previous) => {
      const messages = typeof value === "function" ? value(previous.messages) : value;
      return { messages: messages.slice(-500), dropped: Array.isArray(value) && value.length === 0 ? 0 : previous.dropped + Math.max(0, messages.length - 500) };
    });
  }, []);
  const resetSimulationDebugMessages = useCallback(() => setDebugMessages(retainTutorDebugMessages), [setDebugMessages]);
  const [debugMessageFilter, setDebugMessageFilter] = useState<string>("");
  const [debugViewMode, setDebugViewMode] = useState<"table" | "tiles">("table");
  const debugMessagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Listen for debug mode change events from settings dialog
  useEffect(() => {
    type BoolDetailEvent = CustomEvent<{ value: boolean }>;

    const handler = (ev: BoolDetailEvent) => {
      try {
        const newValue = Boolean(ev?.detail?.value);
        setDebugMode(newValue);
      } catch {
        // ignore
      }
    };

    document.addEventListener("debugModeChange", handler as EventListener);
    return () =>
      document.removeEventListener("debugModeChange", handler as EventListener);
  }, []);

  const addDebugMessage = useCallback(
    (
      sender: DebugSender,
      type: string,
      content: string,
      protocol?: DebugProtocol,
    ) => {
      // Only collect debug messages if debug mode is enabled
      if (!debugMode) return;

      const message: DebugMessage = {
        id: `${Date.now()}-${generateUuidV4()}`,
        timestamp: new Date(),
        sender,
        type,
        content,
        protocol,
      };
      setDebugMessages((prev) => {
        const updated = [...prev, message];
        // Keep last 500 messages to avoid memory issues
        return updated;
      });
    },
    [debugMode, setDebugMessages],
  );

  useEffect(() => {
    if (!debugMode) return;
    const receive = (event: Event) => {
      const message = readTutorDebugMessage((event as CustomEvent<unknown>).detail);
      if (message) setDebugMessages((previous) => [...previous, message]);
    };
    document.addEventListener("tutor-diagnostic", receive);
    return () => document.removeEventListener("tutor-diagnostic", receive);
  }, [debugMode, setDebugMessages]);

  // Auto-scroll debug console to latest message
  useEffect(() => {
    if (activeOutputTab === "debug" && debugMessagesContainerRef.current) {
      requestAnimationFrame(() => {
        debugMessagesContainerRef.current?.scrollTo(
          0,
          debugMessagesContainerRef.current.scrollHeight,
        );
      });
    }
  }, [debugMessages, activeOutputTab]);

  return {
    debugMode,
    setDebugMode,
    debugMessages,
    debugDroppedCount,
    resetSimulationDebugMessages,
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  };
}
