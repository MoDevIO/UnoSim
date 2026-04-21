import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSimulationControls } from "../../../client/src/hooks/use-simulation-controls";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const buildParams = () => {
  return {
    ensureBackendConnected: vi.fn(() => true),
    sendMessage: vi.fn(),
    resetPinUI: vi.fn(),
    clearOutputs: vi.fn(),
    addDebugMessage: vi.fn(),
    serialEventQueueRef: { current: [] as Array<{ payload: any; receivedAt: number }> },
    toast: vi.fn(),
    pendingPinConflicts: [] as number[],
    setPendingPinConflicts: vi.fn(),
    setCliOutput: vi.fn(),
    isModified: false,
    handleCompileAndStart: vi.fn(),
    startSimulationRef: { current: null as null | (() => void) },
  };
};

describe("useSimulationControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial state and assigns startSimulationRef", () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    expect(result.current.simulationStatus).toBe("idle");
    expect(result.current.hasCompiledOnce).toBe(false);
    expect(result.current.simulationTimeout).toBe(60);
    expect(typeof params.startSimulationRef.current).toBe("function");
  });

  it("handleStart starts simulation and sends message", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("running");
    });

    expect(params.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start_simulation" }),
    );
    expect(params.addDebugMessage).toHaveBeenCalled();
  });

  it("handleStop clears serial queue and stops simulation", async () => {
    const params = buildParams();
    params.serialEventQueueRef.current = [{ payload: "x", receivedAt: 1 }];
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStop();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("idle");
    });

    expect(params.serialEventQueueRef.current).toEqual([]);
  });

  it("handleReset clears outputs and recompiles after delay", async () => {
    vi.useFakeTimers();
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("running");
    });

    act(() => {
      result.current.handleReset();
    });

    expect(params.clearOutputs).toHaveBeenCalled();
    expect(params.resetPinUI).toHaveBeenCalledWith({ keepDetected: true });

    act(() => {
      vi.advanceTimersByTime(120);
    });

    await waitFor(() => {
      expect(params.handleCompileAndStart).toHaveBeenCalled();
    });
  });

  it("handlePause pauses simulation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("running");
    });

    act(() => {
      result.current.handlePause();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("paused");
    });

    expect(params.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pause_simulation" }),
    );
    expect(params.addDebugMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pause_simulation" }),
    );
  });

  it("handleResume resumes simulation from paused", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("paused");
    });

    act(() => {
      result.current.handleResume();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("running");
    });

    expect(params.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resume_simulation" }),
    );
    expect(params.addDebugMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resume_simulation" }),
    );
  });

  it("startMutation shows pin conflict warning when pendingPinConflicts exist", async () => {
    const params = buildParams();
    params.pendingPinConflicts = [2, 14, 15];
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(params.setCliOutput).toHaveBeenCalled();
    });

    const setCliCall = params.setCliOutput.mock.calls[0][0];
    const outputValue = typeof setCliCall === "function" ? setCliCall("") : setCliCall;
    expect(outputValue).toContain("Pin usage conflict");
    expect(outputValue).toContain("2, A0, A1");
    expect(params.setPendingPinConflicts).toHaveBeenCalledWith([]);
  });

  it("startMutation shows success toast on start", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Simulation Started",
          description: expect.stringContaining("running"),
        }),
      );
    });
  });

  it("startMutation error shows toast with error message", async () => {
    const params = buildParams();
    params.sendMessage = vi.fn(() => {
      throw new Error("Network error");
    });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Start Failed",
          variant: "destructive",
        }),
      );
    });
  });

  it("startMutation error with isModified shows additional compile reminder", async () => {
    const params = buildParams();
    params.isModified = true;
    params.sendMessage = vi.fn(() => {
      throw new Error("Network error");
    });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setHasCompiledOnce(true);
    });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      const toastCalls = params.toast.mock.calls;
      const hasCompileReminder = toastCalls.some(
        (call) => call[0].title === "Code Modified",
      );
      expect(hasCompileReminder).toBe(true);
    });
  });

  it("pauseMutation error shows destructive toast", async () => {
    const params = buildParams();
    params.sendMessage = vi.fn(() => {
      throw new Error("Pause failed");
    });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("running");
    });

    act(() => {
      result.current.handlePause();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Pause failed",
          variant: "destructive",
        }),
      );
    });
  });

  it("resumeMutation error shows destructive toast", async () => {
    const params = buildParams();
    params.sendMessage = vi.fn(() => {
      throw new Error("Resume failed");
    });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("paused");
    });

    act(() => {
      result.current.handleResume();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Resume failed",
          variant: "destructive",
        }),
      );
    });
  });

  it("handleStart exits early when ensureBackendConnected returns false", () => {
    const params = buildParams();
    params.ensureBackendConnected = vi.fn(() => false);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Simulation starten");
    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("handleStop exits early when ensureBackendConnected returns false", () => {
    const params = buildParams();
    params.ensureBackendConnected = vi.fn(() => false);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStop();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Simulation stoppen");
    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("handlePause exits early when ensureBackendConnected returns false", () => {
    const params = buildParams();
    params.ensureBackendConnected = vi.fn(() => false);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handlePause();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Simulation pausieren");
    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("handleResume exits early when ensureBackendConnected returns false", () => {
    const params = buildParams();
    params.ensureBackendConnected = vi.fn(() => false);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleResume();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Simulation fortsetzen");
    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("handleReset exits early when ensureBackendConnected returns false", () => {
    const params = buildParams();
    params.ensureBackendConnected = vi.fn(() => false);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleReset();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith("Reset simulation");
    expect(params.clearOutputs).not.toHaveBeenCalled();
  });

  it("startMutation uses simulationTimeout parameter", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationTimeout(120);
    });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(params.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "start_simulation",
          timeout: 120,
        }),
      );
    });
  });

  it("startSimulationRef can trigger start mutation directly", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    expect(params.startSimulationRef.current).not.toBeNull();

    act(() => {
      params.startSimulationRef.current?.();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("running");
    });
  });

  it("stopMutation resets pin UI with keepDetected option", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.handleStop();
    });

    await waitFor(() => {
      expect(params.resetPinUI).toHaveBeenCalledWith({ keepDetected: true });
    });
  });

  it("handleReset shows toast notification", async () => {
    vi.useFakeTimers();
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("running");
    });

    act(() => {
      result.current.handleReset();
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Resetting...",
        description: expect.stringContaining("Recompiling"),
      }),
    );

    vi.useRealTimers();
  });

  it("handleReset stops running simulation before reset", async () => {
    vi.useFakeTimers();
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulationControls(params), { wrapper });

    act(() => {
      result.current.setSimulationStatus("running");
    });

    act(() => {
      result.current.handleReset();
    });

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(result.current.simulationStatus).toBe("idle");

    vi.useRealTimers();
  });
});
