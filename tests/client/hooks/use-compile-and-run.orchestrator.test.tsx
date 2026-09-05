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
  startSimulation: vi.fn(),
  setCompiledCode: vi.fn(),
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

describe("useCompileAndRun orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires compile success to simulation start", () => {
    const params = buildParams();
    const { result } = renderHook(() => useCompileAndRun(params));

    act(() => result.current.handleCompileAndStart());

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Simulation starten");
    expect(params.setDebugMessages).toHaveBeenCalledWith([]);
    expect(compile.clearOutputs).toHaveBeenCalled();
    expect(compileMutation.mutate).toHaveBeenCalledWith(
      { code: "void setup() {}", headers: [] },
      expect.any(Object),
    );

    const callbacks = compileMutation.mutate.mock.calls[0][1];
    act(() => callbacks.onSuccess({ success: true }));

    expect(simulation.setCompiledCode).toHaveBeenCalledWith("void setup() {}");
    expect(simulation.startSimulation).toHaveBeenCalled();
    expect(compile.setCompilationStatus).toHaveBeenCalledWith("success");
    expect(simulation.setHasCompiledOnce).toHaveBeenCalledWith(true);
    expect(params.setIsModified).toHaveBeenCalledWith(false);
  });

  it("keeps simulation idle when compilation fails", () => {
    const params = buildParams();
    const { result } = renderHook(() => useCompileAndRun(params));

    act(() => result.current.handleCompileAndStart());
    const callbacks = compileMutation.mutate.mock.calls.at(-1)?.[1];
    act(() => callbacks.onSuccess({ success: false }));

    expect(compile.setCompilationStatus).toHaveBeenCalledWith("error");
    expect(simulation.setSimulationStatus).toHaveBeenCalledWith("idle");
    expect(simulation.startSimulation).not.toHaveBeenCalled();
  });
});