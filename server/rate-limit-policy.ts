import type { IncomingMessage } from "node:http";
import { ipKeyGenerator } from "express-rate-limit";
import { getRequestAuthorization, type TrustConfig } from "./security/access-control";

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

/**
 * Key of the global API rate limit. Behind the gateway, a whole course often
 * shares one public IP (campus NAT), so an authenticated subject gets its own
 * budget. Requests without a valid gateway identity, and local mode, where a
 * client can always obtain a fresh session, stay on the client IP.
 */
export function apiRateLimitKey(req: IncomingMessage & { ip?: string }, trust: TrustConfig): string {
  if (trust.mode === "gateway") {
    const authorization = getRequestAuthorization(req, trust);
    if (authorization.allowed) return `subject:${authorization.identity.subject}`;
  }
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}
