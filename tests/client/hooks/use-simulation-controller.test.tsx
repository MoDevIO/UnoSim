import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSimulationController } from "../../../client/src/hooks/use-simulation-controller";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const buildParams = () => ({
  code: "",
  hasCompilationErrors: false,
  ensureBackendConnected: vi.fn(() => true),
  sendMessage: vi.fn(),
  sendMessageImmediate: vi.fn(() => false),
  resetPinUI: vi.fn(),
  clearOutputs: vi.fn(),
  serialEventQueueRef: { current: [] as Array<{ payload: never; receivedAt: number }> },
  pendingPinConflicts: [],
  uiFeedback: {
    logStopSimulation: vi.fn(),
    logPauseSimulation: vi.fn(),
    logResumeSimulation: vi.fn(),
    logStartSimulation: vi.fn(),
    logStartSimulationFallback: vi.fn(),
    showSimulationStartedToast: vi.fn(),
    showStartFailedToast: vi.fn(),
    showCodeModifiedToast: vi.fn(),
    showPauseFailedToast: vi.fn(),
    showResumeFailedToast: vi.fn(),
    showPinConflictWarning: vi.fn(),
    extractErrorMessage: vi.fn(() => "error"),
  },
});

describe("useSimulationController", () => {
  it("sends compiled code and falls back to buffered WebSocket delivery", async () => {
    const params = buildParams();
    const { result } = renderHook(() => useSimulationController(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setCompiledCode("compiled sketch");
      result.current.handleStart();
    });

    await waitFor(() => expect(result.current.simulationStatus).toBe("running"));
    expect(params.sendMessageImmediate).toHaveBeenCalledWith({
      type: "start_simulation",
      timeout: 60,
      code: "compiled sketch",
    });
    expect(params.sendMessage).toHaveBeenCalledWith({
      type: "start_simulation",
      timeout: 60,
      code: "compiled sketch",
    });
    expect(params.uiFeedback.logStartSimulationFallback).toHaveBeenCalledOnce();
  });

  it("performs synchronous stop cleanup for reset callers", () => {
    const params = buildParams();
    const { result } = renderHook(() => useSimulationController(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.stopSimulationImmediately();
    });

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(params.serialEventQueueRef.current).toEqual([]);
    expect(params.resetPinUI).toHaveBeenCalledWith({ keepDetected: true });
    expect(result.current.simulationStatus).toBe("idle");
  });
});