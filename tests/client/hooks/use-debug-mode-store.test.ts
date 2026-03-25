import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
};

let storageMock: Storage;

beforeEach(() => {
  vi.resetModules();
  storageMock = createLocalStorageMock();
  vi.stubGlobal("localStorage", storageMock);
});

describe("use-debug-mode-store", () => {
  it("defaults to false", async () => {
    const { useDebugMode } = await import("@/hooks/use-debug-mode-store");
    const { result } = renderHook(() => useDebugMode());
    expect(result.current.debugMode).toBe(false);
  });

  it("setDebugMode toggles debugMode on", async () => {
    const { useDebugMode } = await import("@/hooks/use-debug-mode-store");
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.setDebugMode(true);
    });

    expect(result.current.debugMode).toBe(true);
    expect(storageMock.getItem("unoDebugMode")).toBe("1");
  });

  it("setDebugMode toggles debugMode off", async () => {
    const { useDebugMode } = await import("@/hooks/use-debug-mode-store");
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.setDebugMode(true);
    });
    act(() => {
      result.current.setDebugMode(false);
    });

    expect(result.current.debugMode).toBe(false);
    expect(storageMock.getItem("unoDebugMode")).toBe("0");
  });

  it("initializes from localStorage", async () => {
    storageMock.setItem("unoDebugMode", "1");
    const mod = await import("@/hooks/use-debug-mode-store");
    // Trigger initFromStorage manually since the module-level init may have run with no value
    // The module initializes on load, but we set storage before import via resetModules
    const { result } = renderHook(() => mod.useDebugMode());
    // Either the module picks it up or we need to check the store directly
    expect(result.current.debugMode).toBe(true);
  });

  it("responds to debugModeChange custom event", async () => {
    const { useDebugMode } = await import("@/hooks/use-debug-mode-store");
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent("debugModeChange", { detail: { value: true } }),
      );
    });

    expect(result.current.debugMode).toBe(true);
  });
});
