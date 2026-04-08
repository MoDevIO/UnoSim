import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExternalApi } from "@/hooks/use-external-api";
import { useArduinoSimulatorPage } from "@/hooks/useArduinoSimulatorPage";

const noop = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    isConnected: false,
    lastMessage: null,
    sendMessage: noop,
    sendMessageImmediate: noop,
  }),
}));

vi.mock("@/hooks/use-compilation", () => ({
  useCompilation: () => ({
    compilationStatus: "ready",
    setCompilationStatus: noop,
    setArduinoCliStatus: noop,
    hasCompilationErrors: false,
    setHasCompilationErrors: noop,
    lastCompilationResult: null,
    setLastCompilationResult: noop,
    cliOutput: "",
    setCliOutput: noop,
    compileMutation: { isPending: false },
    startMutation: { isPending: false },
    stopMutation: { isPending: false },
    pauseMutation: { isPending: false },
    resumeMutation: { isPending: false },
    handleCompile: noop,
    handleCompileAndStart: noop,
    handleClearCompilationOutput: noop,
    clearOutputs: noop,
  }),
}));

vi.mock("@/hooks/use-simulation", () => ({
  useSimulation: () => ({
    simulationStatus: "stopped",
    setSimulationStatus: noop,
    setHasCompiledOnce: noop,
    simulationTimeout: 0,
    setSimulationTimeout: noop,
    startMutation: { isPending: false },
    stopMutation: { isPending: false },
    pauseMutation: { isPending: false },
    resumeMutation: { isPending: false },
    handleStop: noop,
    handlePause: noop,
    handleResume: noop,
    handleReset: noop,
    suppressAutoStopOnce: noop,
    handleStart: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorActions", () => ({
  useSimulatorActions: () => ({
    handleStart: noop,
    handleStop: noop,
    handlePause: noop,
    handleResume: noop,
    handleCompileAndStart: noop,
  }),
}));

vi.mock("@/hooks/use-pin-state", () => ({
  usePinState: () => ({
    analogPinsUsed: [],
    setAnalogPinsUsed: noop,
    setDetectedPinModes: noop,
    pendingPinConflicts: [],
    setPendingPinConflicts: noop,
    pinMonitorVisible: false,
    resetPinUI: noop,
    pinToNumber: () => 0,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: noop }),
}));

vi.mock("@/hooks/use-backend-health", () => ({
  useBackendHealth: () => ({
    backendReachable: true,
    showErrorGlitch: false,
    ensureBackendConnected: noop,
    isBackendUnreachableError: false,
    triggerErrorGlitch: noop,
  }),
}));

vi.mock("@/hooks/use-mobile-layout", () => ({
  useMobileLayout: () => ({
    isMobile: false,
    mobilePanel: "code",
    setMobilePanel: noop,
    headerHeight: 0,
    overlayZ: 0,
  }),
}));

vi.mock("@/hooks/use-debug-mode-store", () => ({
  useDebugMode: () => ({ setDebugMode: noop }),
}));

vi.mock("@/hooks/use-serial-io", () => ({
  useSerialIO: () => ({
    serialOutput: [],
    setSerialOutput: noop,
    serialViewMode: "messages",
    autoScrollEnabled: false,
    setAutoScrollEnabled: noop,
    serialInputValue: "",
    setSerialInputValue: noop,
    showSerialMonitor: false,
    showSerialPlotter: false,
    cycleSerialViewMode: noop,
    renderedSerialOutput: [],
    appendSerialOutput: noop,
    setBaudrate: noop,
    pauseRendering: noop,
    resumeRendering: noop,
    stopRendering: noop,
    appendRenderedText: noop,
    clearSerialOutput: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorSerialPanel", () => ({
  useSimulatorSerialPanel: () => ({
    handleSerialSend: noop,
    handleSerialInputKeyDown: noop,
    handleClearSerialOutput: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorPinControls", () => ({
  useSimulatorPinControls: () => ({
    handlePinToggle: noop,
    handleAnalogChange: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorKeyboardShortcuts", () => ({
  useSimulatorKeyboardShortcuts: () => undefined,
}));

vi.mock("@/hooks/useSimulatorWebSocketBridge", () => ({
  useSimulatorWebSocketBridge: () => undefined,
}));

vi.mock("@/hooks/use-simulation-store", () => ({
  useSimulationStore: () => ({
    pinStates: [],
    setPinStates: noop,
    resetPinStates: noop,
    enqueuePinEvent: noop,
    batchStats: {},
  }),
}));

vi.mock("@/hooks/use-sketch-analysis", () => ({
  useSketchAnalysis: () => ({
    analogPins: [],
    varMap: new Map(),
    detectedPinModes: [],
    pendingPinConflicts: [],
  }),
}));

vi.mock("@/hooks/use-debug-console", () => ({
  useDebugConsole: () => ({
    debugMode: false,
    debugMessages: [],
    setDebugMessages: noop,
    debugMessageFilter: "all",
    setDebugMessageFilter: noop,
    debugViewMode: "default",
    setDebugViewMode: noop,
    debugMessagesContainerRef: { current: null },
    addDebugMessage: noop,
  }),
}));

vi.mock("@/hooks/use-editor-commands", () => ({
  useEditorCommands: () => ({
    undo: noop,
    redo: noop,
    find: noop,
    selectAll: noop,
    copy: noop,
    cut: noop,
    paste: noop,
    goToLine: noop,
    formatCode: noop,
  }),
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    code: "",
    setCode: noop,
    isModified: false,
    setIsModified: noop,
    tabs: [],
    setTabs: noop,
    activeTabId: undefined,
    setActiveTabId: noop,
    initializeDefaultSketch: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorFileSystem", () => ({
  useSimulatorFileSystem: () => ({
    fileInputRef: { current: null },
    onLoadFiles: noop,
    downloadAllFiles: noop,
    handleHiddenFileInput: noop,
    handleTabClick: noop,
    handleTabAdd: noop,
    handleTabClose: noop,
    handleTabRename: noop,
    handleFilesLoaded: noop,
    handleLoadExample: noop,
  }),
}));

vi.mock("@/hooks/useSimulatorUIState", () => ({
  useSimulatorUIState: () => ({
    outputPanelRef: { current: null },
    compilationPanelSize: 0,
    outputPanelMinPercent: 20,
    outputPanelManuallyResizedRef: { current: false },
    codeSlot: <div />,
    compileSlot: <div />,
    serialSlot: <div />,
  }),
}));

vi.mock("@/hooks/use-external-api", () => ({
  useExternalApi: vi.fn(),
}));

vi.mock("@shared/io-registry-parser", () => ({
  parseStaticIORegistry: () => [],
}));

describe("useArduinoSimulatorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("exposes default sandbox mode and worker state and registers external API callbacks", () => {
    const { result } = renderHook(() => useArduinoSimulatorPage());

    expect(result.current.sandboxMode).toBe("unknown");
    expect(result.current.workerIndex).toBeUndefined();
    expect(result.current.workerTotal).toBeUndefined();

    const externalApi = vi.mocked(useExternalApi);
    expect(externalApi).toHaveBeenCalledTimes(1);

    const params = externalApi.mock.calls[0][0];
    expect(params).toHaveProperty("allowedOrigin");
    expect(params).toHaveProperty("onStartSimulation");
    expect(params).toHaveProperty("onStopSimulation");
    expect(typeof params.onSetPinState).toBe("function");
    expect(typeof params.getPinState).toBe("function");
    expect(params.getPinState(0)).toBe(0);
  });
});
