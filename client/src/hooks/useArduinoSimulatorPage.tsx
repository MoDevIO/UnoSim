// arduino-simulator.tsx

import { useState, useEffect, useRef, useCallback } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useWebSocket } from "@/hooks/use-websocket";
import { useCompilation } from "@/hooks/use-compilation";
import { useSimulation } from "@/hooks/use-simulation";
import { useSimulatorActions } from "@/hooks/useSimulatorActions";
import { usePinState } from "@/hooks/use-pin-state";
import { useToast } from "@/hooks/use-toast";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useDebugMode } from "@/hooks/use-debug-mode-store";
import { useSerialIO } from "@/hooks/use-serial-io";
import { useSimulatorSerialPanel } from "@/hooks/useSimulatorSerialPanel";
import { useSimulatorPinControls } from "@/hooks/useSimulatorPinControls";
import { useSimulatorUIState } from "@/hooks/useSimulatorUIState";
import { useSimulatorKeyboardShortcuts } from "@/hooks/useSimulatorKeyboardShortcuts";
import { useSimulatorWebSocketBridge } from "@/hooks/useSimulatorWebSocketBridge";
import { useSimulationStore } from "@/hooks/use-simulation-store";
import { useSketchAnalysis } from "@/hooks/use-sketch-analysis";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { useDebugConsole } from "@/hooks/use-debug-console";
import { useEditorCommands } from "@/hooks/use-editor-commands";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useSimulatorFileSystem } from "@/hooks/useSimulatorFileSystem";
import { useExternalApi, emitServerStatusEvent } from "@/hooks/use-external-api";
import { parseStaticIORegistry } from "@shared/io-registry-parser";

import type {
  Sketch,
  ParserMessage,
  IOPinRecord,
} from "@shared/schema";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { DebugMessageParams } from "@/hooks/use-compile-and-run";
import { isMac } from "@/lib/platform";
import {
  DIGITAL_PIN_COUNT,
  ANALOG_PIN_COUNT,
} from "@/components/simulator/ArduinoSimulatorPage.styles";

export function useArduinoSimulatorPage() {
  const editorRef = useRef<{
    getValue: () => string;
    insertSuggestionSmartly?: (suggestion: string, line?: number) => void;
  } | null>(null);

  // File system orchestration (currentSketch, code, isModified state)
  const {
    code,
    setCode,
    isModified,
    setIsModified,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    initializeDefaultSketch,
  } = useFileSystem({ sketches: undefined });

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
  // Initialize I/O Registry with all 20 Arduino pins (will be populated at runtime)
  const [ioRegistry, setIoRegistry] = useState<IOPinRecord[]>(() => {
    const pins: IOPinRecord[] = [];
    // Digital pins 0-13
    for (let i = 0; i < DIGITAL_PIN_COUNT; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    // Analog pins A0-A5
    for (let i = 0; i < ANALOG_PIN_COUNT; i++) {
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
        const stored = globalThis.localStorage?.getItem("unoShowCompileOutput");
        return stored === null ? true : stored === "1";
      } catch {
        return true;
      }
    },
  );
  const [parserPanelDismissed, setParserPanelDismissed] = useState<boolean>(false);
  const {
    debugMode,
    debugMessages,
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  } = useDebugConsole(activeOutputTab);

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
    setDetectedPinModes,
    pendingPinConflicts,
    setPendingPinConflicts,
    pinMonitorVisible,
    resetPinUI,
    pinToNumber,
  } = usePinState({ resetPinStates });

  // Serial view mode state handled by useSerialIO

  // Selected board and baud rate (moved to Tools menu)
  const [board] = useState<string>("Arduino UNO");
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [sandboxMode, setSandboxMode] = useState<string>("unknown");
  const [workerIndex, setWorkerIndex] = useState<number | undefined>(undefined);
  const [workerTotal, setWorkerTotal] = useState<number | undefined>(undefined);

  // Serial input box state handled by useSerialIO

  // File manager hook — instantiated after `handleFilesLoaded` to avoid TDZ (see below)

  // Subscribe to telemetry updates (to re-render when metrics change)
  const telemetryData = useTelemetryStore();

  // Helper to request the global Settings dialog to open (App listens for this event)
  const openSettings = () => {
    try {
      globalThis.dispatchEvent(new CustomEvent("open-settings"));
    } catch {}
  };


  // RX/TX LED activity counters (increment on activity for change detection)
  const [txActivity, setTxActivity] = useState(0);
  const [rxActivity, setRxActivity] = useState(0);
  // Queue for incoming serial_events - use ref to avoid React batching issues
  const serialEventQueueRef = useRef<
    Array<{ payload: IncomingArduinoMessage; receivedAt: number }>
  >([]);
  // Mobile layout (responsive design and panel management)
  const { isMobile, mobilePanel, setMobilePanel, headerHeight, overlayZ } = useMobileLayout();



  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setDebugMode } = useDebugMode();
  
  
  const {
    isConnected,
    connectionState: wsConnectionState,
    hasEverConnected: wsHasEverConnected,
    lastMessage: _lastMessage,
    sendMessage: sendMessageRaw,
    sendMessageImmediate,
  } = useWebSocket();

  // Wrapper for sendMessage that sends raw to backend
  const sendMessage = useCallback((message: IncomingArduinoMessage) => {
    sendMessageRaw(message);
  }, [sendMessageRaw]);

  // Backend health check and recovery
  const {
    backendReachable,
    showErrorGlitch,
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
    serverStatus,
  } = useBackendHealth(queryClient);

  // placeholder for compilation-start callback
  const startSimulationRef = useRef<(() => void) | null>(null);



  const {
    compilationStatus,
    setCompilationStatus,
    setArduinoCliStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
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
    startSimulationRef,
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
    handleStop: simHandleStop,
    handlePause: simHandlePause,
    handleResume: simHandleResume,
    handleReset: simHandleReset,
    suppressAutoStopOnce,
    handleStart: simHandleStart,
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

  // Centralize simulator actions (start, stop, pause, resume, reset, compile & start)
  // This extracts control logic into a reusable hook for better testability and modularity
  const {
    handleStart: _handleStart, // reserved for future use
    handleStop,
    handlePause,
    handleResume,
    handleReset,
    handleCompileAndStart: actionsCompileAndStart,
  } = useSimulatorActions({
    onStart: simHandleStart,
    onStop: simHandleStop,
    onPause: simHandlePause,
    onResume: simHandleResume,
    onReset: simHandleReset,
    onCompileAndStart: handleCompileAndStart,
  });

  // Use the memoized compile-and-start from actions for consistent behavior
  const compileAndStartAction = actionsCompileAndStart;



  // Use centralized output panel hook for all output-related state and callbacks

  const onReplaceAllFiles = useCallback(() => {
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
    }

    clearOutputs();
    resetPinUI();
    setCompilationStatus("ready");
    setArduinoCliStatus("idle");
    setLastCompilationResult(null);
    setSimulationStatus("idle");
    setHasCompiledOnce(false);
  }, [
    simulationStatus,
    sendMessage,
    clearOutputs,
    resetPinUI,
    setCompilationStatus,
    setArduinoCliStatus,
    setLastCompilationResult,
    setSimulationStatus,
    setHasCompiledOnce,
  ]);

  const onLoadExample = useCallback(() => {
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
    }

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
    setSimulationStatus("idle");
    setHasCompiledOnce(false);
  }, [
    simulationStatus,
    sendMessage,
    clearOutputs,
    resetPinUI,
    setIoRegistry,
    setCompilationStatus,
    setArduinoCliStatus,
    setLastCompilationResult,
    setSimulationStatus,
    setHasCompiledOnce,
  ]);

  const {
    fileInputRef,
    onLoadFiles,
    downloadAllFiles,
    handleHiddenFileInput,
    handleTabClick,
    handleTabAdd,
    handleTabClose,
    handleTabRename,
    handleFilesLoaded,
    handleLoadExample,
  } = useSimulatorFileSystem({
    code,
    setCode,
    isModified,
    setIsModified,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    initializeDefaultSketch,
    toast,
    onReplaceAllFiles,
    onLoadExample,
  });

  // Fetch default sketch (must come before effects which use it)
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ["/api/sketches"],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: backendReachable, // Only query if backend is reachable
  });

  // Initialize default sketch when sketch list becomes available
  useEffect(() => {
    initializeDefaultSketch(sketches);
  }, [initializeDefaultSketch, sketches]);


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

  // Keyboard shortcuts (F5 / Escape / ⌘+U / Debug toggle / Format / New file)
  useSimulatorKeyboardShortcuts({
    isMac,
    simulationStatus,
    compilePending: compileMutation.isPending,
    startPending: startMutation.isPending,
    handleCompile,
    handleCompileAndStart,
    handleStop,
    handleFormatCode: formatCode,
    handleNewFile: handleTabAdd,
    setDebugMode,
    toast,
  });

  // WebSocket message handling moved to `useSimulatorWebSocketBridge` (extracts the large parameter list from the main hook)
  useSimulatorWebSocketBridge({
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
  });

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

  // Populate I/O registry from static code analysis whenever code changes or compilation completes
  useEffect(() => {
    const timer = setTimeout(() => {
      setIoRegistry(parseStaticIORegistry(code));
    }, 300);
    return () => clearTimeout(timer);
  }, [code, compilationStatus, setIoRegistry]);

  const { handleSerialSend, handleSerialInputKeyDown, handleClearSerialOutput } =
    useSimulatorSerialPanel({
      sendMessage,
      simulationStatus,
      toast,
      setTxActivity,
      serialInputValue,
      setSerialInputValue,
      clearSerialOutput,
      ensureBackendConnected,
    });

  const handleSerialInputSend = () => {
    if (!serialInputValue.trim()) return;
    handleSerialSend(serialInputValue);
  };

  // Remaining handlers for OutputPanel integration
  const handleInsertSuggestion = useCallback((suggestion: string, line?: number) => {
    const insertSmartly = editorRef.current?.insertSuggestionSmartly;
    if (insertSmartly) {
      suppressAutoStopOnce();
      insertSmartly(suggestion, line);
      toast({
        title: "Suggestion inserted",
        description: "Code added to the appropriate location",
      });
    } else {
      // insertSuggestionSmartly method not available on editor
    }
  }, [suppressAutoStopOnce, toast]);

  // Pin control handlers are extracted into a dedicated hook for better separation of concerns.
  const { handlePinToggle, handleAnalogChange } = useSimulatorPinControls({
    sendMessage,
    simulationStatus,
    toast,
    setPinStates,
  });

  const {
    outputPanelRef,
    compilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    codeSlot,
    compileSlot,
    serialSlot,
  } = useSimulatorUIState({
    code,
    setCode,
    tabs,
    activeTabId,
    handleTabClick,
    handleTabAdd,
    handleTabClose,
    handleTabRename,
    handleFilesLoaded,
    handleLoadExample,
    formatCode,
    handleCompileAndStart,
    editorRef,
    backendReachable,
    activeOutputTab,
    parserMessages,
    ioRegistry,
    cliOutput,
    hasCompilationErrors,
    lastCompilationResult,
    handleClearCompilationOutput,
    handleInsertSuggestion,
    renderedSerialOutput,
    isConnected,
    simulationStatus,
    handleSerialSend,
    handleClearSerialOutput,
    showSerialMonitor,
    autoScrollEnabled,
    showCompilationOutput,
    parserPanelDismissed,
    setShowCompilationOutput,
    setActiveOutputTab,
    setParserPanelDismissed,
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
    isModified,
    toast,
  });

  // Status info can be computed dynamically when needed per getStatusInfo

  const simControlBusy =
    compileMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const simulateDisabled =
    ((simulationStatus === "idle" || simulationStatus === "paused") &&
      (!backendReachable || !isConnected)) ||
    simControlBusy;

  // Ensure the output panel is visible once a simulation starts so that the
  // output tabs (Compiler / Messages / Registry / Debug) are always accessible.
  useEffect(() => {
    if (simulationStatus === "running") {
      setShowCompilationOutput(true);
    }
  }, [simulationStatus, setShowCompilationOutput]);

  // External postMessage API — remote control for embedding websites.
  // The allowed origin is detected from the parent frame (ancestorOrigins).
  const externalAllowedOrigin =
    globalThis.location.ancestorOrigins?.[0] ?? "*";

  // Derive high-level ClientState from runtime + compilation state.
  // This is the single label shown in the debug header and exposed via API.
  const deriveClientState = useCallback((): string => {
    if (simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
    if (simulationStatus === "running") return "RUNNING";
    if (simulationStatus === "paused") return "PAUSED";
    if (compilationStatus === "compiling") return "COMPILING";
    // After compile success but before server confirms running → queued_for_running
    if (compilationStatus === "success" && simulationStatus === "idle") return "QUEUED_FOR_RUNNING";
    return "IDLE";
  }, [simulationStatus, compilationStatus]);

  useExternalApi({
    allowedOrigin: externalAllowedOrigin,
    onLoadCode: setCode,
    onStartSimulation: compileAndStartAction,
    onStopSimulation: handleStop,
    onPauseSimulation: handlePause,
    onResumeSimulation: handleResume,
    onSetPinState: (pin, value) => {
      sendMessage({ type: "pin_state", pin, stateType: "value", value });
    },
    getPinState: (pin) => {
      const found = pinStates.find((p) => p.pin === pin);
      return found?.value ?? 0;
    },
    onSerialInput: (data) => {
      handleSerialSend(data);
    },
    onSetSimulationTimeout: setSimulationTimeout,
    onSetOutputTab: setActiveOutputTab,
    getSimulationState: deriveClientState,
    getServerStatus: () => serverStatus && {
      serverReachable: backendReachable,
      pool: serverStatus.pool,
      compile: serverStatus.compile,
    },
  });

  // Emit SERVER_STATUS_EVENT whenever pool / health state changes
  useEffect(() => {
    if (!serverStatus) return;
    emitServerStatusEvent({
      serverReachable: backendReachable,
      pool: serverStatus.pool,
      compile: serverStatus.compile,
    });
  }, [serverStatus, backendReachable]);

  const state = {
    showErrorGlitch,
    backendReachable,
    isMobile,
    simulationStatus,
    compilationStatus,
    simulateDisabled,
    compileMutation,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    compileAndStartAction,
    handleStop,
    handlePause,
    handleResume,
    board,
    baudRate,
    simulationTimeout,
    setSimulationTimeout,
    isMac,
    handleTabAdd,
    activeTabId,
    tabs,
    handleTabRename,
    toast,
    formatCode,
    onLoadFiles,
    downloadAllFiles,
    openSettings,
    undo,
    redo,
    cut,
    copy,
    paste,
    selectAll,
    goToLine,
    find,
    handleCompile,
    handleCompileAndStart,
    setShowCompilationOutput,
    showCompilationOutput,
    setParserPanelDismissed,
    debugMode,
    batchStats,
    renderedSerialOutput,
    serialOutput,
    isConnected,
    wsConnectionState,
    wsHasEverConnected,
    handleSerialSend,
    handleClearSerialOutput,
    showSerialMonitor,
    showSerialPlotter,
    serialViewMode,
    cycleSerialViewMode,
    autoScrollEnabled,
    setAutoScrollEnabled,
    serialInputValue,
    setSerialInputValue,
    handleSerialInputKeyDown,
    handleSerialInputSend,
    telemetryData,
    txActivity,
    rxActivity,
    handleReset,
    handlePinToggle,
    analogPinsUsed,
    handleAnalogChange,
    pinMonitorVisible,
    pinStates,
    sandboxMode,
    workerIndex,
    workerTotal,
    serverStatus,
    mobilePanel,
    setMobilePanel,
    headerHeight,
    overlayZ,
    codeSlot,
    compileSlot,
    serialSlot,
    outputPanelRef,
    compilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    fileInputRef,
    handleHiddenFileInput,
  };

  return state;
}

export type ArduinoSimulatorPageState = ReturnType<typeof useArduinoSimulatorPage>;
