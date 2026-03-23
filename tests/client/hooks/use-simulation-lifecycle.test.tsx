import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulationLifecycle } from "../../../client/src/hooks/use-simulation-lifecycle";

describe("useSimulationLifecycle", () => {
  it("stops simulation on code change when running", async () => {
    const sendMessage = vi.fn();
    const setSimulationStatus = vi.fn();
    const resetPinUI = vi.fn();

    const { rerender } = renderHook(
      ({ code, status }) =>
        useSimulationLifecycle({
          code,
          simulationStatus: status,
          setSimulationStatus,
          sendMessage,
          resetPinUI,
        }),
      { initialProps: { code: "a", status: "running" } },
    );

    // change code -> should trigger stop
    await act(async () => {
      rerender({ code: "b", status: "running" });
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(setSimulationStatus).toHaveBeenCalledWith("stopped");
    // resetPinUI should be called at least once (preserve detected)
    expect(resetPinUI).toHaveBeenCalled();
  });

  it("suppressAutoStopOnce prevents stopping on next edit", async () => {
    const sendMessage = vi.fn();
    const setSimulationStatus = vi.fn();
    const resetPinUI = vi.fn();

    const { result, rerender } = renderHook(
      ({ code, status }) =>
        useSimulationLifecycle({
          code,
          simulationStatus: status,
          setSimulationStatus,
          sendMessage,
          resetPinUI,
        }),
      { initialProps: { code: "a", status: "running" } },
    );

    act(() => {
      result.current.suppressAutoStopOnce();
    });

    await act(async () => {
      rerender({ code: "b", status: "running" });
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(setSimulationStatus).not.toHaveBeenCalled();
  });

  it("stops simulation when compilation errors appear", async () => {
    const sendMessage = vi.fn();
    const setSimulationStatus = vi.fn();
    const resetPinUI = vi.fn();

    const { rerender } = renderHook(
      ({ hasErr, status }) =>
        useSimulationLifecycle({
          code: "x",
          simulationStatus: status,
          setSimulationStatus,
          sendMessage,
          resetPinUI,
          hasCompilationErrors: hasErr,
        }),
      { initialProps: { hasErr: false, status: "running" } },
    );

    await act(async () => {
      rerender({ hasErr: true, status: "running" });
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(setSimulationStatus).toHaveBeenCalledWith("stopped");
  });
});
