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

    expect(result.current.simulationStatus).toBe("stopped");
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
      expect(result.current.simulationStatus).toBe("stopped");
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
});
