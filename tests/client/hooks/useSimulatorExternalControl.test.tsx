import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  claimPendingExternalStart,
  useSimulatorExternalControl,
} from "../../../client/src/hooks/useSimulatorExternalControl";

const {
  useExternalApi,
  emitSimulationStateEvent,
  emitServerStatusEvent,
} = vi.hoisted(() => ({
  useExternalApi: vi.fn(),
  emitSimulationStateEvent: vi.fn(),
  emitServerStatusEvent: vi.fn(),
}));

vi.mock("@/hooks/use-external-api", () => ({
  useExternalApi,
  emitSimulationStateEvent,
  emitServerStatusEvent,
}));

const buildParams = (overrides = {}) => ({
  allowedOrigin: "https://parent.example",
  backendReachable: true,
  isConnected: true,
  compileAndStartAction: vi.fn(),
  handleStop: vi.fn(),
  handlePause: vi.fn(),
  handleResume: vi.fn(),
  setCode: vi.fn(),
  setSimulationStatus: vi.fn(),
  sendMessage: vi.fn(),
  pinStates: [{ pin: 13, value: 1 }],
  handleSerialSend: vi.fn(),
  setSimulationTimeout: vi.fn(),
  setActiveOutputTab: vi.fn(),
  simulationStatus: "idle" as const,
  compilationStatus: "ready",
  serverStatus: {
    sandboxRunners: { total: 1, available: 1, inUse: 0, queued: 0, max: 1 },
    compileSlots: { active: 0, queued: 0, maxConcurrent: 1 },
  },
  ...overrides,
});

describe("useSimulatorExternalControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims a pending start synchronously and only once", () => {
    const pendingRef = { current: true };

    expect(claimPendingExternalStart(pendingRef, false)).toBe(false);
    expect(pendingRef.current).toBe(true);
    expect(claimPendingExternalStart(pendingRef, true)).toBe(true);
    expect(pendingRef.current).toBe(false);
    expect(claimPendingExternalStart(pendingRef, true)).toBe(false);
  });

  it("queues an external start until the backend and WebSocket are ready", () => {
    const params = buildParams({ backendReachable: false, isConnected: false });
    const { result, rerender } = renderHook((props) => useSimulatorExternalControl(props), {
      initialProps: params,
    });

    act(() => useExternalApi.mock.calls[0][0].onStartSimulation());

    expect(result.current.pendingExternalStart).toBe(true);
    expect(params.setSimulationStatus).toHaveBeenCalledWith("queued");
    expect(emitSimulationStateEvent).toHaveBeenCalledWith("QUEUED_FOR_COMPILING");

    rerender({ ...params, backendReachable: true, isConnected: true });

    expect(result.current.pendingExternalStart).toBe(false);
    expect(params.compileAndStartAction).toHaveBeenCalledOnce();
  });

  it("claims a queued start once even when readiness and callback identities churn", () => {
    const initialParams = buildParams({ backendReachable: false, isConnected: false });
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const laterActions = Array.from({ length: 4 }, () => vi.fn());

    const { result, rerender } = renderHook(
      ({ action, ready, revision }: { action: () => void; ready: boolean; revision: number }) =>
        useSimulatorExternalControl({
          ...initialParams,
          compileAndStartAction: action,
          backendReachable: ready,
          isConnected: ready,
          serverStatus: {
            ...initialParams.serverStatus,
            compileSlots: {
              ...initialParams.serverStatus.compileSlots,
              queued: revision,
            },
          },
        }),
      {
        initialProps: { action: firstAction, ready: false, revision: 0 },
      },
    );

    act(() => useExternalApi.mock.calls[0][0].onStartSimulation());
    expect(result.current.pendingExternalStart).toBe(true);

    rerender({ action: secondAction, ready: true, revision: 1 });
    expect(result.current.pendingExternalStart).toBe(false);
    expect(secondAction).toHaveBeenCalledOnce();

    laterActions.forEach((action, index) => {
      rerender({ action, ready: true, revision: index + 2 });
    });

    expect(secondAction).toHaveBeenCalledOnce();
    for (const action of laterActions) {
      expect(action).not.toHaveBeenCalled();
    }
  });

  it("allows a new external start after the previous pending start was claimed", () => {
    const params = buildParams({ backendReachable: false, isConnected: false });
    const firstAction = vi.fn();
    const { result, rerender } = renderHook(
      ({ action, ready }: { action: () => void; ready: boolean }) =>
        useSimulatorExternalControl({
          ...params,
          compileAndStartAction: action,
          backendReachable: ready,
          isConnected: ready,
        }),
      { initialProps: { action: firstAction, ready: false } },
    );

    act(() => useExternalApi.mock.calls[0][0].onStartSimulation());
    rerender({ action: firstAction, ready: true });
    expect(result.current.pendingExternalStart).toBe(false);
    expect(firstAction).toHaveBeenCalledOnce();

    const latestCallbacks = useExternalApi.mock.calls.at(-1)[0];
    act(() => latestCallbacks.onStartSimulation());
    expect(firstAction).toHaveBeenCalledTimes(2);
  });

  it("starts directly exactly once when prerequisites are already ready", () => {
    const params = buildParams();
    renderHook(() => useSimulatorExternalControl(params));

    act(() => useExternalApi.mock.calls[0][0].onStartSimulation());

    expect(params.compileAndStartAction).toHaveBeenCalledOnce();
  });

  it("keeps a pending start while either readiness prerequisite is missing", () => {
    const params = buildParams({ backendReachable: false, isConnected: false });
    const action = vi.fn();
    const { result, rerender } = renderHook(
      ({ connected, reachable }: { connected: boolean; reachable: boolean }) =>
        useSimulatorExternalControl({
          ...params,
          compileAndStartAction: action,
          isConnected: connected,
          backendReachable: reachable,
        }),
      { initialProps: { connected: false, reachable: false } },
    );

    act(() => useExternalApi.mock.calls[0][0].onStartSimulation());
    rerender({ connected: true, reachable: false });
    expect(result.current.pendingExternalStart).toBe(true);
    expect(action).not.toHaveBeenCalled();

    rerender({ connected: true, reachable: true });
    expect(result.current.pendingExternalStart).toBe(false);
    expect(action).toHaveBeenCalledOnce();
  });

  it("exposes current simulation state and routes external pin and stop actions", () => {
    const params = buildParams();
    renderHook(() => useSimulatorExternalControl(params));
    const callbacks = useExternalApi.mock.calls[0][0];

    expect(callbacks.getSimulationState()).toBe("IDLE");
    expect(callbacks.getPinState(13)).toBe(1);

    callbacks.onSetPinState(13, 0);
    callbacks.onStopSimulation();

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "set_pin_value", pin: 13, value: 0 });
    expect(params.handleStop).toHaveBeenCalledOnce();
    expect(emitServerStatusEvent).toHaveBeenCalledWith({
      serverReachable: true,
      sandboxRunners: params.serverStatus.sandboxRunners,
      compileSlots: params.serverStatus.compileSlots,
    });
  });
});
