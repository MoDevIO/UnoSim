import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitSerialOutput } from "@/hooks/use-external-api";
import { useSerialIO } from "@/hooks/use-serial-io";

vi.mock("@/hooks/use-external-api", () => ({
  emitSerialOutput: vi.fn(),
}));

describe("useSerialIO external output liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).__PLAYWRIGHT_TEST__ = true;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__PLAYWRIGHT_TEST__;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("emits a single chunk after the bounded window", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("single");
    });
    expect(vi.mocked(emitSerialOutput)).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(vi.mocked(emitSerialOutput)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitSerialOutput)).toHaveBeenCalledWith("single");
    unmount();
  });

  it("combines chunks within one window in order", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("first|");
      vi.advanceTimersByTime(50);
      result.current.appendSerialOutput("second|");
    });

    expect(vi.mocked(emitSerialOutput)).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(vi.mocked(emitSerialOutput)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitSerialOutput)).toHaveBeenCalledWith("first|second|");
    unmount();
  });

  it("emits at least one external event while output remains continuous", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      for (let index = 0; index < 10; index += 1) {
        result.current.appendSerialOutput(`chunk-${index}|`);
        vi.advanceTimersByTime(50);
      }
    });

    expect(vi.mocked(emitSerialOutput)).toHaveBeenCalled();
    unmount();
  });

  it("starts another flush window after the first one", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("window-one|");
      vi.advanceTimersByTime(100);
      result.current.appendSerialOutput("window-two|");
      vi.advanceTimersByTime(100);
    });

    expect(vi.mocked(emitSerialOutput).mock.calls.map(([output]) => output)).toEqual([
      "window-one|",
      "window-two|",
    ]);
    unmount();
  });

  it("cleans up a pending external flush on unmount", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("discarded-after-unmount");
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(vi.mocked(emitSerialOutput)).not.toHaveBeenCalled();
  });

  it("keeps UI serial rendering independent from external flushing", () => {
    const { result, unmount } = renderHook(() => useSerialIO());

    act(() => {
      result.current.appendSerialOutput("visible-now");
    });

    expect(result.current.renderedSerialText).toBe("visible-now");
    expect(vi.mocked(emitSerialOutput)).not.toHaveBeenCalled();
    unmount();
  });
});
