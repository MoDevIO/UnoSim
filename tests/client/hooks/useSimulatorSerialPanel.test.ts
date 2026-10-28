import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulatorSerialPanel } from "@/hooks/useSimulatorSerialPanel";
import { getServerCapabilities } from "@/lib/server-capabilities";

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
  it("does not send serial input while the backend is offline", () => {
    const params = createParams({ capabilities: getServerCapabilities(false) });
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => result.current.handleSerialSend("hello"));

    expect(params.sendMessage).not.toHaveBeenCalled();
    expect(params.setTxActivity).not.toHaveBeenCalled();
    expect(params.setSerialInputValue).not.toHaveBeenCalled();
    expect(params.toast).not.toHaveBeenCalled();
  });

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

  it("shows toast when simulation is idle", () => {
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

describe("useSimulatorSerialPanel with several serial ports (plan P5.3)", () => {
  it("sends to the given port and names the port only when it is not Serial", () => {
    const params = createParams();
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => result.current.handleSerialSend("to one", 1));
    act(() => result.current.handleSerialSend("to zero", 0));
    act(() => result.current.handleSerialSend("default"));

    expect(params.sendMessage.mock.calls).toEqual([
      [{ type: "serial_input", data: "to one", port: 1 }],
      [{ type: "serial_input", data: "to zero" }],
      [{ type: "serial_input", data: "default" }],
    ]);
  });

  it("sends the typed text to the port the monitor shows when Enter is pressed", () => {
    const params = createParams({ serialPort: 3 });
    const { result } = renderHook(() => useSimulatorSerialPanel(params));

    act(() => result.current.handleSerialInputKeyDown({ key: "Enter" } as never));

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "serial_input", data: "hello", port: 3 });
  });

  it("clears the port the monitor shows", () => {
    const shown = createParams({ serialPort: 2 });
    const { result } = renderHook(() => useSimulatorSerialPanel(shown));
    act(() => result.current.handleClearSerialOutput());
    expect(shown.clearSerialOutput).toHaveBeenCalledWith(2);

    const serial = createParams();
    const { result: second } = renderHook(() => useSimulatorSerialPanel(serial));
    act(() => second.current.handleClearSerialOutput());
    expect(serial.clearSerialOutput).toHaveBeenCalledWith();
  });
});
