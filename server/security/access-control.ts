import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { VerifyClientCallbackAsync } from "ws";

export type TrustMode = "local" | "gateway";

export interface TrustConfig {
  mode: TrustMode;
  gatewaySecret?: string;
  trustedProxy?: string;
}

export interface RequestIdentity {
  subject: string;
  roles: readonly string[];
}

export type AuthorizationResult =
  | { allowed: true; identity: RequestIdentity }
  | { allowed: false; status: 401 | 403 };

const SUBJECT_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const ALLOWED_ROLES = new Set(["user"]);

function isIpOrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0 || !address) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (version === 4 ? 32 : 128);
}

export function parseTrustConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv = env.NODE_ENV,
): TrustConfig {
  const rawMode = env.UNOSIM_TRUST_MODE ?? "local";
  if (rawMode !== "local" && rawMode !== "gateway") {
    throw new Error("UNOSIM_TRUST_MODE must be either 'local' or 'gateway'");
  }

  if (rawMode === "local") {
    if (nodeEnv === "production" && env.UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL !== "true") {
      throw new Error(
        "Production requires UNOSIM_TRUST_MODE=gateway; set UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true only for an isolated development deployment",
      );
    }
    return { mode: "local" };
  }

  const gatewaySecret = env.UNOSIM_GATEWAY_SECRET;
  if (!gatewaySecret || gatewaySecret.length < 32) {
    throw new Error("UNOSIM_GATEWAY_SECRET must contain at least 32 characters in gateway mode");
  }

  const trustedProxy = env.UNOSIM_TRUSTED_PROXY?.trim();
  if (!trustedProxy || !isIpOrCidr(trustedProxy)) {
    throw new Error("UNOSIM_TRUSTED_PROXY must be an explicit IP address or CIDR in gateway mode");
  }

  return { mode: rawMode, gatewaySecret, trustedProxy };
}

function singleHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value;
}

function secretsEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function authorizeHeaders(
  headers: IncomingHttpHeaders,
  trust: TrustConfig,
): AuthorizationResult {
  if (trust.mode === "local") {
    return { allowed: true, identity: { subject: "local", roles: ["user"] } };
  }

  if (!secretsEqual(singleHeader(headers, "x-unosim-gateway-secret"), trust.gatewaySecret!)) {
    return { allowed: false, status: 401 };
  }

  const subject = singleHeader(headers, "x-unosim-subject");
  if (!subject || !SUBJECT_PATTERN.test(subject)) {
    return { allowed: false, status: 401 };
  }

  const rolesHeader = singleHeader(headers, "x-unosim-roles");
  if (!rolesHeader) return { allowed: false, status: 403 };
  const roles = rolesHeader.split(",").map((role) => role.trim()).filter(Boolean);
  if (!roles.includes("user") || roles.some((role) => !ALLOWED_ROLES.has(role))) {
    return { allowed: false, status: 403 };
  }

  return { allowed: true, identity: { subject, roles } };
}

export function createUserAuthorizationMiddleware(trust: TrustConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = authorizeHeaders(req.headers, trust);
    if (!result.allowed) {
      res.status(result.status).json({ error: result.status === 401 ? "Unauthorized" : "Forbidden" });
      return;
    }

    res.locals.unosimIdentity = result.identity;
    next();
  };
}

export function createWebSocketAuthorizationVerifier(
  trust: TrustConfig,
): VerifyClientCallbackAsync {
  return ({ req }, done) => {
    const result = authorizeHeaders(req.headers, trust);
    if (!result.allowed) {
      done(
        false,
        result.status,
        result.status === 401 ? "Unauthorized" : "Forbidden",
      );
      return;
    }
    done(true);
  };
}
