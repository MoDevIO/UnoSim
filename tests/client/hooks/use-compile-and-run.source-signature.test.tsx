import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
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

const controllerCalls: Array<{ sourceSignature?: string }> = [];
vi.mock("../../../client/src/hooks/use-simulation-controller", () => ({
  useSimulationController: (args: { sourceSignature?: string }) => {
    controllerCalls.push(args);
    return simulation;
  },
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

describe("useCompileAndRun: what counts as the source of the run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerCalls.length = 0;
  });

  const tabs = [
    { id: "main", name: "sketch.ino", content: "void loop() {}" },
    { id: "header", name: "leds.h", content: "const int LED = 9;" },
  ];
  const signature = () => controllerCalls.at(-1)?.sourceSignature;
  const project = (activeTabId: string, code: string) => ({
    tabs,
    activeTabId,
    code,
    sourceProject: { entryFile: "sketch.ino", files: { "sketch.ino": activeTabId === "main" ? code : tabs[0]!.content, "leds.h": activeTabId === "header" ? code : tabs[1]!.content } },
  });

  it("gives the controller the content of every file, the same for whichever tab is shown", () => {
    const { rerender } = renderHook((props) => useCompileAndRun({ ...buildParams(), ...props } as never), { initialProps: project("main", "void loop() {}") });
    const first = signature();

    rerender(project("header", "const int LED = 9;")); // another tab is opened, nothing is edited

    expect(first).toBeDefined();
    expect(signature()).toBe(first);
  });

  it("changes it when a file is edited, in the shown tab or not", () => {
    const { rerender } = renderHook((props) => useCompileAndRun({ ...buildParams(), ...props } as never), { initialProps: project("main", "void loop() {}") });
    const first = signature();

    rerender(project("main", "void loop() { /* edited */ }"));
    const edited = signature();
    rerender({ ...project("header", "const int LED = 9;"), tabs: [{ ...tabs[0]!, content: "void loop() { /* edited */ }" }, tabs[1]!], sourceProject: { entryFile: "sketch.ino", files: { "sketch.ino": "void loop() { /* edited */ }", "leds.h": "const int LED = 10;" } } });

    expect(edited).not.toBe(first);
    expect(signature()).not.toBe(edited);
  });

  it("leaves the signature out without a source project, so the shown code decides", () => {
    renderHook(() => useCompileAndRun(buildParams() as never));

    expect(signature()).toBeUndefined();
  });
});
