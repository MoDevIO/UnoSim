import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMobileLayout } from "@/hooks/use-mobile-layout";

describe("useMobileLayout", () => {
  let matchMediaMock: any;
  let listeners: any[] = [];

  beforeEach(() => {
    // Mock window.matchMedia
    matchMediaMock = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, handler: any) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: any) => {
        listeners = listeners.filter((l) => l !== handler);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });

    // Reset body overflow
    document.body.style.overflow = "";
  });

  afterEach(() => {
    listeners = [];
    document.body.style.overflow = "";
    vi.clearAllMocks();
  });

  it("should initialize with desktop mode when viewport is wide", () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(max-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });

    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.mobilePanel).toBeNull();
  });

  it("should initialize with mobile mode when viewport is narrow", () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      media: "(max-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });

    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.isMobile).toBe(true);
    expect(result.current.mobilePanel).toBe("code");
  });

  it("should allow changing mobile panel", () => {
    const { result } = renderHook(() => useMobileLayout());

    act(() => {
      result.current.setMobilePanel("serial");
    });

    expect(result.current.mobilePanel).toBe("serial");

    act(() => {
      result.current.setMobilePanel("board");
    });

    expect(result.current.mobilePanel).toBe("board");
  });

  it("should set body overflow to hidden when mobile panel is open", () => {
    const { result } = renderHook(() => useMobileLayout());

    expect(document.body.style.overflow).toBe("");

    act(() => {
      result.current.setMobilePanel("code");
    });

    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      result.current.setMobilePanel(null);
    });

    expect(document.body.style.overflow).toBe("");
  });

  it("should restore previous body overflow when mobile panel closes", () => {
    document.body.style.overflow = "auto";

    const { result } = renderHook(() => useMobileLayout());

    act(() => {
      result.current.setMobilePanel("compile");
    });

    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      result.current.setMobilePanel(null);
    });

    expect(document.body.style.overflow).toBe("auto");
  });

  it("should have default header height of 40", () => {
    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.headerHeight).toBe(40);
  });

  it("should have default overlay z-index of 30", () => {
    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.overlayZ).toBe(30);
  });

  it("should switch to mobile mode and open code panel when media query matches", () => {
    let changeHandler: any;

    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(max-width: 768px)",
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "change") {
          changeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });

    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.mobilePanel).toBeNull();

    // Simulate media query change to mobile
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: true });
      }
    });

    expect(result.current.isMobile).toBe(true);
    expect(result.current.mobilePanel).toBe("code");
  });

  it("should close mobile panel when switching to desktop mode", () => {
    let changeHandler: any;

    matchMediaMock.mockReturnValue({
      matches: true,
      media: "(max-width: 768px)",
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "change") {
          changeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });

    const { result } = renderHook(() => useMobileLayout());

    expect(result.current.isMobile).toBe(true);
    expect(result.current.mobilePanel).toBe("code");

    // Simulate media query change to desktop
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: false });
      }
    });

    expect(result.current.isMobile).toBe(false);
    expect(result.current.mobilePanel).toBeNull();
  });

  it("should cleanup event listeners on unmount", () => {
    const removeEventListener = vi.fn();
    const removeListener = vi.fn();

    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(max-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener,
      addListener: vi.fn(),
      removeListener,
    });

    const { unmount } = renderHook(() => useMobileLayout());

    unmount();

    // Should call one of the remove methods
    expect(removeEventListener.mock.calls.length + removeListener.mock.calls.length).toBeGreaterThan(0);
  });

  it("should handle different mobile panel values", () => {
    const { result } = renderHook(() => useMobileLayout());

    const panels: Array<"code" | "compile" | "serial" | "board" | null> = [
      "code",
      "compile",
      "serial",
      "board",
      null,
    ];

    panels.forEach((panel) => {
      act(() => {
        result.current.setMobilePanel(panel);
      });

      expect(result.current.mobilePanel).toBe(panel);
    });
  });

  it("should restore body overflow on unmount", () => {
    document.body.style.overflow = "scroll";

    const { result, unmount } = renderHook(() => useMobileLayout());

    act(() => {
      result.current.setMobilePanel("serial");
    });

    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("scroll");
  });

  it("should use addListener fallback for older browsers", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(max-width: 768px)",
      addEventListener: undefined,
      removeEventListener: undefined,
      addListener,
      removeListener,
    });

    const { unmount } = renderHook(() => useMobileLayout());

    expect(addListener).toHaveBeenCalled();

    unmount();

    expect(removeListener).toHaveBeenCalled();
  });

  it("should not open code panel when switching to mobile if a panel is already open", () => {
    let changeHandler: any;

    matchMediaMock.mockReturnValue({
      matches: false,
      media: "(max-width: 768px)",
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "change") {
          changeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });

    const { result } = renderHook(() => useMobileLayout());

    // Manually set a different panel
    act(() => {
      result.current.setMobilePanel("serial");
    });

    expect(result.current.mobilePanel).toBe("serial");

    // Simulate media query change to mobile
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: true });
      }
    });

    // Should not change to "code" since "serial" was already set
    expect(result.current.mobilePanel).toBe("serial");
  });
});
