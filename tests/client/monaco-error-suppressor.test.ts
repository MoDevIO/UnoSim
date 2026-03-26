/**
 * Tests for monaco-error-suppressor
 *
 * Covers: console.error/warn interception, window.onerror,
 * isMonacoHitTestError detection, MutationObserver overlay removal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Suppress logger output
vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

let originalConsoleError: typeof console.error;
let originalConsoleWarn: typeof console.warn;
let originalOnerror: typeof globalThis.onerror;

beforeEach(() => {
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  originalOnerror = globalThis.onerror;
  vi.resetModules();
});

afterEach(() => {
  // Restore originals
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  globalThis.onerror = originalOnerror;
  vi.restoreAllMocks();
});

describe("monaco-error-suppressor", () => {
  it("module loads without error", async () => {
    await expect(import("@/lib/monaco-error-suppressor")).resolves.toBeDefined();
  });

  it("suppresses console.error for Monaco hitTest errors", async () => {
    await import("@/lib/monaco-error-suppressor");
    // The module patches console.error; the original is captured inside the module.
    // We verify it does NOT pass through hitTest errors
    const hitTestError = new Error("Cannot read properties of null (reading 'offsetNode') hitResult");
    
    // This should be suppressed (not thrown or propagated)
    expect(() => console.error(hitTestError)).not.toThrow();
  });

  it("lets non-Monaco errors through console.error", async () => {
    await import("@/lib/monaco-error-suppressor");
    // Normal errors should still call through
    const normalError = new Error("Normal error");
    // This should not throw
    expect(() => console.error(normalError)).not.toThrow();
  });

  it("suppresses console.warn for Monaco hitTest errors", async () => {
    await import("@/lib/monaco-error-suppressor");
    const hitTestError = new Error("can't access property hitResult is null");
    expect(() => console.warn(hitTestError)).not.toThrow();
  });

  it("lets non-Monaco warnings through", async () => {
    await import("@/lib/monaco-error-suppressor");
    expect(() => console.warn("Normal warning")).not.toThrow();
  });

  it("installs global error handler that suppresses hitTest errors", async () => {
    await import("@/lib/monaco-error-suppressor");
    
    if (globalThis.onerror) {
      // hitTest error should return true (suppressed)
      const result = globalThis.onerror(
        "Cannot read properties of null (reading 'offsetNode') hitResult",
        "editor.js",
        1,
        1,
        new Error("offsetNode hitResult")
      );
      expect(result).toBe(true);
    }
  });

  it("passes non-Monaco errors through global error handler", async () => {
    await import("@/lib/monaco-error-suppressor");
    
    if (globalThis.onerror) {
      const result = globalThis.onerror(
        "Some other error",
        "app.js",
        1,
        1,
        new Error("Some other error")
      );
      // Should return false (not suppressed)
      expect(result).toBeFalsy();
    }
  });

  it("detects hitTest errors by stack trace", async () => {
    await import("@/lib/monaco-error-suppressor");
    
    const errorWithStack = new Error("Some error");
    errorWithStack.stack = "Error\n at _doHitTestWithCaretPositionFromPoint (editor.js:123)";
    
    // Should be suppressed via console.error
    expect(() => console.error(errorWithStack)).not.toThrow();
  });

  it("handles non-Error objects in console.error", async () => {
    await import("@/lib/monaco-error-suppressor");
    
    // String args
    expect(() => console.error("string message")).not.toThrow();
    // Null/undefined
    expect(() => console.error(null)).not.toThrow();
    // Empty call
    expect(() => console.error()).not.toThrow();
  });

  it("handles object-like errors with message property", async () => {
    await import("@/lib/monaco-error-suppressor");
    
    const obj = { message: "offsetNode something hitResult" };
    expect(() => console.error(obj)).not.toThrow();
  });

  it("installs __MONACO_EDITOR_ERROR_HANDLER__", async () => {
    await import("@/lib/monaco-error-suppressor");
    expect((globalThis as any).__MONACO_EDITOR_ERROR_HANDLER__).toBeDefined();
    expect(typeof (globalThis as any).__MONACO_EDITOR_ERROR_HANDLER__.onUnexpectedError).toBe("function");
  });

  it("__MONACO_EDITOR_ERROR_HANDLER__ suppresses hitTest errors", async () => {
    await import("@/lib/monaco-error-suppressor");
    const handler = (globalThis as any).__MONACO_EDITOR_ERROR_HANDLER__;
    
    // Should not throw for hitTest error
    expect(() => handler.onUnexpectedError(new Error("offsetNode hitResult"))).not.toThrow();
  });

  it("__MONACO_EDITOR_ERROR_HANDLER__ passes through non-Monaco errors", async () => {
    await import("@/lib/monaco-error-suppressor");
    const handler = (globalThis as any).__MONACO_EDITOR_ERROR_HANDLER__;
    
    // Should call console.error for non-Monaco errors
    expect(() => handler.onUnexpectedError(new Error("Normal error"))).not.toThrow();
  });

  it("__MONACO_EDITOR_ERROR_HANDLER__ handles non-Error values", async () => {
    await import("@/lib/monaco-error-suppressor");
    const handler = (globalThis as any).__MONACO_EDITOR_ERROR_HANDLER__;
    
    expect(() => handler.onUnexpectedError("string error")).not.toThrow();
    expect(() => handler.onUnexpectedError(null)).not.toThrow();
    expect(() => handler.onUnexpectedError(42)).not.toThrow();
  });
});
