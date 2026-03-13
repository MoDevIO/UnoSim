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
let capturedLogs: Array<{ level: string; message: string }> = [];
let _originalConsoleLog = console.log;
let originalConsoleError = console.error;
let _originalConsoleWarn = console.warn;

vi.spyOn(console, "log").mockImplementation((...args) => {
  capturedLogs.push({ level: "LOG", message: String(args.join(" ")) });
  // Deaktivieren Sie diese Zeile, um CI Logs freizunehmen, falls nötig
  // originalConsoleLog(...args);
});

vi.spyOn(console, "info").mockImplementation((...args) => {
  capturedLogs.push({ level: "INFO", message: String(args.join(" ")) });
});

vi.spyOn(console, "error").mockImplementation((...args) => {
  capturedLogs.push({ level: "ERROR", message: String(args.join(" ")) });
  // Fehler sollten sichtbar sein
  originalConsoleError(...args);
});

vi.spyOn(console, "warn").mockImplementation((...args) => {
  capturedLogs.push({ level: "WARN", message: String(args.join(" ")) });
});

afterEach(() => {
  // Logs zurücksetzen
  capturedLogs = [];
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
  capturedLogs = [];
});