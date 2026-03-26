import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulatorSerialPanel } from "@/hooks/useSimulatorSerialPanel";

function createParams(overrides: Partial<Parameters<typeof useSimulatorSerialPanel>[0]> = {}) {
  return {
    sendMessage: vi.fn(),
    simulationStatus: "running" as const,
    toast: vi.fn(),
    setTxActivity: vi.fn(),
    serialInputValue: "hello",
    setSerialInputValue: vi.fn(),
    clearSerialOutput: vi.fn(),
    ensureBackendConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe("useSimulatorSerialPanel", () => {
  it("sends serial message when running", () => {
    const params = createParams();
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialSend("test msg");
    });

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "serial_input", data: "test msg" });
    expect(params.setSerialInputValue).toHaveBeenCalledWith("");
    expect(params.setTxActivity).toHaveBeenCalled();
  });

  it("blocks send when not connected", () => {
    const params = createParams({
      ensureBackendConnected: vi.fn().mockReturnValue(false),
    });
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialSend("test");
    });

    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("shows toast when simulation is stopped", () => {
    const params = createParams({ simulationStatus: "idle" as any });
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialSend("test");
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("shows toast when simulation is paused", () => {
    const params = createParams({ simulationStatus: "paused" as any });
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialSend("test");
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Simulation paused" }),
    );
  });

  it("handleSerialInputKeyDown triggers send on Enter", () => {
    const params = createParams();
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialInputKeyDown({
        key: "Enter",
      } as any);
    });

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "serial_input", data: "hello" });
  });

  it("handleSerialInputKeyDown ignores non-Enter keys", () => {
    const params = createParams();
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleSerialInputKeyDown({ key: "a" } as any);
    });

    expect(params.sendMessage).not.toHaveBeenCalled();
  });

  it("handleClearSerialOutput calls clearSerialOutput", () => {
    const params = createParams();
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => {
      result.current.handleClearSerialOutput();
    });

    expect(params.clearSerialOutput).toHaveBeenCalled();
  });
});
