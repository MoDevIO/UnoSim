import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitSerialOutput } from "@/hooks/use-external-api";
import { useSerialIO } from "@/hooks/use-serial-io";

vi.mock("@/hooks/use-external-api", () => ({
  emitSerialOutput: vi.fn(),
}));

const texts = (output: ReadonlyArray<{ text: string }>) => output.map((line) => line.text);

describe("useSerialIO with several hardware serial ports (plan P5.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).__PLAYWRIGHT_TEST__ = true;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__PLAYWRIGHT_TEST__;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts with Serial selected and one port", () => {
    const { result } = renderHook(() => useSerialIO());

    expect(result.current.serialPort).toBe(0);
    expect(result.current.serialPortCount).toBe(1);
  });

  it("keeps the text of each port apart and shows the selected one", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => result.current.setSerialPortCount(4));

    act(() => {
      result.current.appendSerialOutput("zero\n");
      result.current.appendSerialOutput("one\n", 1);
      result.current.appendSerialOutput("three\n", 3);
    });
    expect(texts(result.current.renderedSerialOutput)).toEqual(["zero", ""]);

    act(() => result.current.setSerialPort(1));
    expect(texts(result.current.renderedSerialOutput)).toEqual(["one", ""]);

    act(() => result.current.setSerialPort(3));
    expect(texts(result.current.renderedSerialOutput)).toEqual(["three", ""]);

    act(() => result.current.setSerialPort(2));
    expect(result.current.renderedSerialOutput).toEqual([]);
  });

  it("falls back to Serial when the board has fewer ports than the selected one", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => result.current.setSerialPortCount(4));
    act(() => {
      result.current.appendSerialOutput("zero\n");
      result.current.appendSerialOutput("two\n", 2);
      result.current.setSerialPort(2);
    });
    expect(result.current.serialPort).toBe(2);

    act(() => result.current.setSerialPortCount(1));

    expect(result.current.serialPort).toBe(0);
    expect(texts(result.current.renderedSerialOutput)).toEqual(["zero", ""]);
  });

  it("shows a system line on every port of the board", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => result.current.setSerialPortCount(4));
    act(() => result.current.appendSerialOutput("two\n", 2));

    act(() => result.current.appendRenderedText("--- Simulation stopped ---\n"));

    for (const port of [0, 1, 2, 3]) {
      act(() => result.current.setSerialPort(port));
      expect(texts(result.current.renderedSerialOutput).filter(Boolean)).toContain("--- Simulation stopped ---");
    }
    act(() => result.current.setSerialPort(2));
    expect(texts(result.current.renderedSerialOutput)).toEqual(["two", "--- Simulation stopped ---", ""]);
  });

  it("clears one port, or all ports when none is named", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => result.current.setSerialPortCount(4));
    act(() => {
      result.current.appendSerialOutput("zero\n");
      result.current.appendSerialOutput("one\n", 1);
      result.current.appendSerialOutput("two\n", 2);
    });

    act(() => result.current.clearSerialOutput(1));
    act(() => result.current.setSerialPort(1));
    expect(result.current.renderedSerialOutput).toEqual([]);
    act(() => result.current.setSerialPort(2));
    expect(texts(result.current.renderedSerialOutput)).toEqual(["two", ""]);

    act(() => result.current.clearSerialOutput());
    expect(result.current.renderedSerialOutput).toEqual([]);
    act(() => result.current.setSerialPort(0));
    expect(result.current.renderedSerialOutput).toEqual([]);
  });

  it("does not touch the line list of the plotter for another port", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => result.current.setSerialPortCount(4));
    act(() => result.current.setSerialOutput([{ text: "1", complete: true }]));

    act(() => result.current.clearSerialOutput(2));

    expect(result.current.serialOutput).toEqual([{ text: "1", complete: true }]);
  });

  it("reports the output of each port to the parent frame, port 0 as before", () => {
    const { result } = renderHook(() => useSerialIO());
    act(() => {
      result.current.appendSerialOutput("a|");
      result.current.appendSerialOutput("b|", 1);
      result.current.appendSerialOutput("c|", 1);
      result.current.appendSerialOutput("d|", 3);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(vi.mocked(emitSerialOutput).mock.calls).toEqual([["a|"], ["b|c|", 1], ["d|", 3]]);
  });
});
