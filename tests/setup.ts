import { afterEach, afterAll, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { initializeGlobalErrorHandlers, markTestAsFailed, setLogLevel } from "@shared/logger";

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

vi.spyOn(console, "log").mockImplementation((...args) => {
  // Log collection removed - use vi.spyOn for assertion if needed
  // Deaktivieren Sie diese Zeile, um CI Logs freizunehmen, falls nötig
  // originalConsoleLog(...args);
});

vi.spyOn(console, "info").mockImplementation((...args) => {
  // Info log collection removed
});

vi.spyOn(console, "error").mockImplementation((...args) => {
  // Error log collected by vi.spyOn
  // Fehler sollten sichtbar sein
  originalConsoleError(...args);
});

vi.spyOn(console, "warn").mockImplementation((...args) => {
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

afterAll(() => {
  // Optional: Cleanup nach allen Tests
});