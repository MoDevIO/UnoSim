import { useEffect } from "react";
import { parseStaticIORegistry } from "@shared/io-registry-parser";
import type { ParserMessage, IOPinRecord, Sketch } from "@shared/schema";

interface UseSimulatorEffectsProps {
  // Code and compilation
  code: string;
  compilationStatus: "ready" | "compiling" | "success" | "error";
  hasCompilationErrors: boolean;
  parserMessages: ParserMessage[];
  parserPanelDismissed: boolean;
  activeOutputTab: "compiler" | "messages" | "registry" | "debug";

  // Setters
  setCompilationStatus: (status: "ready" | "compiling" | "success" | "error") => void;
  setActiveOutputTab: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  setIoRegistry: (registry: IOPinRecord[] | ((prev: IOPinRecord[]) => IOPinRecord[])) => void;
  setSerialOutput: (output: any[] | ((prev: any[]) => any[])) => void;

  // Simulation state
  simulationStatus: "stopped" | "running" | "paused";

  // Pin state
  setPinStates: (states: any[] | ((prev: any[]) => any[])) => void;
  analogPinsUsed: number[];
  detectedPinModes: Record<string, "INPUT" | "OUTPUT" | "INPUT_PULLUP">;

  // Serial output
  serialOutput: any[];
  arduinoCliStatus: string;

  // Tabs and file system
  tabs: Array<{ id: string; content: string }>;
  activeTabId: string | null;
  setTabs: (tabs: any[] | ((prev: any[]) => any[])) => void;
  sketches?: Sketch[];
  initializeDefaultSketch?: (sketches: Sketch[] | undefined) => void;

  // Debug
  debugMessages: any[];
  debugMessagesContainerRef: React.RefObject<HTMLDivElement>;

  // Refs
  serialEventQueueRef: React.RefObject<any[]>;
}

export function useSimulatorEffects({
  code,
  compilationStatus,
  hasCompilationErrors,
  parserMessages,
  parserPanelDismissed,
  setCompilationStatus,
  setActiveOutputTab,
  setIoRegistry,
  setSerialOutput,
  simulationStatus,
  setPinStates,
  analogPinsUsed,
  detectedPinModes,
  serialOutput,
  arduinoCliStatus,
  tabs,
  activeTabId,
  setTabs,
  sketches,
  initializeDefaultSketch,
  debugMessages,
  debugMessagesContainerRef,
  activeOutputTab,
  serialEventQueueRef,
}: UseSimulatorEffectsProps) {
  // Mark serialEventQueueRef and activeOutputTab as intentionally used
  void serialEventQueueRef;
  void activeOutputTab;
  // Auto-switch output tab based on errors and messages
  useEffect(() => {
    if (hasCompilationErrors) {
      setActiveOutputTab("compiler");
    } else if (parserMessages.length > 0 && !parserPanelDismissed) {
      setActiveOutputTab("messages");
    }
  }, [
    hasCompilationErrors,
    parserMessages.length,
    parserPanelDismissed,
    setActiveOutputTab,
  ]);

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
  }, [debugMessages, activeOutputTab, debugMessagesContainerRef]);

  // Reset status when code actually changes
  useEffect(() => {
    if (arduinoCliStatus !== "idle") {
      // Update CLI status (managed elsewhere)
    }
    if (compilationStatus !== "ready") {
      setCompilationStatus("ready");
    }
  }, [code, compilationStatus, setCompilationStatus, arduinoCliStatus]);

  // File system initialization (default sketch loading)
  useEffect(() => {
    if (initializeDefaultSketch) {
      initializeDefaultSketch(sketches);
    }
  }, [sketches, initializeDefaultSketch]);

  // Persist code changes to the active tab
  useEffect(() => {
    if (activeTabId && tabs.length > 0) {
      setTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content: code } : tab,
        ),
      );
    }
  }, [code, activeTabId, setTabs, tabs.length]);

  // Apply pinMode declarations when simulation starts
  useEffect(() => {
    if (simulationStatus !== "running") return;

    setPinStates((prev) => {
      const newStates = [...prev];

      // Apply recorded pinMode(...) declarations
      for (const [pinStr, mode] of Object.entries(detectedPinModes) as [
        string,
        "INPUT" | "OUTPUT" | "INPUT_PULLUP",
      ][]) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({
            pin,
            mode,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        } else {
          exists.mode = mode;
          if (pin >= 14 && pin <= 19) exists.type = "digital";
        }
      }

      // Ensure detected analog pins are present
      for (const pin of analogPinsUsed) {
        if (pin < 14 || pin > 19) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({ pin, mode: "INPUT", value: 0, type: "analog" });
        }
      }

      return newStates;
    });
  }, [simulationStatus, analogPinsUsed, detectedPinModes, setPinStates]);

  // Apply detected pin modes after io_registry processing
  useEffect(() => {
    if (Object.keys(detectedPinModes).length === 0) {
      return;
    }

    setPinStates((prev) => {
      const newStates = [...prev];
      for (const [pinStr, mode] of Object.entries(detectedPinModes) as [
        string,
        "INPUT" | "OUTPUT" | "INPUT_PULLUP",
      ][]) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const pinState = newStates.find((p) => p.pin === pin);
        if (pinState) {
          pinState.mode = mode;
        } else {
          newStates.push({
            pin,
            mode,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        }
      }
      return newStates;
    });
  }, [detectedPinModes, simulationStatus, setPinStates]);

  // Flush pending incomplete lines when simulation stops
  useEffect(() => {
    if (simulationStatus === "stopped" && serialOutput.length > 0) {
      const lastLine = serialOutput[serialOutput.length - 1];
      if (lastLine && !lastLine.complete) {
        setSerialOutput((prev) => {
          if (prev.length === 0) return prev;
          return [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1], complete: true },
          ];
        });
      }
    }
  }, [simulationStatus, serialOutput, setSerialOutput]);

  // Static IO-Registry: update from code when simulation is not running
  useEffect(() => {
    if (simulationStatus !== "stopped") return;
    const timer = setTimeout(() => {
      setIoRegistry(parseStaticIORegistry(code));
    }, 300);
    return () => clearTimeout(timer);
  }, [code, simulationStatus, setIoRegistry]);
}
