import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDebugConsole } from "../../../client/src/hooks/use-debug-console";

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

describe("useDebugConsole", () => {
  beforeAll(() => {
    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
      vi.stubGlobal("localStorage", createLocalStorageMock());
    }
  });

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should initialize with default values", () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    expect(result.current.debugMode).toBe(false);
    expect(result.current.debugMessages).toEqual([]);
    expect(result.current.debugMessageFilter).toBe("");
    expect(result.current.debugViewMode).toBe("table");
    expect(result.current.debugMessagesContainerRef.current).toBeNull();
  });

  it("should read debugMode from localStorage on mount", () => {
    localStorage.setItem("unoDebugMode", "1");

    const { result } = renderHook(() => useDebugConsole("serial"));

    expect(result.current.debugMode).toBe(true);
  });

  it("should add debug message when debugMode is enabled", () => {
    localStorage.setItem("unoDebugMode", "1");
    const { result } = renderHook(() => useDebugConsole("serial"));

    act(() => {
      result.current.addDebugMessage(
        "frontend",
        "compile",
        "Starting compilation...",
        "http",
      );
    });

    expect(result.current.debugMessages).toHaveLength(1);
    expect(result.current.debugMessages[0]).toMatchObject({
      sender: "frontend",
      type: "compile",
      content: "Starting compilation...",
      protocol: "http",
    });
    expect(result.current.debugMessages[0].id).toBeDefined();
    expect(result.current.debugMessages[0].timestamp).toBeInstanceOf(Date);
  });

  it("should NOT add debug message when debugMode is disabled", () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    act(() => {
      result.current.addDebugMessage(
        "server",
        "simulation_event",
        "Pin 13 HIGH",
        "websocket",
      );
    });

    expect(result.current.debugMessages).toHaveLength(0);
  });

  it("should limit debugMessages to last 500 entries", () => {
    localStorage.setItem("unoDebugMode", "1");
    const { result } = renderHook(() => useDebugConsole("serial"));

    act(() => {
      for (let i = 0; i < 600; i++) {
        result.current.addDebugMessage(
          "frontend",
          "test",
          `Message ${i}`,
          "http",
        );
      }
    });

    expect(result.current.debugMessages).toHaveLength(500);
    // First message should be "Message 100" (0-99 dropped)
    expect(result.current.debugMessages[0].content).toBe("Message 100");
    expect(result.current.debugMessages[499].content).toBe("Message 599");
  });

  it("should update debugMessageFilter state", () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    act(() => {
      result.current.setDebugMessageFilter("compile");
    });

    expect(result.current.debugMessageFilter).toBe("compile");
  });

  it("should update debugViewMode state", () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    expect(result.current.debugViewMode).toBe("table");

    act(() => {
      result.current.setDebugViewMode("tiles");
    });

    expect(result.current.debugViewMode).toBe("tiles");
  });

  it("should clear debug messages when setDebugMessages is called", () => {
    localStorage.setItem("unoDebugMode", "1");
    const { result } = renderHook(() => useDebugConsole("serial"));

    act(() => {
      result.current.addDebugMessage("frontend", "test", "Message 1");
      result.current.addDebugMessage("frontend", "test", "Message 2");
    });

    expect(result.current.debugMessages).toHaveLength(2);

    act(() => {
      result.current.setDebugMessages([]);
    });

    expect(result.current.debugMessages).toHaveLength(0);
  });

  it("should listen for debugModeChange custom event", async () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    expect(result.current.debugMode).toBe(false);

    // Dispatch custom event to change debug mode
    act(() => {
      const event = new CustomEvent("debugModeChange", {
        detail: { value: true },
      });
      document.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(result.current.debugMode).toBe(true);
    });

    // Try adding a message now that debug mode is enabled
    act(() => {
      result.current.addDebugMessage("server", "info", "Debug enabled message");
    });

    expect(result.current.debugMessages).toHaveLength(1);
  });

  it("should handle malformed debugModeChange event gracefully", async () => {
    const { result } = renderHook(() => useDebugConsole("serial"));

    // Dispatch invalid event (no detail)
    act(() => {
      const event = new CustomEvent("debugModeChange");
      document.dispatchEvent(event);
    });

    // debugMode should remain unchanged
    expect(result.current.debugMode).toBe(false);
  });
});
