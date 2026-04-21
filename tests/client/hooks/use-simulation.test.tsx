import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSimulation } from "../../../client/src/hooks/use-simulation";

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
    code: "",
    // lifecycle extras
    handlePause: vi.fn(),
    handleResume: vi.fn(),
    handleReset: vi.fn(),
    hasCompilationErrors: false,
  };
};

describe("useSimulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("exposes control functions and additional lifecycle helper", () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulation(params), { wrapper });

    expect(result.current.simulationStatus).toBe("idle");
    expect(typeof result.current.handleStart).toBe("function");
    expect(typeof result.current.handleStop).toBe("function");
    expect(typeof result.current.suppressAutoStopOnce).toBe("function");
  });

  it("handleStart starts simulation and sends message", async () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulation(params), { wrapper });

    act(() => {
      result.current.handleStart();
    });

    await waitFor(() => {
      expect(result.current.simulationStatus).toBe("running");
    });

    expect(params.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start_simulation" }),
    );
  });

  it("suppressAutoStopOnce is callable", () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSimulation(params), { wrapper });

    act(() => {
      result.current.suppressAutoStopOnce();
    });

    // nothing to assert other than it doesn't throw
    expect(result.current.suppressAutoStopOnce).toBeDefined();
  });
});