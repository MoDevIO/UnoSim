import { useState, useEffect, useRef, useCallback } from "react";

export interface DebugMessage {
  id: string;
  timestamp: Date;
  sender: "server" | "frontend";
  type: string;
  content: string;
  protocol?: "websocket" | "http";
}

export function useDebugConsole(activeOutputTab: string) {
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try {
      return globalThis.localStorage.getItem("unoDebugMode") === "1";
    } catch {
      return false;
    }
  });

  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
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
      sender: "server" | "frontend",
      type: string,
      content: string,
      protocol?: "websocket" | "http",
    ) => {
      // Only collect debug messages if debug mode is enabled
      if (!debugMode) return;

      const message: DebugMessage = {
        id: `${Date.now()}-${crypto.randomUUID()}`,
        timestamp: new Date(),
        sender,
        type,
        content,
        protocol,
      };
      setDebugMessages((prev) => {
        const updated = [...prev, message];
        // Keep last 500 messages to avoid memory issues
        return updated.slice(-500);
      });
    },
    [debugMode],
  );

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
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  };
}
