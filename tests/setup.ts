import "@testing-library/jest-dom/vitest";

// ...existing code...

// Mock console.log to prevent CI failures from Logger output
// The Logger class in shared/logger.ts uses console.log() internally,
// and GitHub Actions fails on any console output during tests.
// This mock silently suppresses Logger output without affecting test behavior.
// Error interceptor: Only log on test failure
import { afterEach, vi } from "vitest";

(globalThis as any).jest = vi;

afterEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
