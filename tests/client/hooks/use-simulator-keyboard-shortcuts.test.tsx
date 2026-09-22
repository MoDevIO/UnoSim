import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSimulatorKeyboardShortcuts } from "../../../client/src/hooks/useSimulatorKeyboardShortcuts";
import { getServerCapabilities } from "@/lib/server-capabilities";

const createDefaultOptions = (overrides: Record<string, unknown> = {}) => ({
  isMac: false,
  simulationStatus: "idle" as const,
  compilePending: false,
  startPending: false,
  capabilities: getServerCapabilities(true),
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
    expect(options.handleCompileAndStart).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+U does not trigger when compilePending", () => {
    const options = createDefaultOptions({ compilePending: true });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "u", ctrlKey: true });
    expect(options.handleCompileAndStart).not.toHaveBeenCalled();
  });

  it("Ctrl+U does not trigger when startPending", () => {
    const options = createDefaultOptions({ startPending: true });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "u", ctrlKey: true });
    expect(options.handleCompileAndStart).not.toHaveBeenCalled();
  });

  it("does not trigger compile, compile-and-start, or stop shortcuts while offline", () => {
    const options = createDefaultOptions({
      capabilities: getServerCapabilities(false),
      simulationStatus: "running",
    });
    renderHook(() => useSimulatorKeyboardShortcuts(options));

    fireKeyDown({ key: "F5" });
    fireKeyDown({ key: "u", ctrlKey: true });
    fireKeyDown({ key: "Escape" });

    expect(options.handleCompile).not.toHaveBeenCalled();
    expect(options.handleCompileAndStart).not.toHaveBeenCalled();
    expect(options.handleStop).not.toHaveBeenCalled();
  });

  it("restores shortcut actions on reconnect without triggering them automatically", () => {
    const options = createDefaultOptions({ capabilities: getServerCapabilities(false) });
    const { rerender } = renderHook(
      ({ capabilities }) => useSimulatorKeyboardShortcuts({ ...options, capabilities }),
      { initialProps: { capabilities: getServerCapabilities(false) } },
    );

    rerender({ capabilities: getServerCapabilities(true) });
    expect(options.handleCompile).not.toHaveBeenCalled();
    expect(options.handleCompileAndStart).not.toHaveBeenCalled();

    fireKeyDown({ key: "F5" });
    fireKeyDown({ key: "u", ctrlKey: true });
    expect(options.handleCompile).toHaveBeenCalledTimes(1);
    expect(options.handleCompileAndStart).toHaveBeenCalledTimes(1);
  });

  it("Cmd+U triggers the same compile-and-start dispatcher on macOS", () => {
    const options = createDefaultOptions({ isMac: true });
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "u", metaKey: true });
    expect(options.handleCompileAndStart).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+F triggers handleFormatCode", () => {
    const options = createDefaultOptions();
    renderHook(() => useSimulatorKeyboardShortcuts(options));
    fireKeyDown({ key: "f", ctrlKey: true, shiftKey: true });
    expect(options.handleFormatCode).toHaveBeenCalledTimes(1);
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
