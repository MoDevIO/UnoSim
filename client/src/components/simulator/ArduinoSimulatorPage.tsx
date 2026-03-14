//arduino-simulator.tsx

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

// Lazy load CodeEditor to defer monaco-editor (~500KB) until needed
const CodeEditor = lazy(() =>
  import("@/components/features/code-editor").then((m) => ({
    default: m.CodeEditor,
  })),
);
import { SerialMonitor } from "@/components/features/serial-monitor";
import { SerialMonitorView } from "@/components/simulator/SerialMonitorView";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { SketchTabs } from "@/components/features/sketch-tabs";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { SimulationControls } from "@/components/simulator/SimulationControls";
import { PinMonitorView } from "@/components/simulator/PinMonitorView";
import { SimCockpit } from "@/components/features/sim-cockpit";
import SimulatorSidebar from "@/components/features/simulator/SimulatorSidebar";
import { OutputPanel } from "@/components/features/output-panel";
import { MobileLayout } from "@/components/features/mobile-layout";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebSocketHandler } from "@/hooks/useWebSocketHandler";
import { useCompilation } from "@/hooks/use-compilation";
import { useSimulation } from "@/hooks/use-simulation";
import { usePinState } from "@/hooks/use-pin-state";
import { useToast } from "@/hooks/use-toast";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useDebugConsole } from "@/hooks/use-debug-console";
import { useDebugMode } from "@/hooks/use-debug-mode-store";
import { useSketchTabs } from "@/hooks/use-sketch-tabs";
import { useSerialIO } from "@/hooks/use-serial-io";
import { useOutputPanel } from "@/hooks/use-output-panel";
import { useSimulationStore } from "@/hooks/use-simulation-store";
import { useSketchAnalysis } from "@/hooks/use-sketch-analysis";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { useFileManager } from "@/hooks/use-file-manager";
import { useEditorCommands } from "@/hooks/use-editor-commands";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

import type {
  Sketch,
  ParserMessage,
  IOPinRecord,
} from "@shared/schema";
import { parseStaticIORegistry } from "@shared/io-registry-parser";
import type { DebugMessageParams } from "@/hooks/use-compile-and-run";
import { isMac } from "@/lib/platform";


// Loading placeholder for lazy components
const LoadingPlaceholder = () => (
  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
    <span className="text-ui-sm">Loading chart...</span>
  </div>
);

// Logger import
import { Logger } from "@shared/logger";
const logger = new Logger("ArduinoSimulator");

export default function ArduinoSimulator() {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState("");
  const editorRef = useRef<{ getValue: () => string } | null>(null);

  // Sketch tabs management
  const { tabs, setTabs, activeTabId, setActiveTabId } = useSketchTabs();

  // CHANGED: Store OutputLine objects instead of plain strings
  const {
    serialOutput,
    setSerialOutput,
    serialViewMode,
    autoScrollEnabled,
    setAutoScrollEnabled,
    serialInputValue,
    setSerialInputValue,
    showSerialMonitor,
    showSerialPlotter,
    cycleSerialViewMode,
    clearSerialOutput,
    // Baudrate rendering (Phase 3-4)
    renderedSerialOutput, // Use this for SerialMonitor (baudrate-simulated)
    appendSerialOutput,
    setBaudrate: setSerialBaudrate,
    pauseRendering,
    resumeRendering,
    stopRendering,
    appendRenderedText,
  } = useSerialIO();
  const [parserMessages, setParserMessages] = useState<ParserMessage[]>([]);
  const parserMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  // Track if user manually dismissed the parser panel (reset on new compile with messages)
  const [parserPanelDismissed, setParserPanelDismissed] = useState(false);

  // Initialize I/O Registry with all 20 Arduino pins (will be populated at runtime)
  const [ioRegistry, setIoRegistry] = useState<IOPinRecord[]>(() => {
    const pins: IOPinRecord[] = [];
    // Digital pins 0-13
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    // Analog pins A0-A5
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    return pins;
  });

  const [activeOutputTab, setActiveOutputTab] = useState<
    "compiler" | "messages" | "registry" | "debug"
  >("compiler");
  const [showCompilationOutput, setShowCompilationOutput] = useState<boolean>(
    () => {
      try {
        const stored = window.localStorage.getItem("unoShowCompileOutput");
        return stored === null ? true : stored === "1";
      } catch {
        return true;
      }
    },
  );
  const [isModified, setIsModified] = useState(false);

  const {
    pinStates,
    setPinStates,
    resetPinStates,
    enqueuePinEvent,
    batchStats,
  } = useSimulationStore();

  // Pin state management via hook
  const {
    analogPinsUsed,
    setAnalogPinsUsed,
    detectedPinModes,
    setDetectedPinModes,
    pendingPinConflicts,
    setPendingPinConflicts,
    pinMonitorVisible,
    resetPinUI,
    pinToNumber,
  } = usePinState({ resetPinStates });

  // Serial view mode state handled by useSerialIO

  // Selected board and baud rate (moved to Tools menu)
  const [board, _setBoard] = useState<string>("Arduino UNO");
  const [baudRate, setBaudRate] = useState<number>(115200);

  // Serial input box state handled by useSerialIO

  // File manager hook — instantiated after `handleFilesLoaded` to avoid TDZ (see below)

  // Debug console state and functions
  const {
    debugMode,
    setDebugMode: _setDebugMode,
    debugMessages,
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  } = useDebugConsole(activeOutputTab);
  void _setDebugMode; // Mark as intentionally unused (managed by hook)

  // Subscribe to telemetry updates (to re-render when metrics change)
  const telemetryData = useTelemetryStore();

  // Helper to request the global Settings dialog to open (App listens for this event)
  const openSettings = () => {
    try {
      window.dispatchEvent(new CustomEvent("open-settings"));
    } catch {}
  };

  const handleSerialInputSend = () => {
    if (!serialInputValue.trim()) return;
    handleSerialSend(serialInputValue);
    setSerialInputValue("");
  };

  const handleSerialInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSerialInputSend();
  };

  // RX/TX LED activity counters (increment on activity for change detection)
  const [txActivity, setTxActivity] = useState(0);
  const [rxActivity, setRxActivity] = useState(0);
  // Queue for incoming serial_events - use ref to avoid React batching issues
  const serialEventQueueRef = useRef<
    Array<{ payload: any; receivedAt: number }>
  >([]);
  // Mobile layout (responsive design and panel management)
  const { isMobile, mobilePanel, setMobilePanel, headerHeight, overlayZ } = useMobileLayout();



  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setDebugMode } = useDebugMode();
  
  // Keyboard shortcut to toggle debug mode (⌘+D on Mac, Ctrl+D on Windows/Linux)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for ⌘+D (Mac) or Ctrl+D (Windows/Linux)
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;
      if (isModifierPressed && !e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        
        // Toggle debug mode using global store and localStorage
        const currentValue = window.localStorage.getItem("unoDebugMode") === "1";
        const newValue = !currentValue;
        
        try {
          // Update localStorage and global store
          window.localStorage.setItem("unoDebugMode", newValue ? "1" : "0");
          setDebugMode(newValue);
          
          // Dispatch custom event so ArduinoBoard and other components update
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
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toast, setDebugMode]);
  
  const {
    isConnected,
    lastMessage,
    sendMessage: sendMessageRaw,
    sendMessageImmediate,
  } = useWebSocket();
  // Mark some hook values as intentionally read to avoid TS unused-local errors
  void lastMessage;

  // Wrapper for sendMessage that sends raw to backend
  const sendMessage = useCallback((message: any) => {
    sendMessageRaw(message);
  }, [sendMessageRaw]);

  // Backend health check and recovery
  const {
    backendReachable,
    showErrorGlitch,
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
  } = useBackendHealth(queryClient);

  // placeholder for compilation-start callback
  const startSimulationRef = useRef<(() => void) | null>(null);




  const {
    compilationStatus,
    setCompilationStatus,
    arduinoCliStatus,
    setArduinoCliStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
    compilerErrors,
    lastCompilationResult,
    setLastCompilationResult,
    cliOutput,
    setCliOutput,
    compileMutation,
    handleCompile,
    handleCompileAndStart,
    handleClearCompilationOutput,
    clearOutputs,
  } = useCompilation({
    editorRef,
    tabs,
    activeTabId,
    code,
    setSerialOutput,
    clearSerialOutput,
    setParserMessages,
    setParserPanelDismissed,
    resetPinUI,
    setIoRegistry,
    setIsModified,
    setDebugMessages,
    addDebugMessage: (params: DebugMessageParams) =>
      addDebugMessage(
        params.source,
        params.type,
        params.data,
        params.protocol,
      ),
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
    toast,
    sendMessage,
    sendMessageImmediate,
  });

  // now that compilation helpers exist we can initialise the full simulation
  // hook. pass the earlier ref so the placeholder callback will be wired up.
  const {
    simulationStatus,
    setSimulationStatus,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    handleStop,
    handlePause,
    handleResume,
    handleReset,
    suppressAutoStopOnce,
  } = useSimulation({
    ensureBackendConnected,
    sendMessage,
    sendMessageImmediate,
    resetPinUI,
    clearOutputs,
    addDebugMessage: (params: DebugMessageParams) =>
      addDebugMessage(
        params.source,
        params.type,
        params.data,
        params.protocol,
      ),
    serialEventQueueRef,
    toast,
    pendingPinConflicts,
    setPendingPinConflicts,
    setCliOutput,
    isModified,
    handleCompileAndStart,
    code,
    hasCompilationErrors,
    startSimulationRef,
  });




  // Output panel sizing and management
  const {
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
  } = useOutputPanel(
    hasCompilationErrors,
    cliOutput,
    parserMessages,
    lastCompilationResult,
    parserMessagesContainerRef,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    code,
  );

  // Auto-switch output tab based on errors and messages
  useEffect(() => {
    if (hasCompilationErrors) {
      setActiveOutputTab("compiler");
    } else if (parserMessages.length > 0 && !parserPanelDismissed) {
      setActiveOutputTab("messages");
    }
  }, [hasCompilationErrors, parserMessages.length, parserPanelDismissed]);

  // Auto-scroll debug console to latest message
  useEffect(() => {
    if (activeOutputTab === "debug" && debugMessagesContainerRef.current) {
      requestAnimationFrame(() => {
        debugMessagesContainerRef.current?.scrollTo(0, debugMessagesContainerRef.current.scrollHeight);
      });
    }
  }, [debugMessages, activeOutputTab]);

  // Fetch default sketch
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ["/api/sketches"],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: backendReachable, // Only query if backend is reachable
  });

  // Upload mutation (used by Compile → Upload)
  // Ref to skip stopping simulation when a suggestion is inserted
  // suppression flag moved into `useSimulationLifecycle` — no longer needed here

  useEffect(() => {
    // Reset status when code actually changes
    // Reset both labels to idle when code changes
    if (arduinoCliStatus !== "idle") setArduinoCliStatus("idle");
    if (compilationStatus !== "ready") setCompilationStatus("ready");

    // Note: Simulation stopping on code change is now handled in handleCodeChange
  }, [code]);

  useEffect(() => {
    if (serialOutput.length === 0) {
      // Serial output is empty
    }
  }, [serialOutput]);

  // Load default sketch on mount
  useEffect(() => {
    if (sketches && sketches.length > 0 && !currentSketch) {
      const defaultSketch = sketches[0];
      setCurrentSketch(defaultSketch);
      setCode(defaultSketch.content);

      // Initialize tabs with the default sketch
      const defaultTabId = "default-sketch";
      setTabs([
        {
          id: defaultTabId,
          name: "sketch.ino",
          content: defaultSketch.content,
        },
      ]);
      setActiveTabId(defaultTabId);
    }
  }, [sketches]);

  // Persist code changes to the active tab
  useEffect(() => {
    if (activeTabId && tabs.length > 0) {
      setTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content: code } : tab,
        ),
      );
    }
  }, [code, activeTabId]);

  // NEW: Keyboard shortcuts (only for non-editor actions)
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

      // F5: Compile only (Verify)
      if (e.key === "F5") {
        e.preventDefault();
        if (!compileMutation.isPending) {
          handleCompile();
        }
      }

      // Escape: Stop simulation
      if (e.key === "Escape" && simulationStatus === "running") {
        e.preventDefault();
        handleStop();
      }

      // Meta/Ctrl + U: Compile & Start (same as Start Simulation)
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        if (!compileMutation.isPending && !startMutation.isPending) {
          handleCompileAndStart();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    compileMutation.isPending,
    startMutation.isPending,
    simulationStatus,
    isMac,
  ]);

  // editor commands moved to hook
  const {
    undo,
    redo,
    find,
    selectAll,
    copy,
    cut,
    paste,
    goToLine,
    formatCode,
  } = useEditorCommands(editorRef, {
    toast,
    suppressAutoStopOnce,
    code,
    setCode,
  });

  // WebSocket message handling moved to `useWebSocketHandler` (extracted for better separation of concerns)
  useWebSocketHandler({
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
  });

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsModified(true);

    // Update the active tab content
    if (activeTabId) {
      setTabs(
        tabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content: newCode } : tab,
        ),
      );
    }
  };

  // Parse the current code to detect which analog pins are used by name or channel
  // (extracted to `useSketchAnalysis` for testability and reuse)
  const _sketchCode = code || (tabs.length > 0 ? tabs[0].content || "" : "");
  const {
    analogPins: _analogPins,
    varMap: _varMap,
    detectedPinModes: _detectedPinModes,
    pendingPinConflicts: _pendingPinConflicts,
  } = useSketchAnalysis(_sketchCode);

  // Mirror results into local state (previously done inside the big useEffect)
  useEffect(() => {
    setDetectedPinModes(_detectedPinModes);
    setPendingPinConflicts(_pendingPinConflicts);
    setAnalogPinsUsed(_analogPins);
  }, [
    _detectedPinModes,
    _pendingPinConflicts,
    _analogPins,
    setDetectedPinModes,
    setPendingPinConflicts,
    setAnalogPinsUsed,
  ]);

  // When the simulation starts, apply recorded pinMode declarations and
  // populate any detected analog pins so they become clickable and show
  // their frames only while the simulation is running.
  useEffect(() => {
    if (simulationStatus !== "running") return;

    setPinStates((prev) => {
      const newStates = [...prev];

      // Apply recorded pinMode(...) declarations (including analog-numbered pins)
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({
            pin,
            mode: mode as any,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        } else {
          exists.mode = mode as any;
          if (pin >= 14 && pin <= 19) exists.type = "digital";
        }
      }

      // Ensure detected analog pins are present (as analog) if not already
      for (const pin of analogPinsUsed) {
        if (pin < 14 || pin > 19) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({ pin, mode: "INPUT", value: 0, type: "analog" });
        }
      }

      return newStates;
    });
  }, [simulationStatus, analogPinsUsed, detectedPinModes]);

  // Apply detectedPinModes after io_registry has been processed.
  // This ensures that client-side parsed modes override server modes.
  useEffect(() => {
    if (Object.keys(detectedPinModes).length === 0) {
      return;
    }

    setPinStates((prev) => {
      const newStates = [...prev];
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const pinState = newStates.find((p) => p.pin === pin);
        if (pinState) {
          pinState.mode = mode as any;
        } else {
          // CREATE pin if it doesn't exist yet (io_registry might not have detected it)
          newStates.push({
            pin,
            mode: mode as any,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        }
      }
      return newStates;
    });
  }, [detectedPinModes, simulationStatus]);

  // When simulation stops, flush any pending incomplete lines to make them visible
  useEffect(() => {
    if (simulationStatus === "stopped" && serialOutput.length > 0) {
      const lastLine = serialOutput[serialOutput.length - 1];
      if (lastLine && !lastLine.complete) {
        // Mark last incomplete line as complete so it displays
        setSerialOutput((prev) => {
          if (prev.length === 0) return prev;
          return [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1], complete: true },
          ];
        });
      }
    }
  }, [simulationStatus]);

  // ── Static IO-Registry: update from code whenever simulation is not running ─
  // Runs 300 ms after the user stops typing to avoid parsing every keystroke.
  // When the simulation starts, the WS `io_registry` messages take over.
  useEffect(() => {
    if (simulationStatus !== "stopped") return;
    const timer = setTimeout(() => {
      setIoRegistry(parseStaticIORegistry(code));
    }, 300);
    return () => clearTimeout(timer);
  }, [code, simulationStatus]);

  // Tab management handlers
  const handleTabClick = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      setActiveTabId(tabId);
      setCode(tab.content);
      setIsModified(false);

      // Note: Simulation continues running when switching tabs
      // Clear previous outputs only if needed, but keep simulation running
    }
  };

  const handleTabAdd = () => {
    const newTabId = Math.random().toString(36).substr(2, 9);
    const newTab = {
      id: newTabId,
      name: `header_${tabs.length}.h`,
      content: "",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
    setCode("");
    setIsModified(false);
  };

  const handleFilesLoaded = (
    files: Array<{ name: string; content: string }>,
    replaceAll: boolean,
  ) => {
    if (replaceAll) {
      // Stop simulation if running
      if (simulationStatus === "running") {
        sendMessage({ type: "stop_simulation" });
      }

      // Replace all tabs with new files
      const inoFiles = files.filter((f) => f.name.endsWith(".ino"));
      const hFiles = files.filter((f) => f.name.endsWith(".h"));

      // Put .ino file first, then all .h files
      const orderedFiles = [...inoFiles, ...hFiles];

      const newTabs = orderedFiles.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));

      setTabs(newTabs);

      // Set the main .ino file as active
      const inoTab = newTabs[0]; // Should be at index 0 now
      if (inoTab) {
        setActiveTabId(inoTab.id);
        setCode(inoTab.content);
        setIsModified(false);
      }

      // Clear previous outputs and stop simulation
      clearOutputs();
      // Reset UI pin state and detected pin-mode info
      resetPinUI();
      setCompilationStatus("ready");
      setArduinoCliStatus("idle");
      setLastCompilationResult(null);
      setSimulationStatus("stopped");
      setHasCompiledOnce(false);
    } else {
      // Add only .h files to existing tabs
      const newHeaderFiles = files.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));

      setTabs([...tabs, ...newHeaderFiles]);
    }
  };

  // Instantiate file manager once `handleFilesLoaded` is defined (avoids TDZ)
  const toastAdapter = (p: { title: string; description?: string; variant?: string }) =>
    toast({ title: p.title, description: p.description, variant: p.variant === "destructive" ? "destructive" : undefined });

  const { fileInputRef, onLoadFiles, downloadAllFiles, handleHiddenFileInput } = useFileManager({
    tabs,
    onFilesLoaded: handleFilesLoaded,
    toast: toastAdapter,
  });

  const handleLoadExample = (filename: string, content: string) => {
    // Stop simulation if running
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
    }

    // Create a new sketch from the example, using the filename as the tab name
    const newTab = {
      id: Math.random().toString(36).substr(2, 9),
      name: filename,
      content: content,
    };

    setTabs([newTab]);
    setActiveTabId(newTab.id);
    setCode(content);
    setIsModified(false);
    // Reset output panel sizing and tabs when loading a fresh example
    setCompilationPanelSize(3);
    setActiveOutputTab("compiler");

    // Clear previous outputs and messages
    clearOutputs();
    setIoRegistry(() => {
      const pins: IOPinRecord[] = [];
      for (let i = 0; i <= 13; i++) pins.push({ pin: String(i), defined: false, usedAt: [] });
      for (let i = 0; i <= 5; i++) pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
      return pins;
    });
    setCompilationStatus("ready");
    setArduinoCliStatus("idle");
    setLastCompilationResult(null);
    setSimulationStatus("stopped");
    setHasCompiledOnce(false);
    setActiveOutputTab("compiler"); // Always reset to compiler tab
    setCompilationPanelSize(5); // Minimize output panel size
    setParserPanelDismissed(false); // Ensure panel is not dismissed
  };

  const handleTabClose = (tabId: string) => {
    // Prevent closing the first tab (the .ino file)
    if (tabId === tabs[0]?.id) {
      toast({
        title: "Cannot Delete",
        description: "The main sketch file cannot be deleted",
        variant: "destructive",
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      // Switch to the previous or next tab
      if (newTabs.length > 0) {
        const newActiveTab = newTabs[newTabs.length - 1];
        setActiveTabId(newActiveTab.id);
        setCode(newActiveTab.content);
      } else {
        setActiveTabId(null);
        setCode("");
      }
    }
  };

  const handleTabRename = (tabId: string, newName: string) => {
    setTabs(
      tabs.map((tab) => (tab.id === tabId ? { ...tab, name: newName } : tab)),
    );
  };

  /* OutputPanel callbacks (stabilized with useCallback per Anti‑Flicker rules) */
  const handleOutputTabChange = useCallback((v: "compiler" | "messages" | "registry" | "debug") => {
    setActiveOutputTab(v);
  }, [setActiveOutputTab]);

  const handleOutputCloseOrMinimize = useCallback(() => {
    const currentSize = outputPanelRef.current?.getSize?.() ?? 0;
    const isMinimized = currentSize <= outputPanelMinPercent + 1;

    if (isMinimized) {
      setShowCompilationOutput(false);
      setParserPanelDismissed(true);
      outputPanelManuallyResizedRef.current = false;
    } else {
      setCompilationPanelSize(3);
      outputPanelManuallyResizedRef.current = false;
      if (outputPanelRef.current?.resize) {
        outputPanelRef.current.resize(outputPanelMinPercent);
      }
    }
  }, [outputPanelMinPercent, setShowCompilationOutput, setParserPanelDismissed, setCompilationPanelSize]);

  const handleParserMessagesClear = useCallback(() => setParserPanelDismissed(true), [setParserPanelDismissed]);
  const handleParserGoToLine = useCallback((line: number) => {
    logger.debug(`Go to line: ${line}`);
  }, []);

  const handleInsertSuggestion = useCallback((suggestion: string, line?: number) => {
    if (
      editorRef.current &&
      typeof (editorRef.current as any).insertSuggestionSmartly === "function"
    ) {
      suppressAutoStopOnce();
      (editorRef.current as any).insertSuggestionSmartly(suggestion, line);
      toast({
        title: "Suggestion inserted",
        description: "Code added to the appropriate location",
      });
    } else {
      console.error("insertSuggestionSmartly method not available on editor");
    }
  }, [suppressAutoStopOnce, toast]);

  const handleRegistryClear = useCallback(() => {}, []);

  const handleSetDebugMessageFilter = useCallback((v: string) => setDebugMessageFilter(v.toLowerCase()), [setDebugMessageFilter]);
  const handleSetDebugViewMode = useCallback((m: "table" | "tiles") => setDebugViewMode(m), [setDebugViewMode]);
  const handleCopyDebugMessages = useCallback(() => {
    const messages = debugMessages
      .filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter)
      .map((m) => `[${m.timestamp.toLocaleTimeString()}] ${m.sender.toUpperCase()} (${m.type}): ${m.content}`)
      .join('\n');
    if (messages) {
      navigator.clipboard.writeText(messages);
      toast({
        title: "Copied to clipboard",
        description: `${debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length} messages`,
      });
    }
  }, [debugMessages, debugMessageFilter, toast]);

  const handleClearDebugMessages = useCallback(() => setDebugMessages([]), [setDebugMessages]);

  // Toggle INPUT pin value (called when user clicks on an INPUT pin square)
  const handlePinToggle = (pin: number, newValue: number) => {
    if (simulationStatus === "stopped") {
      toast({
        title: "Simulation not active",
        description: "Start the simulation to change pin values.",
        variant: "destructive",
      });
      return;
    }

    if (simulationStatus === "paused") {
      // Pin changes are allowed during pause - send and update
    }

    // Send the new pin value to the server
    sendMessage({ type: "set_pin_value", pin, value: newValue });

    // Update local pin state immediately for responsive UI
    setPinStates((prev) => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex((p) => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
        };
      }
      return newStates;
    });
  };

  // Handle analog slider changes (0..1023)
  const handleAnalogChange = (pin: number, newValue: number) => {
    if (simulationStatus === "stopped") {
      toast({
        title: "Simulation not active",
        description: "Start the simulation to change pin values.",
        variant: "destructive",
      });
      return;
    }

    if (simulationStatus === "paused") {
      // Pin changes are allowed during pause - send and update
    }

    sendMessage({ type: "set_pin_value", pin, value: newValue });

    // Update local pin state immediately for responsive UI
    setPinStates((prev) => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex((p) => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
          type: "analog",
        };
      } else {
        newStates.push({ pin, mode: "INPUT", value: newValue, type: "analog" });
      }
      return newStates;
    });
  };

  const handleSerialSend = (message: string) => {
    if (!ensureBackendConnected("Serial senden")) return;

    if (simulationStatus !== "running") {
      toast({
        title:
          simulationStatus === "paused"
            ? "Simulation paused"
            : "Simulation not running",
        description:
          simulationStatus === "paused"
            ? "Resume the simulation to send serial input."
            : "Start the simulation to send serial input.",
        variant: "destructive",
      });
      return;
    }

    // Trigger TX LED blink when client sends data
    setTxActivity((prev) => prev + 1);

    sendMessage({
      type: "serial_input",
      data: message,
    });
  };

  const handleClearSerialOutput = useCallback(() => {
    clearSerialOutput();
  }, [clearSerialOutput]);

  const getStatusInfo = () => {
    switch (compilationStatus) {
      case "compiling":
        return { text: "Compiling...", className: "status-compiling" };
      case "success":
        return {
          text: isModified
            ? "Code Changed"
            : "Compilation with Arduino-CLI complete",
          className: isModified ? "status-modified" : "status-success",
        };
      case "error":
        return { text: "Compilation Error", className: "status-error" };
      default:
        return { text: "Ready", className: "status-ready" };
    }
  };

  function getStatusClass(
    status:
      | "idle"
      | "compiling"
      | "success"
      | "error"
      | "ready"
      | "running"
      | "stopped",
  ): string {
    switch (status) {
      case "compiling":
        return "text-yellow-500";
      case "success":
        return "text-green-500";
      case "error":
        return "text-red-500";
      case "idle":
        return "text-gray-500 italic";
      case "ready":
        return "text-gray-700";
      case "running":
        return "text-green-600";
      case "stopped":
        return "text-gray-600";
      default:
        return "";
    }
  }

  // Replace 'Compilation Successful' with 'Successful' in status label
  const statusInfo = getStatusInfo();
  void getStatusClass;
  void statusInfo;
  const simControlBusy =
    compileMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const simulateDisabled =
    ((simulationStatus === "stopped" || simulationStatus === "paused") &&
      (!backendReachable || !isConnected)) ||
    simControlBusy;

  const stopDisabled =
    (simulationStatus !== "running" && simulationStatus !== "paused") ||
    stopMutation.isPending;

  const buttonsClassName =
    "hover:bg-green-600 hover:text-white transition-colors";
  void stopDisabled;
  void buttonsClassName;

  // mobile layout slots (memoized for performance)
  const codeSlot = React.useMemo(
    () => (
      <>
        <SketchTabs
          tabs={tabs}
          activeTabId={activeTabId}
          modifiedTabId={null}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabRename={handleTabRename}
          onTabAdd={handleTabAdd}
          onFilesLoaded={handleFilesLoaded}
          onFormatCode={formatCode}
          examplesMenu={
            <ExamplesMenu
              onLoadExample={handleLoadExample}
              backendReachable={backendReachable}
            />
          }
        />
        <div className="flex-1 min-h-0 w-full">
          <Suspense fallback={<LoadingPlaceholder />}>
            <CodeEditor
              value={code}
              onChange={handleCodeChange}
              onCompileAndRun={handleCompileAndStart}
              onFormat={formatCode}
              editorRef={editorRef}
            />
          </Suspense>
        </div>
      </>
    ),
    [
      tabs,
      activeTabId,
      handleTabClick,
      handleTabClose,
      handleTabRename,
      handleTabAdd,
      handleFilesLoaded,
      formatCode,
      handleLoadExample,
      backendReachable,
      code,
      handleCodeChange,
      handleCompileAndStart,
      editorRef,
    ],
  );

  const compileSlot = React.useMemo(
    () => (
      <>
        {!parserPanelDismissed && parserMessages.length > 0 && (
          <div className="flex-1 min-h-0 border-b border-gray-200">
            <ParserOutput
              messages={parserMessages}
              ioRegistry={ioRegistry}
              onClear={() => setParserPanelDismissed(true)}
              onGoToLine={(line) => {
                logger.debug(`Go to line: ${line}`);
              }}
              onInsertSuggestion={handleInsertSuggestion}
              hideHeader={true}
            />
          </div>
        )}
        <div className="flex-1 min-h-0 w-full">
          <CompilationOutput
            output={cliOutput}
            errors={compilerErrors}
            isSuccess={!hasCompilationErrors && compilationStatus === "success"}
            onClear={handleClearCompilationOutput}
          />
        </div>
      </>
    ),
    [
      parserPanelDismissed,
      parserMessages,
      ioRegistry,
      cliOutput,
      handleClearCompilationOutput,
    ],
  );

  const serialSlot = React.useMemo(
    () => (
      <>
        <div className="flex-1 min-h-0">
          <SerialMonitor
            output={renderedSerialOutput}
            isConnected={isConnected}
            isSimulationRunning={simulationStatus !== "stopped"}
            onSendMessage={handleSerialSend}
            onClear={handleClearSerialOutput}
            showMonitor={showSerialMonitor}
            autoScrollEnabled={autoScrollEnabled}
          />
        </div>
      </>
    ),
    [
      renderedSerialOutput,
      isConnected,
      simulationStatus,
      handleSerialSend,
      handleClearSerialOutput,
      showSerialMonitor,
      autoScrollEnabled,
    ],
  );

  const boardSlot = React.useMemo(
    () => (
      <PinMonitorView
        pinMonitorVisible={pinMonitorVisible}
        pinStates={pinStates}
        batchStats={batchStats}
        simulationStatus={simulationStatus}
        txActivity={txActivity}
        rxActivity={rxActivity}
        onReset={handleReset}
        onPinToggle={handlePinToggle}
        analogPins={analogPinsUsed}
        onAnalogChange={handleAnalogChange}
        isMobile={isMobile}
      />
    ),
    [
      pinMonitorVisible,
      pinStates,
      batchStats,
      simulationStatus,
      txActivity,
      rxActivity,
      handleReset,
      handlePinToggle,
      analogPinsUsed,
      handleAnalogChange,
      isMobile,
    ],
  );

  return (
    <div
      className={`h-screen flex flex-col bg-background text-foreground relative ${showErrorGlitch ? "overflow-hidden" : ""}`}
    >
      {/* Glitch overlay when compilation fails */}
      {showErrorGlitch && (
        <div className="pointer-events-none absolute inset-0 z-50">
          {/* Single red border flash */}
          <div className="absolute inset-0 flex items-stretch justify-stretch">
            <div className="absolute inset-0">
              <div className="absolute inset-0 border-0 pointer-events-none">
                <div className="absolute inset-0 rounded-none border-4 border-red-500 opacity-0 animate-border-flash" />
              </div>
            </div>
          </div>
          <style>{`
            @keyframes border-flash {
              0% { opacity: 0; transform: scale(1); }
              10% { opacity: 1; }
              60% { opacity: 0.7; }
              100% { opacity: 0; }
            }
            .animate-border-flash { animation: border-flash 0.6s ease-out both; }
          `}</style>
        </div>
      )}
      {/* Blue breathing border when backend is unreachable */}
      {!backendReachable && (
        <div className="pointer-events-none absolute inset-0 z-40">
          <div className="absolute inset-0">
            <div className="absolute inset-0 border-0 pointer-events-none">
              <div className="absolute inset-0 rounded-none border-2 border-blue-400 opacity-80 animate-breathe-blue" />
            </div>
          </div>
          <style>{`
            @keyframes breathe-blue {
              0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
              25% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              50% { box-shadow: 0 0 36px 12px rgba(37,99,235,0.16); opacity: 1; }
              75% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
            }
            .animate-breathe-blue { animation: breathe-blue 6s ease-in-out infinite; }
          `}</style>
        </div>
      )}
      {/* Header/Toolbar */}
      <SimulationControls
        isMobile={isMobile}
        simulationStatus={simulationStatus}
        simulateDisabled={simulateDisabled}
        isCompiling={compileMutation.isPending}
        isStarting={startMutation.isPending}
        isStopping={stopMutation.isPending}
        isPausing={pauseMutation.isPending}
        isResuming={resumeMutation.isPending}
        onSimulate={handleCompileAndStart}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        board={board}
        baudRate={baudRate}
        simulationTimeout={simulationTimeout}
        onTimeoutChange={setSimulationTimeout}
        isMac={isMac}
        onFileAdd={handleTabAdd}
        onFileRename={() => {
          if (!activeTabId) {
            toast({
              title: "No file selected",
              description: "Open a file/tab first to rename.",
            });
            return;
          }
          const current = tabs.find((t) => t.id === activeTabId);
          const newName = window.prompt(
            "Rename file",
            current?.name || "untitled.ino",
          );
          if (newName && newName.trim()) {
            handleTabRename(activeTabId, newName.trim());
          }
        }}
        onFormatCode={formatCode}
        onLoadFiles={onLoadFiles}
        onDownloadAllFiles={downloadAllFiles}
        onSettings={openSettings}
        onUndo={undo}
        onRedo={redo}
        onCut={cut}
        onCopy={copy}
        onPaste={paste}
        onSelectAll={selectAll}
        onGoToLine={goToLine}
        onFind={find}
        onCompile={() => { if (!compileMutation.isPending) handleCompile(); }}
        onCompileAndStart={handleCompileAndStart}
        onOutputPanelToggle={() => { setShowCompilationOutput(!showCompilationOutput); setParserPanelDismissed(false); outputPanelManuallyResizedRef.current = false; }}
        showCompilationOutput={showCompilationOutput}
        rightSlot={debugMode ? <SimCockpit batchStats={batchStats} simulationStatus={simulationStatus} /> : undefined}
      />
      {/* Hidden file input used by File → Load Files */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ino,.h"
        multiple
        onChange={handleHiddenFileInput}
        className="hidden"
      />
      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative z-0">
        {!isMobile ? (
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
            id="main-layout"
          >
            {/* Code Editor Panel */}
            <ResizablePanel defaultSize={50} minSize={20} id="code-panel">
              <ResizablePanelGroup
                direction="vertical"
                className="h-full"
                id="code-layout"
              >
                <ResizablePanel defaultSize={97} minSize={30} id="editor-panel">
                  <div className="h-full flex flex-col">
                    {/* Sketch Tabs */}
                    <SketchTabs
                      tabs={tabs}
                      activeTabId={activeTabId}
                      modifiedTabId={null}
                      onTabClick={handleTabClick}
                      onTabClose={handleTabClose}
                      onTabRename={handleTabRename}
                      onTabAdd={handleTabAdd}
                      onFilesLoaded={handleFilesLoaded}
                      onFormatCode={formatCode}
                      examplesMenu={
                        <ExamplesMenu
                          onLoadExample={handleLoadExample}
                          backendReachable={backendReachable}
                        />
                      }
                    />

                    <div className="flex-1 min-h-0">
                      <Suspense fallback={<LoadingPlaceholder />}>
                        <CodeEditor
                          value={code}
                          onChange={handleCodeChange}
                          onCompileAndRun={handleCompileAndStart}
                          onFormat={formatCode}
                          editorRef={editorRef}
                        />
                      </Suspense>
                    </div>
                  </div>
                </ResizablePanel>

                {/* Combined Output Panel with Tabs: Compiler / Messages / IO-Registry */}
                {(() => {
                  const isSuccessState =
                    lastCompilationResult === "success" &&
                    !hasCompilationErrors;

                  // Show output panel if:
                  // - User has NOT explicitly closed it (showCompilationOutput)
                  // User intent is PRIMARY - user can always close even with errors/messages
                  // Auto-reopen happens via setShowCompilationOutput(true) in useEffect
                  const shouldShowOutput = showCompilationOutput;

                  return (
                    <>
                      {shouldShowOutput && (
                        <ResizableHandle
                          withHandle
                          data-testid="vertical-resizer-output"
                          onDragging={(isDragging) => {
                            // Mark as manually resized as soon as user starts dragging
                            if (isDragging) {
                              outputPanelManuallyResizedRef.current = true;
                            }
                          }}
                        />
                      )}

                      <ResizablePanel
                        ref={outputPanelRef}
                        defaultSize={Math.max(
                          compilationPanelSize,
                          outputPanelMinPercent,
                        )}
                        minSize={outputPanelMinPercent}
                        id="output-under-editor"
                        className={shouldShowOutput ? "" : "hidden"}
                      >
                          <OutputPanel
                            activeOutputTab={activeOutputTab}
                            showCompilationOutput={showCompilationOutput}
                            isSuccessState={isSuccessState}
                            isModified={isModified}
                            compilationPanelSize={compilationPanelSize}
                            outputPanelMinPercent={outputPanelMinPercent}
                            debugMode={debugMode}
                            debugViewMode={debugViewMode}
                            debugMessageFilter={debugMessageFilter}

                            cliOutput={cliOutput}
                            parserMessages={parserMessages}
                            ioRegistry={ioRegistry}
                            debugMessages={debugMessages}
                            lastCompilationResult={lastCompilationResult}
                            hasCompilationErrors={hasCompilationErrors}

                            outputTabsHeaderRef={outputTabsHeaderRef}
                            parserMessagesContainerRef={parserMessagesContainerRef}
                            debugMessagesContainerRef={debugMessagesContainerRef}

                            onTabChange={handleOutputTabChange}
                            openOutputPanel={(tab) => openOutputPanel(tab as any)}
                            onClose={handleOutputCloseOrMinimize}

                            onClearCompilationOutput={handleClearCompilationOutput}
                            onParserMessagesClear={handleParserMessagesClear}
                            onParserGoToLine={handleParserGoToLine}
                            onInsertSuggestion={handleInsertSuggestion}
                            onRegistryClear={handleRegistryClear}

                            setDebugMessageFilter={handleSetDebugMessageFilter}
                            setDebugViewMode={handleSetDebugViewMode}
                            onCopyDebugMessages={handleCopyDebugMessages}
                            onClearDebugMessages={handleClearDebugMessages}
                          />

                      </ResizablePanel>
                    </>
                  );
                })()}
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle withHandle data-testid="horizontal-resizer" />

            {/* Right Panel - Output & Serial Monitor */}
            <ResizablePanel defaultSize={50} minSize={20} id="output-panel">
              <ResizablePanelGroup direction="vertical" id="output-layout">
                <ResizablePanel defaultSize={50} minSize={20} id="serial-panel">
                  <SerialMonitorView
                    renderedSerialOutput={renderedSerialOutput}
                    serialOutput={serialOutput}
                    isConnected={isConnected}
                    simulationStatus={simulationStatus}
                    handleSerialSend={handleSerialSend}
                    handleClearSerialOutput={handleClearSerialOutput}
                    showSerialMonitor={showSerialMonitor}
                    showSerialPlotter={showSerialPlotter}
                    serialViewMode={serialViewMode}
                    cycleSerialViewMode={cycleSerialViewMode}
                    autoScrollEnabled={autoScrollEnabled}
                    setAutoScrollEnabled={setAutoScrollEnabled}
                    serialInputValue={serialInputValue}
                    setSerialInputValue={setSerialInputValue}
                    handleSerialInputKeyDown={handleSerialInputKeyDown}
                    handleSerialInputSend={handleSerialInputSend}
                    debugMode={debugMode}
                    telemetryData={telemetryData}
                    baudRate={baudRate}
                  />
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  data-testid="vertical-resizer-board"
                />

                <ResizablePanel defaultSize={50} minSize={20} id="board-panel">
                  <SimulatorSidebar
                    pinMonitorVisible={pinMonitorVisible}
                    pinStates={pinStates}
                    batchStats={batchStats}
                    simulationStatus={simulationStatus}
                    txActivity={txActivity}
                    rxActivity={rxActivity}
                    onReset={handleReset}
                    onPinToggle={handlePinToggle}
                    analogPins={analogPinsUsed}
                    onAnalogChange={handleAnalogChange}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <MobileLayout
            isMobile={isMobile}
            mobilePanel={mobilePanel}
            setMobilePanel={setMobilePanel}
            headerHeight={headerHeight}
            overlayZ={overlayZ}
            codeSlot={codeSlot}
            compileSlot={compileSlot}
            serialSlot={serialSlot}
            boardSlot={boardSlot}
          />
        )}
      </div>
    </div>
  );
}
