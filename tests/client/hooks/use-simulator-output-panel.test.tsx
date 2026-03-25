import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSimulatorOutputPanel } from "../../../client/src/hooks/useSimulatorOutputPanel";
import type { ParserMessage } from "../../../shared/schema";

describe("useSimulatorOutputPanel", () => {
  const mockSetShowCompilationOutput = vi.fn();
  const mockSetParserPanelDismissed = vi.fn();
  const mockSetActiveOutputTab = vi.fn();
  const mockParserMessagesContainerRef = { current: null };

  const defaultProps = {
    hasCompilationErrors: false,
    cliOutput: "",
    parserMessages: [] as ParserMessage[],
    lastCompilationResult: null as string | null,
    parserMessagesContainerRef: mockParserMessagesContainerRef,
    showCompilationOutput: false,
    setShowCompilationOutput: mockSetShowCompilationOutput,
    setParserPanelDismissed: mockSetParserPanelDismissed,
    setActiveOutputTab: mockSetActiveOutputTab,
    code: "",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockSetShowCompilationOutput.mockClear();
    mockSetParserPanelDismissed.mockClear();
    mockSetActiveOutputTab.mockClear();
    if (!globalThis.localStorage) {
      vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(() => null),
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should return all expected API properties", () => {
    const { result } = renderHook(() => useSimulatorOutputPanel(defaultProps));

    expect(result.current.outputPanelRef).toBeDefined();
    expect(result.current.outputTabsHeaderRef).toBeDefined();
    expect(result.current.compilationPanelSize).toBe(3);
    expect(result.current.outputPanelMinPercent).toBe(3);
    expect(result.current.openOutputPanel).toBeInstanceOf(Function);
    expect(result.current.handleOutputTabChange).toBeInstanceOf(Function);
    expect(result.current.handleOutputCloseOrMinimize).toBeInstanceOf(Function);
    expect(result.current.handleParserMessagesClear).toBeInstanceOf(Function);
    expect(result.current.handleParserGoToLine).toBeInstanceOf(Function);
    expect(result.current.handleRegistryClear).toBeInstanceOf(Function);
  });

  it("handleOutputTabChange calls setActiveOutputTab with the given tab", () => {
    const { result } = renderHook(() => useSimulatorOutputPanel(defaultProps));

    act(() => {
      result.current.handleOutputTabChange("compiler");
    });
    expect(mockSetActiveOutputTab).toHaveBeenCalledWith("compiler");

    act(() => {
      result.current.handleOutputTabChange("messages");
    });
    expect(mockSetActiveOutputTab).toHaveBeenCalledWith("messages");

    act(() => {
      result.current.handleOutputTabChange("registry");
    });
    expect(mockSetActiveOutputTab).toHaveBeenCalledWith("registry");

    act(() => {
      result.current.handleOutputTabChange("debug");
    });
    expect(mockSetActiveOutputTab).toHaveBeenCalledWith("debug");
  });

  it("handleParserMessagesClear calls setParserPanelDismissed(true)", () => {
    const { result } = renderHook(() => useSimulatorOutputPanel(defaultProps));

    act(() => {
      result.current.handleParserMessagesClear();
    });
    expect(mockSetParserPanelDismissed).toHaveBeenCalledWith(true);
  });

  it("handleParserGoToLine calls console.debug (no throw)", () => {
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { result } = renderHook(() => useSimulatorOutputPanel(defaultProps));

    act(() => {
      result.current.handleParserGoToLine(42);
    });
    expect(consoleSpy).toHaveBeenCalledWith("Go to line: 42");
    consoleSpy.mockRestore();
  });

  it("handleRegistryClear is a no-op function", () => {
    const { result } = renderHook(() => useSimulatorOutputPanel(defaultProps));

    expect(() => {
      act(() => {
        result.current.handleRegistryClear();
      });
    }).not.toThrow();
  });

  it("handleOutputCloseOrMinimize: when panel is minimized, hides and dismisses", () => {
    const { result } = renderHook(() =>
      useSimulatorOutputPanel({
        ...defaultProps,
        showCompilationOutput: true,
      }),
    );

    // Simulate panel is minimized (size <= minPercent + 1)
    // Default minPercent is 3, so size=3 means minimized
    const mockGetSize = vi.fn(() => 3);
    (result.current.outputPanelRef as any).current = { getSize: mockGetSize };

    act(() => {
      result.current.handleOutputCloseOrMinimize();
    });

    expect(mockSetShowCompilationOutput).toHaveBeenCalledWith(false);
    expect(mockSetParserPanelDismissed).toHaveBeenCalledWith(true);
    expect(result.current.outputPanelManuallyResizedRef.current).toBe(false);
  });

  it("handleOutputCloseOrMinimize: when panel is NOT minimized, minimizes it", () => {
    const { result } = renderHook(() =>
      useSimulatorOutputPanel({
        ...defaultProps,
        showCompilationOutput: true,
      }),
    );

    // Panel is open at a large size (not minimized)
    const mockGetSize = vi.fn(() => 50);
    const mockResize = vi.fn();
    (result.current.outputPanelRef as any).current = {
      getSize: mockGetSize,
      resize: mockResize,
    };

    act(() => {
      result.current.handleOutputCloseOrMinimize();
    });

    // Should minimize to 3 (compilationPanelSize = 3)
    expect(result.current.compilationPanelSize).toBe(3);
    expect(result.current.outputPanelManuallyResizedRef.current).toBe(false);
    // Should call resize with the min percent
    expect(mockResize).toHaveBeenCalled();
  });

  it("handleOutputCloseOrMinimize: when outputPanelRef has no resize, skips resize", () => {
    const { result } = renderHook(() =>
      useSimulatorOutputPanel({
        ...defaultProps,
        showCompilationOutput: true,
      }),
    );

    // Panel at a large size, but no resize method
    const mockGetSize = vi.fn(() => 50);
    (result.current.outputPanelRef as any).current = { getSize: mockGetSize };

    expect(() => {
      act(() => {
        result.current.handleOutputCloseOrMinimize();
      });
    }).not.toThrow();

    expect(result.current.compilationPanelSize).toBe(3);
  });

  it("compilationState derives to null when lastCompilationResult is neither success nor error", () => {
    const { result } = renderHook(() =>
      useSimulatorOutputPanel({ ...defaultProps, lastCompilationResult: null }),
    );
    // compilationPanelSize starts at 3 (no trigger)
    expect(result.current.compilationPanelSize).toBe(3);
  });

  it("compilationState derives to success when lastCompilationResult is success", () => {
    const { result, rerender } = renderHook(
      (props) => useSimulatorOutputPanel(props),
      { initialProps: defaultProps },
    );

    act(() => {
      rerender({
        ...defaultProps,
        lastCompilationResult: "success",
        hasCompilationErrors: false,
        parserMessages: [],
      });
      vi.runAllTimers();
    });

    expect(result.current.compilationPanelSize).toBe(3); // minimized on success
  });
});
