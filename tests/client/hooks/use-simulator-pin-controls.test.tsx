import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulatorPinControls } from "../../../client/src/hooks/useSimulatorPinControls";
import type { PinState } from "../../../client/src/hooks/use-simulation-store";

const createParams = (overrides: Record<string, unknown> = {}) => ({
  sendMessage: vi.fn(),
  simulationStatus: "running" as const,
  toast: vi.fn(),
  setPinStates: vi.fn(),
  ...overrides,
});

describe("useSimulatorPinControls", () => {
  describe("handlePinToggle", () => {
    it("sends set_pin_value message and updates local state", () => {
      const params = createParams();
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handlePinToggle(13, 1);
      });

      expect(params.sendMessage).toHaveBeenCalledWith({
        type: "set_pin_value",
        pin: 13,
        value: 1,
      });
      expect(params.setPinStates).toHaveBeenCalled();
    });

    it("shows toast and does not send when simulation is idle", () => {
      const params = createParams({ simulationStatus: "idle" });
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handlePinToggle(13, 1);
      });

      expect(params.sendMessage).not.toHaveBeenCalled();
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Simulation not active" }),
      );
    });

    it("updates existing pin value in local state", () => {
      const existing: PinState[] = [
        { pin: 13, mode: "OUTPUT", value: 0, type: "digital" },
      ];
      const setPinStates = vi.fn((updater: (prev: PinState[]) => PinState[]) => {
        const result = updater(existing);
        expect(result[0]?.value).toBe(1);
      });
      const params = createParams({ setPinStates });
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handlePinToggle(13, 1);
      });

      expect(setPinStates).toHaveBeenCalled();
    });
  });

  describe("handleAnalogChange", () => {
    it("sends set_pin_value message for analog pin", () => {
      const params = createParams();
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handleAnalogChange(14, 512);
      });

      expect(params.sendMessage).toHaveBeenCalledWith({
        type: "set_pin_value",
        pin: 14,
        value: 512,
      });
    });

    it("shows toast when simulation is idle", () => {
      const params = createParams({ simulationStatus: "idle" });
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handleAnalogChange(14, 512);
      });

      expect(params.sendMessage).not.toHaveBeenCalled();
      expect(params.toast).toHaveBeenCalled();
    });

    it("updates existing analog pin in local state", () => {
      const existing: PinState[] = [
        { pin: 14, mode: "INPUT", value: 0, type: "analog" },
      ];
      const setPinStates = vi.fn((updater: (prev: PinState[]) => PinState[]) => {
        const result = updater(existing);
        expect(result[0]?.value).toBe(768);
        expect(result[0]?.type).toBe("analog");
      });
      const params = createParams({ setPinStates });
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handleAnalogChange(14, 768);
      });

      expect(setPinStates).toHaveBeenCalled();
    });

    it("pushes new pin state when pin not found", () => {
      const existing: PinState[] = [];
      const setPinStates = vi.fn((updater: (prev: PinState[]) => PinState[]) => {
        const result = updater(existing);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
          expect.objectContaining({ pin: 15, value: 300, type: "analog" }),
        );
      });
      const params = createParams({ setPinStates });
      const { result } = renderHook(() => useSimulatorPinControls(params));

      act(() => {
        result.current.handleAnalogChange(15, 300);
      });

      expect(setPinStates).toHaveBeenCalled();
    });
  });
});
