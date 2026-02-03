import "@testing-library/jest-dom";

// Mock console.log to prevent CI failures from Logger output
// The Logger class in shared/logger.ts uses console.log() internally,
// and GitHub Actions fails on any console output during tests.
// This mock silently suppresses Logger output without affecting test behavior.
// Error interceptor: Only log on test failure
afterEach(() => {
  // Always suppress logs after each test (Jest does not expose assertion status reliably)
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
jest.spyOn(console, "log").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
