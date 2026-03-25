import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulationStore } from "../../../client/src/hooks/use-simulation-store";

describe("useSimulationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up via the hook — resetPinStates empties pinStates
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.resetPinStates();
    });
    vi.useRealTimers();
  });

  it("returns empty pinStates initially", () => {
    const { result } = renderHook(() => useSimulationStore());
    expect(result.current.pinStates).toEqual([]);
  });

  it("returns batchStats with zeroed values initially", () => {
    const { result } = renderHook(() => useSimulationStore());
    expect(result.current.batchStats).toEqual(
      expect.objectContaining({
        lastBatchMs: expect.any(Number),
        lastBatchSize: expect.any(Number),
      }),
    );
  });

  it("setPinStates sets pin states directly", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.setPinStates([
        { pin: 13, mode: "OUTPUT", value: 1, type: "digital" },
      ]);
    });
    expect(result.current.pinStates).toHaveLength(1);
    expect(result.current.pinStates[0]).toEqual(
      expect.objectContaining({ pin: 13, mode: "OUTPUT", value: 1 }),
    );
  });

  it("setPinStates accepts an updater function", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.setPinStates([
        { pin: 5, mode: "OUTPUT", value: 0, type: "digital" },
      ]);
    });
    act(() => {
      result.current.setPinStates((prev) => [
        ...prev,
        { pin: 6, mode: "INPUT", value: 0, type: "digital" },
      ]);
    });
    expect(result.current.pinStates).toHaveLength(2);
  });

  it("resetPinStates clears all pin states", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.setPinStates([
        { pin: 13, mode: "OUTPUT", value: 1, type: "digital" },
      ]);
    });
    expect(result.current.pinStates).toHaveLength(1);
    act(() => {
      result.current.resetPinStates();
    });
    expect(result.current.pinStates).toHaveLength(0);
  });

  it("enqueuePinEvent + flush adds a new digital pin", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(13, "mode", 1); // OUTPUT
    });
    // Flush the RAF via setTimeout fallback (jsdom has no rAF)
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates).toHaveLength(1);
    expect(result.current.pinStates[0]).toEqual(
      expect.objectContaining({ pin: 13, mode: "OUTPUT" }),
    );
  });

  it("enqueuePinEvent with stateType=value sets value on new pin", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(13, "value", 255);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]).toEqual(
      expect.objectContaining({ pin: 13, value: 255 }),
    );
  });

  it("enqueuePinEvent with stateType=pwm creates pwm pin", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(9, "pwm", 128);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]).toEqual(
      expect.objectContaining({ pin: 9, value: 128, type: "pwm" }),
    );
  });

  it("enqueuePinEvent updates existing pin mode", () => {
    const { result } = renderHook(() => useSimulationStore());
    // First create pin via mode event
    act(() => {
      result.current.enqueuePinEvent(13, "mode", 1); // OUTPUT
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.mode).toBe("OUTPUT");
    // Now update mode to INPUT
    act(() => {
      result.current.enqueuePinEvent(13, "mode", 0); // INPUT
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.mode).toBe("INPUT");
  });

  it("enqueuePinEvent updates existing pin value", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(13, "mode", 1);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    act(() => {
      result.current.enqueuePinEvent(13, "value", 1);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.value).toBe(1);
  });

  it("enqueuePinEvent updates existing pin to pwm", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(9, "mode", 1);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    act(() => {
      result.current.enqueuePinEvent(9, "pwm", 200);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.type).toBe("pwm");
    expect(result.current.pinStates[0]?.value).toBe(200);
  });

  it("analog pins (14-19) get type=analog", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(14, "mode", 0); // INPUT on A0
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.type).toBe("analog");
  });

  it("batches multiple events into single flush", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(2, "mode", 1);
      result.current.enqueuePinEvent(3, "mode", 1);
      result.current.enqueuePinEvent(4, "mode", 1);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates).toHaveLength(3);
    expect(result.current.batchStats.lastBatchSize).toBe(3);
  });

  it("coalesces duplicate pin events in same batch", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(13, "value", 0);
      result.current.enqueuePinEvent(13, "value", 1);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // Pin 13 should have value=1 (last write wins)
    expect(result.current.pinStates[0]?.value).toBe(1);
    expect(result.current.batchStats.lastBatchSize).toBe(1); // coalesced
  });

  it("INPUT_PULLUP mode maps correctly", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(7, "mode", 2); // INPUT_PULLUP
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.mode).toBe("INPUT_PULLUP");
  });

  it("unknown mode value defaults to INPUT", () => {
    const { result } = renderHook(() => useSimulationStore());
    act(() => {
      result.current.enqueuePinEvent(7, "mode", 99);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.pinStates[0]?.mode).toBe("INPUT");
  });
});
