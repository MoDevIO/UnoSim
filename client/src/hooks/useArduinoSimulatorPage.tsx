// arduino-simulator.tsx

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useWebSocket } from "@/hooks/use-websocket";
import { useCompileAndRun } from "@/hooks/use-compile-and-run";
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
import { useWebSocketHandler } from "@/hooks/useWebSocketHandler";
import { useSimulationStore } from "@/hooks/use-simulation-store";
import { useSketchAnalysis } from "@/hooks/use-sketch-analysis";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { useDebugConsole } from "@/hooks/use-debug-console";
import { useEditorCommands } from "@/hooks/use-editor-commands";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useSimulatorFileSystem } from "@/hooks/useSimulatorFileSystem";
import { useSimulatorExternalControl } from "@/hooks/useSimulatorExternalControl";
import { parseStaticIORegistryProject } from "@shared/io-registry-parser";
import { buildSourceProject } from "@/lib/source-project";
import { findTabForSourceLocation } from "@/lib/source-navigation";
import { getEffectiveIoRegistry } from "@/lib/io-registry-state";
import { getServerCapabilities } from "@/lib/server-capabilities";
import { setActiveBoard } from "@/lib/active-board";
import { boardSerialPortCount } from "@shared/board-pins";
import { getRuntimeHub } from "@/lib/runtime/runtime-hub";
import { createRuntimeCommandRouter } from "@/lib/runtime/runtime-commands";
import { useSimulationRuntimeSelection } from "@/hooks/use-simulation-runtime";
import { useBrowserRunInfo } from "@/hooks/use-browser-run-info";

import type {
  Sketch,
  ParserMessage,
  IOPinRecord,
} from "@shared/schema";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { DebugMessageParams } from "@/hooks/use-compile-and-run";
import type { OutputTab } from "@/types/compilation.types";
import type { SourceNavigationTarget } from "@/types/source-navigation";
import { isSourceLocation } from "@/types/source-navigation";
import type { SourceLocation } from "@shared/source-project";
import type { BoardId } from "@shared/boards";
import { holdsServerSimulation } from "@shared/types/arduino.types";
import { isMac } from "@/lib/platform";
import {
  DIGITAL_PIN_COUNT,
  ANALOG_PIN_COUNT,
} from "@/components/simulator/ArduinoSimulatorPage.styles";
import { detectParentOrigin } from "@/lib/parent-origin";

export function useArduinoSimulatorPage() {
  const editorRef = useRef<{
    getValue: () => string;
    goToLine?: (line: number) => void;
    insertSuggestionSmartly?: (suggestion: string, line?: number) => void;
  } | null>(null);

  // File system orchestration (currentSketch, code, isModified state)
  const {
    code,
    setCode,
    codeRef,
    isModified,
    setIsModified,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    initializeDefaultSketch,
  } = useFileSystem({ sketches: undefined });

  const sourceProject = useMemo(
    () => buildSourceProject(tabs, activeTabId, code),
    [tabs, activeTabId, code],
  );

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
    serialPort,
    setSerialPort,
    serialPortCount,
    setSerialPortCount,
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
  // Static analysis and runtime snapshots have separate lifecycles. The
  // effective registry is selected below once the simulation status is known.
  const [staticIoRegistry, setStaticIoRegistry] = useState<IOPinRecord[]>(() => {
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
  const [runtimeIoRegistry, setRuntimeIoRegistry] = useState<IOPinRecord[] | null>(null);

  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("compiler");
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

  // Baud rate (shown in the Tools menu)
  const [baudRate, setBaudRate] = useState<number>(115200);
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
  const {
    isMobile,
    isTablet,
    isDesktop,
    layoutMode,
    mobilePanel,
    setMobilePanel,
    headerHeight,
    overlayZ,
  } = useMobileLayout();



  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setDebugMode } = useDebugMode();
  const loadFilesTriggerRef = useRef<(() => void) | null>(null);
  const openLoadFiles = useCallback(() => {
    loadFilesTriggerRef.current?.();
  }, []);
  const renameTriggerRef = useRef<(() => void) | null>(null);
  const openRenameFile = useCallback(() => {
    const trigger = renameTriggerRef.current;
    if (trigger) globalThis.queueMicrotask(trigger);
  }, []);
  
  
  const {
    isConnected,
    connectionState: wsConnectionState,
    hasEverConnected: wsHasEverConnected,
    lastMessage: _lastMessage,
    sendMessage: sendMessageRaw,
    sendMessageImmediate,
  } = useWebSocket();

  // Backend health check and recovery
  const {
    backendReachable,
    showErrorGlitch,
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
    serverStatus,
  } = useBackendHealth(queryClient);
  // A running browser emulation keeps its controls while the server is gone.
  const browserRun = useBrowserRunInfo();
  const capabilities = useMemo(
    () => getServerCapabilities(backendReachable, browserRun.active),
    [backendReachable, browserRun.active],
  );

  // Run commands of a browser run go to the browser runtime (it needs no connection);
  // everything else shares the offline guard of the WebSocket commands.
  const commandRouter = useMemo(() => createRuntimeCommandRouter(getRuntimeHub()), []);
  const runtimeSelection = useSimulationRuntimeSelection();
  // Selected board (Tools → Board): the server's default until the user chooses another.
  const board = runtimeSelection.board?.displayName ?? "Arduino UNO";
  const boardId = runtimeSelection.board?.id;
  // The pin helpers outside the page (pin store, labels, registry table) follow the selected board.
  if (boardId) setActiveBoard(boardId);
  const boardSerialPorts = boardId ? boardSerialPortCount(boardId) : 1;
  useEffect(() => {
    setSerialPortCount(boardSerialPorts);
  }, [boardSerialPorts, setSerialPortCount]);
  const sendMessage = useCallback((message: IncomingArduinoMessage) => {
    if (commandRouter.route(message)) return;
    if (!capabilities.canUseRealtimeControls) return;
    sendMessageRaw(message);
  }, [capabilities, sendMessageRaw, commandRouter]);
  const sendMessageImmediateGuarded = useCallback((message: IncomingArduinoMessage) => {
    if (commandRouter.route(message)) return true;
    if (!capabilities.canUseRealtimeControls) return false;
    return sendMessageImmediate(message);
  }, [capabilities, sendMessageImmediate, commandRouter]);
  const sendAnalogValue = useCallback((pin: number, value: number) => {
    if (!commandRouter.setAnalog(pin, value)) sendMessage({ type: "set_pin_value", pin, value });
  }, [commandRouter, sendMessage]);

  // placeholder for compilation-start callback
  const startSimulationRef = useRef<(() => void) | null>(null);

  /** True once the first real output (serial or pin value/pwm) arrives after simulation starts. */
  const [hasFirstOutput, setHasFirstOutput] = useState(false);


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
    dockerGccPhase,
    setDockerGccPhase,
    simulationStatus,
    setSimulationStatus,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    handleStart: controllerHandleStart,
    handleStop: controllerHandleStop,
    handlePause: controllerHandlePause,
    handleResume: controllerHandleResume,
    handleReset: controllerHandleReset,
    discardBuild,
    suppressAutoStopOnce,
    invalidatePendingStart,
  } = useCompileAndRun({
    ...(runtimeSelection.runtimeKind ? { runtimeKind: runtimeSelection.runtimeKind } : {}),
    ...(boardId ? { boardId } : {}),
    hostMockUsable: runtimeSelection.usable.includes("host-mock"),
    editorRef,
    tabs,
    activeTabId,
    code,
    codeRef,
    sourceProject,
    setSerialOutput,
    clearSerialOutput,
    setParserMessages,
    setParserPanelDismissed,
    resetPinUI,
    setIoRegistry: setRuntimeIoRegistry,
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
    capabilities,
    isBackendUnreachableError,
    triggerErrorGlitch,
    toast,
    sendMessage,
    sendMessageImmediate: sendMessageImmediateGuarded,
    serialEventQueueRef,
    pendingPinConflicts,
    setPendingPinConflicts,
    isModified,
    handleCompileAndStart: () => {},
    startSimulationRef,
  });

  // Centralize simulator actions (start, stop, pause, resume, reset, compile & start)
  // This extracts control logic into a reusable hook for better testability and modularity
  const handleStartAndClearRuntime = useCallback(() => {
    setRuntimeIoRegistry(null);
    controllerHandleStart();
  }, [controllerHandleStart, setRuntimeIoRegistry]);

  const handleStopAndClearRuntime = useCallback(() => {
    setRuntimeIoRegistry(null);
    controllerHandleStop();
  }, [controllerHandleStop, setRuntimeIoRegistry]);

  // A board change, from whichever place (Tools → Board, an example for another board), stops the run and
  // drops the build made for the old board (plan P4.5, P4.6).
  const handleBoardChange = useCallback((next: BoardId) => runtimeSelection.setBoard(next), [runtimeSelection]);
  const previousBoardRef = useRef(boardId);
  useEffect(() => {
    const previous = previousBoardRef.current;
    previousBoardRef.current = boardId;
    if (previous === undefined || previous === boardId) return;
    if (holdsServerSimulation(simulationStatus)) handleStopAndClearRuntime();
    discardBuild();
  }, [boardId, simulationStatus, handleStopAndClearRuntime, discardBuild]);

  const handleResetAndClearRuntime = useCallback(() => {
    setRuntimeIoRegistry(null);
    controllerHandleReset();
  }, [controllerHandleReset, setRuntimeIoRegistry]);

  const {
    handleStop,
    handlePause,
    handleResume,
    handleReset,
    handleCompileAndStart: actionsCompileAndStart,
  } = useSimulatorActions({
    onStart: handleStartAndClearRuntime,
    onStop: handleStopAndClearRuntime,
    onPause: controllerHandlePause,
    onResume: controllerHandleResume,
    onReset: handleResetAndClearRuntime,
    onCompileAndStart: handleCompileAndStart,
  });

  // Use the memoized compile-and-start from actions for consistent behavior
  const compileAndStartAction = actionsCompileAndStart;



  // Use centralized output panel hook for all output-related state and callbacks

  const onReplaceAllFiles = useCallback(() => {
    invalidatePendingStart();
    if (holdsServerSimulation(simulationStatus)) {
      sendMessage({ type: "stop_simulation" });
    }

    clearOutputs();
    resetPinUI();
    setRuntimeIoRegistry(null);
    setCompilationStatus("ready");
    setArduinoCliStatus("idle");
    setLastCompilationResult(null);
    setSimulationStatus("idle");
    setHasCompiledOnce(false);
  }, [
    invalidatePendingStart,
    simulationStatus,
    sendMessage,
    clearOutputs,
    resetPinUI,
    setCompilationStatus,
    setArduinoCliStatus,
    setLastCompilationResult,
    setSimulationStatus,
    setHasCompiledOnce,
    setRuntimeIoRegistry,
  ]);

  const onLoadExample = useCallback(() => {
    invalidatePendingStart();
    if (holdsServerSimulation(simulationStatus)) {
      sendMessage({ type: "stop_simulation" });
    }

    clearOutputs();
    setStaticIoRegistry(() => {
      const pins: IOPinRecord[] = [];
      for (let i = 0; i <= 13; i++) pins.push({ pin: String(i), defined: false, usedAt: [] });
      for (let i = 0; i <= 5; i++) pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
      return pins;
    });
    setRuntimeIoRegistry(null);
    setCompilationStatus("ready");
    setArduinoCliStatus("idle");
    setLastCompilationResult(null);
    setSimulationStatus("idle");
    setHasCompiledOnce(false);
  }, [
    invalidatePendingStart,
    simulationStatus,
    sendMessage,
    clearOutputs,
    resetPinUI,
    setStaticIoRegistry,
    setRuntimeIoRegistry,
    setCompilationStatus,
    setArduinoCliStatus,
    setLastCompilationResult,
    setSimulationStatus,
    setHasCompiledOnce,
  ]);

  const {
    downloadAllFiles,
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

  const pendingSourceNavigation = useRef<{
    tabId: string;
    location: SourceLocation;
  } | null>(null);

  const navigateToSourceLocation = useCallback(
    (target: SourceNavigationTarget) => {
      const line = isSourceLocation(target) ? target.line : target;
      if (line <= 0) return;
      if (!isSourceLocation(target)) {
        editorRef.current?.goToLine?.(line);
        return;
      }

      const targetTab = findTabForSourceLocation(tabs, target);
      if (!targetTab) return;
      if (targetTab.id === activeTabId) {
        editorRef.current?.goToLine?.(line);
        return;
      }

      pendingSourceNavigation.current = { tabId: targetTab.id, location: target };
      handleTabClick(targetTab.id);
    },
    [activeTabId, handleTabClick, tabs],
  );

  // Tab activation updates the editor value in the child editor effect. Once
  // the selected tab's content is visible, apply the pending source location.
  useEffect(() => {
    const pending = pendingSourceNavigation.current;
    if (pending?.tabId !== activeTabId) return;
    const editor = editorRef.current;
    if (editor?.getValue() !== code) return;
    editor.goToLine?.(pending.location.line);
    pendingSourceNavigation.current = null;
  }, [activeTabId, code]);

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
    capabilities,
    handleCompile,
    handleCompileAndStart,
    handleStop,
    handleFormatCode: formatCode,
    handleNewFile: handleTabAdd,
    setDebugMode,
    toast,
  });

  // WebSocket message handling (centralized handler for all incoming messages)
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
    setWorkerIndex,
    setWorkerTotal,
    setDockerGccPhase,
    stopRendering,
    pauseRendering,
    resumeRendering,
    serialEventQueueRef,
    setPinStates,
    setAnalogPinsUsed,
    resetPinUI,
    enqueuePinEvent,
    setIoRegistry: setRuntimeIoRegistry,
    setBaudRate,
    setSerialBaudrate,
    pinToNumber,
    setParserMessages,
    setHasFirstOutput,
    toast,
  });

  // Parse the current code to detect which analog pins are used by name or channel
  // (extracted to `useSketchAnalysis` for testability and reuse)
  const {
    analogPins: _analogPins,
    varMap: _varMap,
    detectedPinModes: _detectedPinModes,
    pendingPinConflicts: _pendingPinConflicts,
  } = useSketchAnalysis(sourceProject, boardId);

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
      const options = boardId ? { board: boardId } : {};
      setStaticIoRegistry(sourceProject ? parseStaticIORegistryProject(sourceProject, options) : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [sourceProject, boardId, compilationStatus, setStaticIoRegistry]);

  // A stopped/reset run must not leak its last runtime snapshot into the next
  // idle view. The static registry becomes authoritative again immediately.
  useEffect(() => {
    if (simulationStatus === "idle") setRuntimeIoRegistry(null);
  }, [simulationStatus]);

  const effectiveIoRegistry = useMemo(
    () => getEffectiveIoRegistry(staticIoRegistry, runtimeIoRegistry, simulationStatus),
    [staticIoRegistry, runtimeIoRegistry, simulationStatus],
  );

  const { handleSerialSend, handleSerialInputKeyDown, handleClearSerialOutput } =
    useSimulatorSerialPanel({
      sendMessage,
      simulationStatus,
      toast,
      setTxActivity,
      serialInputValue,
      setSerialInputValue,
      clearSerialOutput,
      serialPort,
      ensureBackendConnected,
      capabilities,
    });

  const handleSerialInputSend = () => {
    if (!serialInputValue.trim()) return;
    handleSerialSend(serialInputValue, serialPort);
  };

  const closeMobilePanel = useCallback(() => {
    if (isMobile) setMobilePanel("code");
  }, [isMobile, setMobilePanel]);

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
    sendAnalogValue,
    capabilities,
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
    loadFilesTriggerRef,
    renameTriggerRef,
    handleFilesLoaded,
    handleLoadExample,
    downloadAllFiles: () => {
      void downloadAllFiles();
    },
    formatCode,
    editorRef,
    capabilities,
    activeOutputTab,
    parserMessages,
    ioRegistry: effectiveIoRegistry,
    cliOutput,
    hasCompilationErrors,
    lastCompilationResult,
    handleClearCompilationOutput,
    handleInsertSuggestion,
    onPanelClose: closeMobilePanel,
    onNavigateToSource: navigateToSourceLocation,
    renderedSerialOutput,
    serialOutput,
    serialPort,
    setSerialPort,
    serialPortCount,
    isConnected,
    simulationStatus,
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
    baudRate,
    telemetryData,
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

  const externalAllowedOrigin = detectParentOrigin();

  const loadExternalCode = useCallback((nextCode: string) => {
    invalidatePendingStart();
    setCode(nextCode);
  }, [invalidatePendingStart, setCode]);

  // The runtime of the current run, or the one the next start will use while idle (the debug bar names it).
  const engine = holdsServerSimulation(simulationStatus) ? (getRuntimeHub().active ?? runtimeSelection.runtimeKind) : runtimeSelection.runtimeKind;

  const { pendingExternalStart } = useSimulatorExternalControl({
    ...(boardId ? { getBoardInfo: () => ({ board: boardId, boardName: board, serialPorts: boardSerialPorts, ...(engine ? { runtime: engine } : {}) }) } : {}),
    allowedOrigin: externalAllowedOrigin,
    backendReachable,
    isConnected,
    compileAndStartAction,
    handleStop,
    handlePause,
    handleResume,
    setCode: loadExternalCode,
    setSimulationStatus,
    sendMessage,
    pinStates,
    handleSerialSend,
    setSimulationTimeout,
    setActiveOutputTab,
    simulationStatus,
    compilationStatus,
    serverStatus,
  });

  const simControlBusy =
    compileMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const simulateDisabled =
    !capabilities.canSimulate ||
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

  const state = {
    compile: {
      compilationStatus,
      dockerGccPhase,
      simulateDisabled,
      compileMutation,
      handleCompile,
      handleCompileAndStart,
      showCompilationOutput,
      setShowCompilationOutput,
      setParserPanelDismissed,
      hasFirstOutput,
    },
    simulation: {
      simulationStatus,
      startMutation,
      stopMutation,
      pauseMutation,
      resumeMutation,
      compileAndStartAction,
      handleStop,
      handlePause,
      handleResume,
      handleReset,
      simulationTimeout,
      setSimulationTimeout,
      pendingExternalStart,
    },
    serial: {
      baudRate,
      renderedSerialOutput,
      serialOutput,
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
      txActivity,
      rxActivity,
    },
    pins: {
      batchStats,
      handlePinToggle,
      analogPinsUsed,
      handleAnalogChange,
      pinMonitorVisible,
      pinStates,
    },
    files: {
      handleTabAdd,
      activeTabId,
      tabs,
      handleTabRename,
      onRenameFile: openRenameFile,
      formatCode,
      onLoadFiles: openLoadFiles,
      downloadAllFiles,
      undo,
      redo,
      cut,
      copy,
      paste,
      selectAll,
      goToLine,
      find,
    },
    connection: {
      backendReachable,
      capabilities,
      isConnected,
      wsConnectionState,
      wsHasEverConnected,
      telemetryData,
      workerIndex,
      workerTotal,
      serverStatus,
      browserRun,
      engine,
    },
    layout: {
      showErrorGlitch,
      isMobile,
      isTablet,
      isDesktop,
      layoutMode,
      board,
      boards: runtimeSelection.config.boards,
      boardId,
      onBoardChange: handleBoardChange,
      isMac,
      toast,
      openSettings,
      debugMode,
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
    },
    tutor: {
      code,
    },
  };

  return state;
}

export type ArduinoSimulatorPageState = ReturnType<typeof useArduinoSimulatorPage>;
