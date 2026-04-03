import { afterEach, afterAll, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { initializeGlobalErrorHandlers, markTestAsFailed, setLogLevel } from "@shared/logger";

// ============ REACT ACT WARNING SUPPRESSION ============
// Suppress act() warnings from child component internal effects
// These are from ArduinoSimulatorPage and SerialMonitorView, which have
// expected async effects that fire outside of our test act() scopes
const originalError = console.error;
const originalWarn = console.warn;

console.error = (...args: any[]) => {
  const message = args[0]?.toString?.();
  if (
    message?.includes?.('Warning: An update to') &&
    (message?.includes?.('ArduinoSimulatorPage') ||
     message?.includes?.('SerialMonitorView') ||
     message?.includes?.('inside a test was not wrapped in act'))
  ) {
    return; // Suppress child component effect warnings
  }
  originalError.apply(console, args);
};

console.warn = (...args: any[]) => {
  const message = args[0]?.toString?.();
  if (
    message?.includes?.('Warning: An update to') &&
    (message?.includes?.('ArduinoSimulatorPage') ||
     message?.includes?.('SerialMonitorView'))
  ) {
    return; // Suppress
  }
  originalWarn.apply(console, args);
};

// ============ WARNING SUPPRESSION ============
// Suppress Node.js deprecation warnings about localstorage-file
// These warnings come from jsdom and don't impact test results
const originalProcessWarn = process.emitWarning;
process.emitWarning = function(warning: any, ...args: any[]) {
  if (typeof warning === 'string' && warning.includes('localstorage-file')) {
    return; // Suppress this warning
  }
  if (warning?.message?.includes?.('localstorage-file')) {
    return; // Suppress this warning
  }
  return originalProcessWarn.apply(process, [warning, ...args]);
};

// ============ LOCALSTORAGE INITIALIZATION ============
// Initialize in-memory localStorage to prevent jsdom warnings about localstorage-file
// This is safe for tests since we're using jsdom which provides its own storage
try {
  if (globalThis.localStorage === undefined) {
    const memoryStorage: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (key: string) => memoryStorage[key] ?? null,
      setItem: (key: string, value: string) => { memoryStorage[key] = value; },
      removeItem: (key: string) => { delete memoryStorage[key]; },
      clear: () => { Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]); },
      key: (index: number) => Object.keys(memoryStorage)[index] ?? null,
      length: Object.keys(memoryStorage).length,
    } as any;
  }
} catch (_e) { // NOSONAR S2486
  // localStorage may already be initialized, that's fine  
}

// ============ POLICY: GLOBALE ERROR-HANDLER ============
// Initialisiert Logger mit Flush-on-Failure Mechanismus
initializeGlobalErrorHandlers();

// Setzt CI Standard Log Level (von CI oder lokal)
const logLevel = process.env.LOG_LEVEL || "WARN";
setLogLevel(logLevel as any);

// Kompatibilitätsschicht für alten Code, der noch 'jest' statt 'vi' erwartet
(globalThis as any).jest = vi;

// ============ CONSOLE MOCKING ============
// Verhindert Debug-Buffer Belastung durch Test-Noise
// ERROR und WARN gehen zur Konsole, DEBUG wird gepuffert
let _originalConsoleLog = console.log;
let originalConsoleError = console.error;
let _originalConsoleWarn = console.warn;

vi.spyOn(console, "log").mockImplementation((..._args) => {
  // Log collection removed - use vi.spyOn for assertion if needed
  // Deaktivieren Sie diese Zeile, um CI Logs freizunehmen, falls nötig
  // originalConsoleLog(..._args);
});

vi.spyOn(console, "info").mockImplementation((..._args) => {
  // Info log collection removed
});

vi.spyOn(console, "error").mockImplementation((..._args) => {
  // Error log collected by vi.spyOn
  // Fehler sollten sichtbar sein
  originalConsoleError(..._args);
});

vi.spyOn(console, "warn").mockImplementation((..._args) => {
  // Warn log collection removed
});

afterEach(() => {
  // Clear spies and mocks
  vi.clearAllMocks();
});

// ============ FLUSH-ON-FAILURE INTEGRATION ============
// Vitest liefert onTestFailed nur innerhalb einer Testausführung. Stattdessen
// nutzen wir einen afterEach-hook, der fehlgeschlagene Tests erkennt und den
// Logger triggert.
afterEach((ctx) => {
  if (ctx?.state === 'fail') {
    markTestAsFailed(`${ctx.title}`);
  }
});

afterAll(async () => {
  // Remove any unowebsim Docker containers that survived the test run.
  // This is a safety net for cases where individual afterEach cleanup didn't
  // complete (e.g., fake timers, test worker termination).
  try {
    const { spawn } = await import("node:child_process");
    const containerIds = await new Promise<string[]>((resolve) => {
      const proc = spawn("docker", ["ps", "-aq", "--filter", "name=unowebsim-"]);
      let output = "";
      proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
      proc.on("close", () => resolve(output.split("\n").filter(Boolean)));
    });
    if (containerIds.length > 0) {
      await new Promise<void>((resolve) => {
        spawn("docker", ["rm", "-f", ...containerIds]).on("close", () => resolve());
      });
    }
  } catch {
    // Docker not available or no containers – ignore
  }
});