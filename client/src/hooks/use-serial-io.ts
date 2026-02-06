import { useState, useCallback } from "react";
import type { OutputLine } from "@shared/schema";

export function useSerialIO() {
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [serialViewMode, setSerialViewMode] = useState<"monitor" | "plotter" | "both">("monitor");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);
  const [serialInputValue, setSerialInputValue] = useState("");

  const showSerialMonitor = serialViewMode !== "plotter";
  const showSerialPlotter = serialViewMode !== "monitor";

  const cycleSerialViewMode = useCallback(() => {
    setSerialViewMode((prev) => {
      if (prev === "monitor") return "both";
      if (prev === "both") return "plotter";
      return "monitor";
    });
  }, []);

  const clearSerialOutput = useCallback(() => {
    setSerialOutput([]);
  }, []);

  return {
    serialOutput,
    setSerialOutput,
    serialViewMode,
    setSerialViewMode,
    autoScrollEnabled,
    setAutoScrollEnabled,
    serialInputValue,
    setSerialInputValue,
    showSerialMonitor,
    showSerialPlotter,
    cycleSerialViewMode,
    clearSerialOutput,
  };
}
