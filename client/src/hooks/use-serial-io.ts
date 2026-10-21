import { limitSerialText } from "@/utils/serial-text-limit";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { OutputLine } from "@shared/schema";
import { SerialCharacterRenderer } from "@/utils/serial-character-renderer";
import { emitSerialOutput } from "./use-external-api";

/**
 * Serial text of the sketch. `Serial` (port 0) keeps its line list for the plotter and its baud-paced
 * renderer; `Serial1`–`Serial3` (Mega 2560) have their text only and show it unpaced. The monitor shows
 * one port at a time (`serialPort`); a board with fewer ports falls back to `Serial`.
 */
export function useSerialIO() {
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [portCount, setSerialPortCount] = useState(1);
  const [selectedPort, setSelectedPort] = useState(0);
  const [extraPortTexts, setExtraPortTexts] = useState<Readonly<Record<number, string>>>({});
  const serialPort = selectedPort < portCount ? selectedPort : 0;
  const [serialViewMode, setSerialViewMode] = useState<"monitor" | "plotter" | "both">("monitor");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);
  const [serialInputValue, setSerialInputValue] = useState("");
  
  // Baudrate-simulated rendering
  const [renderedSerialText, setRenderedSerialText] = useState<string>("");
  const rendererRef = useRef<SerialCharacterRenderer | null>(null);
  const emitDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingOutputRef = useRef<Map<number, string>>(new Map());

  const selectedText = serialPort === 0 ? renderedSerialText : (extraPortTexts[serialPort] ?? "");

  // Convert the text of the selected port to OutputLine[] format for SerialMonitor
  const renderedSerialOutput = useMemo<OutputLine[]>(() => {
    if (!selectedText) return [];
    
    const lines = selectedText.split('\n');
    return lines.map((line, index) => ({
      text: line,
      complete: index < lines.length - 1, // All lines except last are complete
    }));
  }, [selectedText]);

  // Initialize renderer once and cleanup on unmount
  useEffect(() => {
    const renderer = new SerialCharacterRenderer((char: string) => {
      setRenderedSerialText((prev) => limitSerialText(prev + char));
    });
    rendererRef.current = renderer;

    return () => {
      renderer.clear();
      // Clean up debounce timer on unmount
      if (emitDebounceRef.current !== null) {
        clearTimeout(emitDebounceRef.current);
        emitDebounceRef.current = null;
      }
      pendingOutputRef.current.clear();
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

  /** Clears one port (`Serial` also clears the plotter data), or every port when none is given. */
  const clearSerialOutput = useCallback((port?: number) => {
    if (port !== undefined && port !== 0) {
      setExtraPortTexts((prev) => ({ ...prev, [port]: "" }));
      pendingOutputRef.current.delete(port);
      return;
    }
    if (port === undefined) setExtraPortTexts({});
    setSerialOutput([]);
    if (rendererRef.current) {
      rendererRef.current.clear();
      // Re-enable rendering so the next serial output is displayed.
      // clear() pauses the renderer (to stop current animation), but we must
      // resume() so that data arriving after the clear is not silently dropped.
      rendererRef.current.resume();
    }
    setRenderedSerialText("");
    
    // Clean up any pending debounced emit
    if (emitDebounceRef.current !== null) {
      clearTimeout(emitDebounceRef.current);
      emitDebounceRef.current = null;
    }
    pendingOutputRef.current.clear();
  }, []);

  // Baudrate rendering methods
  const appendSerialOutput = useCallback((text: string, port = 0) => {
    if (port === 0) {
      const isTestMode =
        globalThis.window !== undefined && (globalThis as any).__PLAYWRIGHT_TEST__;
      if (isTestMode) {
        // in tests we bypass baudrate rendering to make output appear instantly
        setRenderedSerialText((prev) => limitSerialText(prev + text));
      } else {
        rendererRef.current?.enqueue(text);
      }
    } else {
      setExtraPortTexts((prev) => ({ ...prev, [port]: limitSerialText((prev[port] ?? "") + text) }));
    }
    
    // Emit serial output event to parent frame for dashboard monitoring.
    // Start one bounded flush window per batch: subsequent chunks are added to
    // the same buffer without postponing the already scheduled flush. This
    // preserves ordering while preventing continuous output from starving the
    // external API under browsers that throttle timers in iframes.
    pendingOutputRef.current.set(port, (pendingOutputRef.current.get(port) ?? "") + text);

    emitDebounceRef.current ??= setTimeout(() => {
      emitDebounceRef.current = null;
      const pending = [...pendingOutputRef.current];
      pendingOutputRef.current.clear();
      for (const [pendingPort, output] of pending) {
        if (!output) continue;
        if (pendingPort === 0) emitSerialOutput(output);
        else emitSerialOutput(output, pendingPort);
      }
    }, 100);
  }, []);

  const setBaudrate = useCallback((baud: number | undefined) => {
    const isTestMode =
      globalThis.window !== undefined && (globalThis as any).__PLAYWRIGHT_TEST__;
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
    // Ensure injected text starts on a new line if current output
    // doesn't end with one (e.g., partial serial line was rendering)
    const appended = (prev: string) => limitSerialText(prev.length > 0 && !prev.endsWith('\n') ? prev + '\n' + text : prev + text);
    setRenderedSerialText(appended);
    // A system line concerns the whole board, so every port shows it.
    if (portCount > 1) {
      setExtraPortTexts((prev) => {
        const next: Record<number, string> = { ...prev };
        for (let port = 1; port < portCount; port++) next[port] = appended(prev[port] ?? "");
        return next;
      });
    }
  }, [portCount]);

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
    serialPort,
    setSerialPort: setSelectedPort,
    serialPortCount: portCount,
    setSerialPortCount,
    
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
