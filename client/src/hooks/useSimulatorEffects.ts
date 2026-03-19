import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { parseStaticIORegistry } from "@shared/io-registry-parser";
import { useSketchAnalysis } from "@/hooks/use-sketch-analysis";
import type { ToastFn } from "@/hooks/use-toast";
import type { DebugMessage } from "@/hooks/use-debug-console";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { PinState } from "@/hooks/use-simulation-store";
import type { SketchTab } from "@/hooks/use-sketch-tabs";
import type { OutputLine, ParserMessage, IOPinRecord, Sketch } from "@shared/schema";

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
  setIoRegistry: Dispatch<SetStateAction<IOPinRecord[]>>;
  setSerialOutput: Dispatch<SetStateAction<OutputLine[]>>;

  // Simulation state
  simulationStatus: "stopped" | "running" | "paused";

  // Pin state
  setPinStates: Dispatch<SetStateAction<PinState[]>>;
  analogPinsUsed: number[];
  detectedPinModes: Record<string, "INPUT" | "OUTPUT" | "INPUT_PULLUP">;

  // Serial output
  serialOutput: OutputLine[];
  arduinoCliStatus: string;

  // Tabs and file system
  tabs: SketchTab[];
  activeTabId: string | null;
  setTabs: Dispatch<SetStateAction<SketchTab[]>>;
  sketches?: Sketch[];
  initializeDefaultSketch?: (sketches: Sketch[] | undefined) => void;

  // Debug
  debugMessages: DebugMessage[];
  debugMessagesContainerRef: RefObject<HTMLDivElement>;

  // Keyboard shortcuts
  isMac: boolean;
  compileMutationIsPending: boolean;
  startMutationIsPending: boolean;
  handleCompile: () => void;
  handleStop: () => void;
  handleCompileAndStart: () => void;
  toast: ToastFn;
  setDebugMode: (enabled: boolean) => void;

  // Sketch analysis sync
  setDetectedPinModes: (modes: Record<string, "INPUT" | "OUTPUT" | "INPUT_PULLUP">) => void;
  setPendingPinConflicts: Dispatch<SetStateAction<number[]>>;
  setAnalogPinsUsed: (pins: number[]) => void;

  // Refs
  serialEventQueueRef: RefObject<Array<{ payload: IncomingArduinoMessage; receivedAt: number }>>;
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
  isMac,
  compileMutationIsPending,
  startMutationIsPending,
  handleCompile,
  handleStop,
  handleCompileAndStart,
  toast,
  setDebugMode,
  setDetectedPinModes,
  setPendingPinConflicts,
  setAnalogPinsUsed,
}: UseSimulatorEffectsProps) {
  // Track refs used internally
  if (serialEventQueueRef.current === undefined) {
    // Noop - just ensuring variable is used
  }
  if (activeOutputTab === undefined) {
    // Noop - just ensuring variable is used
  }

  // Synchronize sketch analysis results (pins/modes/conflicts)
  const {
    analogPins,
    detectedPinModes: analyzedDetectedPinModes,
    pendingPinConflicts,
  } = useSketchAnalysis(code);

  useEffect(() => {
    setDetectedPinModes(analyzedDetectedPinModes);
    setPendingPinConflicts(pendingPinConflicts);
    setAnalogPinsUsed(analogPins);
  }, [
    analyzedDetectedPinModes,
    pendingPinConflicts,
    analogPins,
    setDetectedPinModes,
    setPendingPinConflicts,
    setAnalogPinsUsed,
  ]);

  // Keyboard shortcuts and global hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events originating from input-like elements
      const tgt = e.target as HTMLElement | null;
      const ignoreTarget =
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable);
      if (ignoreTarget) return;

      // Toggle debug mode (Cmd/Ctrl + D)
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;
      if (
        isModifierPressed &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "d" || e.key === "D")
      ) {
        e.preventDefault();
        const currentValue = globalThis.localStorage.getItem("unoDebugMode") === "1";
        const newValue = !currentValue;
        try {
          globalThis.localStorage.setItem("unoDebugMode", newValue ? "1" : "0");
          setDebugMode(newValue);
          const ev = new CustomEvent("debugModeChange", { detail: { value: newValue } });
          document.dispatchEvent(ev);
          toast({
            title: newValue ? "Debug Mode Enabled" : "Debug Mode Disabled",
            description: newValue
              ? "Telemetry displays are now visible"
              : "Telemetry displays are now hidden",
          });
        } catch (err) {
          console.error("Failed to toggle debug mode:", err);
        }
      }

      // F5: Compile only
      if (e.key === "F5") {
        e.preventDefault();
        if (!compileMutationIsPending) {
          handleCompile();
        }
      }

      // Escape: Stop simulation
      if (e.key === "Escape" && simulationStatus === "running") {
        e.preventDefault();
        handleStop();
      }

      // Meta/Ctrl + U: Compile & Start
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        if (!compileMutationIsPending && !startMutationIsPending) {
          handleCompileAndStart();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isMac,
    compileMutationIsPending,
    startMutationIsPending,
    simulationStatus,
    handleCompile,
    handleStop,
    handleCompileAndStart,
    toast,
    setDebugMode,
  ]);

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
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const typedMode = mode as "INPUT" | "OUTPUT" | "INPUT_PULLUP";
        const exists = newStates.find((p) => p.pin === pin);
        if (exists) {
          exists.mode = typedMode;
          if (pin >= 14 && pin <= 19) exists.type = "digital";
        } else {
          newStates.push({
            pin,
            mode: typedMode,
            value: 0,
            type: "digital",
          });
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
      const lastLine = serialOutput.at(-1);
      if (lastLine && !lastLine.complete) {
        setSerialOutput((prev) => {
          if (prev.length === 0) return prev;
          return [
            ...prev.slice(0, -1),
            { ...prev.at(-1)!, complete: true },
          ];
        });
      }
    }
  }, [simulationStatus, serialOutput, setSerialOutput]);

  // Static IO-Registry: update from code whenever the code changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setIoRegistry(parseStaticIORegistry(code));
    }, 300);
    return () => clearTimeout(timer);
  }, [code, compilationStatus, setIoRegistry]);
}
