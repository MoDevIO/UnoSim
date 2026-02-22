import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSerialIO } from "../../../client/src/hooks/use-serial-io";
import type { OutputLine } from "@shared/schema";

describe("useSerialIO", () => {
  it("should initialize with default values", () => {
    const { result } = renderHook(() => useSerialIO());

    expect(result.current.serialOutput).toEqual([]);
    expect(result.current.serialViewMode).toBe("monitor");
    expect(result.current.autoScrollEnabled).toBe(true);
    expect(result.current.serialInputValue).toBe("");
    expect(result.current.showSerialMonitor).toBe(true);
    expect(result.current.showSerialPlotter).toBe(false);
  });

  it("should update serial output", () => {
    const { result } = renderHook(() => useSerialIO());

    const testOutput: OutputLine[] = [
      { type: "serial", content: "Hello", timestamp: Date.now() },
      { type: "serial", content: "World", timestamp: Date.now() },
    ];

    act(() => {
      result.current.setSerialOutput(testOutput);
    });

    expect(result.current.serialOutput).toEqual(testOutput);
  });

  it("should clear serial output", () => {
    const { result } = renderHook(() => useSerialIO());

    const testOutput: OutputLine[] = [
      { type: "serial", content: "Test", timestamp: Date.now() },
    ];

    act(() => {
      result.current.setSerialOutput(testOutput);
    });

    expect(result.current.serialOutput).toHaveLength(1);

    act(() => {
      result.current.clearSerialOutput();
    });

    expect(result.current.serialOutput).toEqual([]);
  });

  it("should cycle serial view mode from monitor to both", () => {
    const { result } = renderHook(() => useSerialIO());

    expect(result.current.serialViewMode).toBe("monitor");
    expect(result.current.showSerialMonitor).toBe(true);
    expect(result.current.showSerialPlotter).toBe(false);

    act(() => {
      result.current.cycleSerialViewMode();
    });

    expect(result.current.serialViewMode).toBe("both");
    expect(result.current.showSerialMonitor).toBe(true);
    expect(result.current.showSerialPlotter).toBe(true);
  });

  it("should cycle serial view mode from both to plotter", () => {
    const { result } = renderHook(() => useSerialIO());

    act(() => {
      result.current.setSerialViewMode("both");
    });

    expect(result.current.serialViewMode).toBe("both");

    act(() => {
      result.current.cycleSerialViewMode();
    });

    expect(result.current.serialViewMode).toBe("plotter");
    expect(result.current.showSerialMonitor).toBe(false);
    expect(result.current.showSerialPlotter).toBe(true);
  });

  it("should cycle serial view mode from plotter to monitor", () => {
    const { result } = renderHook(() => useSerialIO());

    act(() => {
      result.current.setSerialViewMode("plotter");
    });

    expect(result.current.serialViewMode).toBe("plotter");

    act(() => {
      result.current.cycleSerialViewMode();
    });

    expect(result.current.serialViewMode).toBe("monitor");
    expect(result.current.showSerialMonitor).toBe(true);
    expect(result.current.showSerialPlotter).toBe(false);
  });

  it("should toggle auto scroll", () => {
    const { result } = renderHook(() => useSerialIO());

    expect(result.current.autoScrollEnabled).toBe(true);

    act(() => {
      result.current.setAutoScrollEnabled(false);
    });

    expect(result.current.autoScrollEnabled).toBe(false);

    act(() => {
      result.current.setAutoScrollEnabled(true);
    });

    expect(result.current.autoScrollEnabled).toBe(true);
  });

  it("should update serial input value", () => {
    const { result } = renderHook(() => useSerialIO());

    expect(result.current.serialInputValue).toBe("");

    act(() => {
      result.current.setSerialInputValue("AT+TEST");
    });

    expect(result.current.serialInputValue).toBe("AT+TEST");
  });

  it("should compute showSerialMonitor correctly for all view modes", () => {
    const { result } = renderHook(() => useSerialIO());

    // monitor mode
    act(() => {
      result.current.setSerialViewMode("monitor");
    });
    expect(result.current.showSerialMonitor).toBe(true);

    // both mode
    act(() => {
      result.current.setSerialViewMode("both");
    });
    expect(result.current.showSerialMonitor).toBe(true);

    // plotter mode
    act(() => {
      result.current.setSerialViewMode("plotter");
    });
    expect(result.current.showSerialMonitor).toBe(false);
  });

  it("should compute showSerialPlotter correctly for all view modes", () => {
    const { result } = renderHook(() => useSerialIO());

    // monitor mode
    act(() => {
      result.current.setSerialViewMode("monitor");
    });
    expect(result.current.showSerialPlotter).toBe(false);

    // both mode
    act(() => {
      result.current.setSerialViewMode("both");
    });
    expect(result.current.showSerialPlotter).toBe(true);

    // plotter mode
    act(() => {
      result.current.setSerialViewMode("plotter");
    });
    expect(result.current.showSerialPlotter).toBe(true);
  });

  it("should bypass renderer in test mode", () => {
    // simulate Playwright environment flag
    (window as any).__PLAYWRIGHT_TEST__ = true;

    const { result } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("LED ON");
    });

    // in test mode output should appear immediately
    expect(result.current.renderedSerialText).toBe("LED ON");

    delete (window as any).__PLAYWRIGHT_TEST__;
  });

  it("should maintain callback reference stability", () => {
    const { result, rerender } = renderHook(() => useSerialIO());

    const cycleViewModeRef = result.current.cycleSerialViewMode;
    const clearOutputRef = result.current.clearSerialOutput;

    rerender();

    // useCallback should maintain reference
    expect(result.current.cycleSerialViewMode).toBe(cycleViewModeRef);
    expect(result.current.clearSerialOutput).toBe(clearOutputRef);
  });
});
