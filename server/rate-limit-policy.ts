const RATE_LIMIT_EXEMPT_API_PATHS = new Set([
  "/api/status",
  "/api/health",
  "/api/config",
]);

/**
 * Returns whether the global API rate limiter should ignore a request.
 * Keep this decision independent from Express so it can be tested directly.
 */
export function shouldSkipApiRateLimit(
  originalUrl: string,
  isTestMode: boolean,
): boolean {
  return isTestMode || RATE_LIMIT_EXEMPT_API_PATHS.has(originalUrl);
}
