import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSimulatorKeyboardShortcuts } from "../../../client/src/hooks/useSimulatorKeyboardShortcuts";

const createDefaultOptions = (overrides: Record<string, unknown> = {}) => ({
  isMac: false,
  simulationStatus: "idle" as const,
  compilePending: false,
  startPending: false,
  handleCompile: vi.fn(),
  handleCompileAndStart: vi.fn(),
  handleStop: vi.fn(),
  handleFormatCode: vi.fn(),
  handleNewFile: vi.fn(),
  setDebugMode: vi.fn(),
  toast: vi.fn(),
  ...overrides,
});

function fireKeyDown(opts: Partial<KeyboardEventInit> & { key: string }) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
  globalThis.dispatchEvent(event);
}

describe("useSimulatorKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("F5 triggers handleCompile", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "F5" });
    expect(options.handleCompile).toHaveBeenCalled();
  });

  it("F5 does not trigger when compilePending", () => {
    const options = createDefaultOptions({ compilePending: true });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "F5" });
    expect(options.handleCompile).not.toHaveBeenCalled();
  });

  it("Escape stops running simulation", () => {
    const options = createDefaultOptions({ simulationStatus: "running" });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "Escape" });
    expect(options.handleStop).toHaveBeenCalled();
  });

  it("Escape does nothing when simulation is idle", () => {
    const options = createDefaultOptions({ simulationStatus: "idle" });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "Escape" });
    expect(options.handleStop).not.toHaveBeenCalled();
  });

  it("Ctrl+U triggers handleCompileAndStart", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "u", ctrlKey: true });
    expect(options.handleCompileAndStart).toHaveBeenCalled();
  });

  it("Ctrl+U does not trigger when compilePending", () => {
    const options = createDefaultOptions({ compilePending: true });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "u", ctrlKey: true });
    expect(options.handleCompileAndStart).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+F triggers handleFormatCode", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "f", ctrlKey: true, shiftKey: true });
    expect(options.handleFormatCode).toHaveBeenCalled();
  });

  it("Ctrl+Alt+Shift+N triggers handleNewFile", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "N", ctrlKey: true, altKey: true, shiftKey: true });
    expect(options.handleNewFile).toHaveBeenCalled();
  });

  it("Ctrl+D toggles debug mode", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    
    const event = new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(options.setDebugMode).toHaveBeenCalledWith(true);
    expect(options.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Debug Mode Enabled" }),
    );
  });
});
