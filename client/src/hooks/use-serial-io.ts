import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { OutputLine } from "@shared/schema";
import { SerialCharacterRenderer } from "@/utils/serial-character-renderer";

export function useSerialIO() {
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [serialViewMode, setSerialViewMode] = useState<"monitor" | "plotter" | "both">("monitor");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);
  const [serialInputValue, setSerialInputValue] = useState("");
  
  // Baudrate-simulated rendering
  const [renderedSerialText, setRenderedSerialText] = useState<string>("");
  const rendererRef = useRef<SerialCharacterRenderer | null>(null);

  // Convert renderedSerialText to OutputLine[] format for SerialMonitor
  const renderedSerialOutput = useMemo<OutputLine[]>(() => {
    if (!renderedSerialText) return [];
    
    const lines = renderedSerialText.split('\n');
    return lines.map((line, index) => ({
      text: line,
      complete: index < lines.length - 1, // All lines except last are complete
    }));
  }, [renderedSerialText]);

  // Initialize renderer once
  useEffect(() => {
    const renderer = new SerialCharacterRenderer((char: string) => {
      setRenderedSerialText((prev) => prev + char);
    });
    rendererRef.current = renderer;

    return () => {
      renderer.clear();
    };
  }, []);


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
    rendererRef.current?.clear();
    setRenderedSerialText("");
  }, []);

  // Baudrate rendering methods
  const appendSerialOutput = useCallback((text: string) => {
    const isTestMode =
      typeof window !== "undefined" && (window as any).__PLAYWRIGHT_TEST__;
    if (isTestMode) {
      // in tests we bypass baudrate rendering to make output appear instantly
      setRenderedSerialText((prev) => prev + text);
    } else {
      rendererRef.current?.enqueue(text);
    }
  }, []);

  const setBaudrate = useCallback((baud: number | undefined) => {
    const isTestMode =
      typeof window !== "undefined" && (window as any).__PLAYWRIGHT_TEST__;
    rendererRef.current?.setBaudrate(isTestMode ? 0 : baud);
  }, []);

  const pauseRendering = useCallback(() => {
    rendererRef.current?.pause();
  }, []);

  const resumeRendering = useCallback(() => {
    rendererRef.current?.resume();
  }, []);

  /**
   * Stop rendering and clear the renderer queue.
   * Used on STOP to prevent old data from leaking into the next simulation.
   * Unlike pauseRendering(), this discards all pending characters.
   */
  const stopRendering = useCallback(() => {
    rendererRef.current?.clear();
  }, []);

  /**
   * Inject text directly into rendered output, bypassing the baudrate renderer.
   * Used for system messages ("--- Simulation paused ---" etc.) that must
   * appear instantly regardless of baudrate.
   */
  const appendRenderedText = useCallback((text: string) => {
    setRenderedSerialText((prev) => {
      // Ensure injected text starts on a new line if current output
      // doesn't end with one (e.g., partial serial line was rendering)
      if (prev.length > 0 && !prev.endsWith('\n')) {
        return prev + '\n' + text;
      }
      return prev + text;
    });
  }, []);

  return {
    // Existing API (unchanged - for backward compatibility and Plotter)
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
    
    // New baudrate rendering API
    renderedSerialText,
    renderedSerialOutput, // OutputLine[] format for SerialMonitor
    appendSerialOutput,
    setBaudrate,
    pauseRendering,
    resumeRendering,
    stopRendering,
    appendRenderedText,
  };
}

