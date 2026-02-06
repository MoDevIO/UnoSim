import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePinState } from "../../../client/src/hooks/use-pin-state";

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
};

describe("usePinState", () => {
  const mockResetPinStates = vi.fn();

  beforeAll(() => {
    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
      vi.stubGlobal("localStorage", createLocalStorageMock());
    }
  });

  beforeEach(() => {
    localStorage.clear();
    mockResetPinStates.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with default values", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.analogPinsUsed).toEqual([]);
    expect(result.current.detectedPinModes).toEqual({});
    expect(result.current.pendingPinConflicts).toEqual([]);
    expect(result.current.pinMonitorVisible).toBe(false);
  });

  it("should read pinMonitorVisible from localStorage on mount", () => {
    localStorage.setItem("unoPinMonitorVisible", "1");

    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinMonitorVisible).toBe(true);
  });

  it("should update analogPinsUsed state", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    act(() => {
      result.current.setAnalogPinsUsed([14, 15, 16]);
    });

    expect(result.current.analogPinsUsed).toEqual([14, 15, 16]);
  });

  it("should update detectedPinModes state", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    act(() => {
      result.current.setDetectedPinModes({ 13: "OUTPUT", 2: "INPUT" });
    });

    expect(result.current.detectedPinModes).toEqual({
      13: "OUTPUT",
      2: "INPUT",
    });
  });

  it("should update pendingPinConflicts state", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    act(() => {
      result.current.setPendingPinConflicts([14, 15]);
    });

    expect(result.current.pendingPinConflicts).toEqual([14, 15]);
  });

  it("should reset all pin state when resetPinUI is called without options", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    act(() => {
      result.current.setAnalogPinsUsed([14, 15]);
      result.current.setDetectedPinModes({ 13: "OUTPUT" });
      result.current.setPendingPinConflicts([14]);
    });

    expect(result.current.analogPinsUsed).toEqual([14, 15]);

    act(() => {
      result.current.resetPinUI();
    });

    expect(mockResetPinStates).toHaveBeenCalledTimes(1);
    expect(result.current.analogPinsUsed).toEqual([]);
    expect(result.current.detectedPinModes).toEqual({});
    expect(result.current.pendingPinConflicts).toEqual([]);
  });

  it("should preserve detected state when resetPinUI is called with keepDetected: true", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    act(() => {
      result.current.setAnalogPinsUsed([14, 15]);
      result.current.setDetectedPinModes({ 13: "OUTPUT" });
      result.current.setPendingPinConflicts([14]);
    });

    act(() => {
      result.current.resetPinUI({ keepDetected: true });
    });

    expect(mockResetPinStates).toHaveBeenCalledTimes(1);
    expect(result.current.analogPinsUsed).toEqual([14, 15]); // preserved
    expect(result.current.detectedPinModes).toEqual({ 13: "OUTPUT" }); // preserved
    expect(result.current.pendingPinConflicts).toEqual([14]); // preserved
  });

  it("should convert digital pin strings to numbers", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinToNumber("13")).toBe(13);
    expect(result.current.pinToNumber("0")).toBe(0);
    expect(result.current.pinToNumber("7")).toBe(7);
  });

  it("should convert analog pin strings to internal numbers (A0=14, A5=19)", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinToNumber("A0")).toBe(14);
    expect(result.current.pinToNumber("A1")).toBe(15);
    expect(result.current.pinToNumber("A2")).toBe(16);
    expect(result.current.pinToNumber("A3")).toBe(17);
    expect(result.current.pinToNumber("A4")).toBe(18);
    expect(result.current.pinToNumber("A5")).toBe(19);
  });

  it("should return null for invalid pin strings", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinToNumber("A6")).toBeNull();
    expect(result.current.pinToNumber("invalid")).toBeNull();
    expect(result.current.pinToNumber("")).toBeNull();
  });

  it("should handle case-insensitive analog pins", () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinToNumber("a0")).toBe(14);
    expect(result.current.pinToNumber("a3")).toBe(17);
  });

  it("should listen for pinMonitorVisibleChange custom event", async () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    expect(result.current.pinMonitorVisible).toBe(false);

    // Dispatch custom event to change pin monitor visibility
    act(() => {
      const event = new CustomEvent("pinMonitorVisibleChange", {
        detail: { value: true },
      });
      document.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(result.current.pinMonitorVisible).toBe(true);
    });
  });

  it("should handle malformed pinMonitorVisibleChange event gracefully", async () => {
    const { result } = renderHook(() =>
      usePinState({ resetPinStates: mockResetPinStates }),
    );

    // Dispatch invalid event (no detail)
    act(() => {
      const event = new CustomEvent("pinMonitorVisibleChange");
      document.dispatchEvent(event);
    });

    // pinMonitorVisible should remain unchanged
    expect(result.current.pinMonitorVisible).toBe(false);
  });
});
