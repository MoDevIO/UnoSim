import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCompileAndRun } from "../../../client/src/hooks/use-compile-and-run";

const compileMutation = { mutate: vi.fn() };
const compile = {
  compilationStatus: "ready",
  setCompilationStatus: vi.fn(),
  arduinoCliStatus: "idle",
  setArduinoCliStatus: vi.fn(),
  hasCompilationErrors: false,
  setHasCompilationErrors: vi.fn(),
  compilerErrors: [],
  setCompilerErrors: vi.fn(),
  lastCompilationResult: null,
  setLastCompilationResult: vi.fn(),
  cliOutput: "",
  setCliOutput: vi.fn(),
  compileMutation,
  handleCompile: vi.fn(),
  handleClearCompilationOutput: vi.fn(),
  clearOutputs: vi.fn(),
};

const simulation = {
  simulationStatus: "idle",
  setSimulationStatus: vi.fn(),
  hasCompiledOnce: false,
  setHasCompiledOnce: vi.fn(),
  simulationTimeout: 60,
  setSimulationTimeout: vi.fn(),
  startMutation: {},
  stopMutation: {},
  pauseMutation: {},
  resumeMutation: {},
  handleStart: vi.fn(),
  handleStop: vi.fn(),
  handlePause: vi.fn(),
  handleResume: vi.fn(),
  stopSimulationImmediately: vi.fn(),
  cancelPendingStart: vi.fn(),
  startSimulation: vi.fn(),
  setCompiledCode: vi.fn(),
  setCompiledArtifact: vi.fn(),
  willStartInBrowser: vi.fn(() => false),
  resetWithoutCompile: vi.fn(() => false),
  startSimulationRef: { current: null },
  suppressAutoStopOnce: vi.fn(),
};

vi.mock("../../../client/src/hooks/use-compile-controller", () => ({
  useCompileController: () => compile,
}));

vi.mock("../../../client/src/hooks/use-simulation-controller", () => ({
  useSimulationController: () => simulation,
}));

vi.mock("../../../client/src/hooks/use-ui-feedback-adapter", () => ({
  useUiFeedbackAdapter: () => ({
    showNoCodeToast: vi.fn(),
    showCompilationFailedWithErrorsToast: vi.fn(),
    showResettingToast: vi.fn(),
    setCompileSuccessOutput: vi.fn(),
    setCompileErrorOutput: vi.fn(),
    logCompileRequest: vi.fn(),
    logCompilationSuccess: vi.fn(),
    logCompilationError: vi.fn(),
    logStopSimulation: vi.fn(),
    logPauseSimulation: vi.fn(),
    logResumeSimulation: vi.fn(),
    logStartSimulation: vi.fn(),
    logStartSimulationFallback: vi.fn(),
    triggerCompileErrorGlitch: vi.fn(),
    showCompileSuccessToast: vi.fn(),
    showCompileErrorToast: vi.fn(),
    showSimulationStartedToast: vi.fn(),
    showStartFailedToast: vi.fn(),
    showCodeModifiedToast: vi.fn(),
    showPauseFailedToast: vi.fn(),
    showResumeFailedToast: vi.fn(),
    showBackendUnreachableToast: vi.fn(),
    extractErrorMessage: vi.fn(),
  }),
}));

const buildParams = () => ({
  editorRef: { current: { getValue: () => "void setup() {}" } },
  tabs: [{ id: "sketch", name: "sketch.ino", content: "fallback" }],
  activeTabId: "sketch",
  code: "state",
  setSerialOutput: vi.fn(),
  clearSerialOutput: vi.fn(),
  setParserMessages: vi.fn(),
  setParserPanelDismissed: vi.fn(),
  resetPinUI: vi.fn(),
  setIoRegistry: vi.fn(),
  setIsModified: vi.fn(),
  setDebugMessages: vi.fn(),
  addDebugMessage: vi.fn(),
  ensureBackendConnected: vi.fn(() => true),
  isBackendUnreachableError: vi.fn(() => false),
  triggerErrorGlitch: vi.fn(),
  toast: vi.fn(),
  sendMessage: vi.fn(),
  serialEventQueueRef: { current: [] },
  pendingPinConflicts: [],
  setPendingPinConflicts: vi.fn(),
});

describe("useCompileAndRun: a pending start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels the controller's browser start that waits for the emulator whenever the pending start is invalidated", () => {
    const params = buildParams();
    const { result } = renderHook(() => useCompileAndRun(params));
    simulation.cancelPendingStart.mockClear();

    act(() => result.current.invalidatePendingStart());

    expect(simulation.cancelPendingStart).toHaveBeenCalledOnce();
  });

  it("invalidates the pending start when the build is discarded, so the old image is not started", () => {
    const params = buildParams();
    const { result } = renderHook(() => useCompileAndRun(params));
    simulation.cancelPendingStart.mockClear();

    act(() => result.current.discardBuild());

    expect(simulation.cancelPendingStart).toHaveBeenCalled();
    expect(simulation.setCompiledArtifact).toHaveBeenCalledWith(undefined);
  });
});
