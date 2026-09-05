import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSimulatorExternalControl } from "../../../client/src/hooks/useSimulatorExternalControl";

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
    pool: { total: 1, available: 1, inUse: 0, queued: 0 },
    compile: { active: 0, queued: 0, maxConcurrent: 1 },
  },
  ...overrides,
});

describe("useSimulatorExternalControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      pool: params.serverStatus.pool,
      compile: params.serverStatus.compile,
    });
  });
});