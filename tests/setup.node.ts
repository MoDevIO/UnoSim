import { afterEach, vi } from "vitest";
import {
  initializeGlobalErrorHandlers,
  markTestAsFailed,
  setLogLevel,
} from "@shared/logger";

initializeGlobalErrorHandlers();
setLogLevel(process.env.LOG_LEVEL || "WARN");

// Compatibility for the few legacy tests that still access Jest's global.
(globalThis as typeof globalThis & { jest: typeof vi }).jest = vi;

const originalConsoleError = console.error;
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "info").mockImplementation(() => undefined);
vi.spyOn(console, "warn").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation((...args) => {
  originalConsoleError(...args);
});

afterEach((context) => {
  vi.clearAllMocks();
  if (context?.state === "fail") {
    markTestAsFailed(context.title);
  }
});
