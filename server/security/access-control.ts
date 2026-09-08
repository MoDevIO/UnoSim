import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
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
const LOCAL_SESSION_COOKIE = "unosim_local_session";
const LOCAL_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const localSessionSigningKey = randomBytes(32);
const requestIdentity = new WeakMap<IncomingMessage, RequestIdentity>();

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies.set(name, value);
  }
  return cookies;
}

function signLocalSession(id: string): string {
  return createHmac("sha256", localSessionSigningKey)
    .update(id)
    .digest("base64url");
}

function readLocalSession(headers: IncomingHttpHeaders): string | undefined {
  const token = parseCookies(singleHeader(headers, "cookie")).get(
    LOCAL_SESSION_COOKIE,
  );
  if (!token) return undefined;
  const separator = token.indexOf(".");
  if (separator < 1) return undefined;
  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return undefined;
  return secretsEqual(signature, signLocalSession(id)) ? id : undefined;
}

function createLocalIdentity(): {
  identity: RequestIdentity;
  cookie: string;
} {
  const id = randomBytes(16).toString("base64url");
  const token = `${id}.${signLocalSession(id)}`;
  return {
    identity: { subject: `local.${id}`, roles: ["user"] },
    cookie: `${LOCAL_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${LOCAL_SESSION_MAX_AGE_SECONDS}`,
  };
}

function resolveRequestAuthorization(
  req: IncomingMessage,
  trust: TrustConfig,
): AuthorizationResult & { cookie?: string } {
  const existing = requestIdentity.get(req);
  if (existing) return { allowed: true, identity: existing };

  if (trust.mode === "gateway") {
    const authorization = authorizeHeaders(req.headers, trust);
    if (authorization.allowed) requestIdentity.set(req, authorization.identity);
    return authorization;
  }

  const sessionId = readLocalSession(req.headers);
  const resolved: { identity: RequestIdentity; cookie?: string } = sessionId
    ? { identity: { subject: `local.${sessionId}`, roles: ["user"] } }
    : createLocalIdentity();
  requestIdentity.set(req, resolved.identity);
  return { allowed: true, identity: resolved.identity, cookie: resolved.cookie };
}

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
    if (
      nodeEnv === "production" &&
      env.UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL !== "true"
    ) {
      throw new Error(
        "Production requires UNOSIM_TRUST_MODE=gateway; set UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true only for an isolated development deployment",
      );
    }
    return { mode: "local" };
  }

  const gatewaySecret = env.UNOSIM_GATEWAY_SECRET;
  if (!gatewaySecret || gatewaySecret.length < 32) {
    throw new Error(
      "UNOSIM_GATEWAY_SECRET must contain at least 32 characters in gateway mode",
    );
  }

  const trustedProxy = env.UNOSIM_TRUSTED_PROXY?.trim();
  if (!trustedProxy || !isIpOrCidr(trustedProxy)) {
    throw new Error(
      "UNOSIM_TRUSTED_PROXY must be an explicit IP address or CIDR in gateway mode",
    );
  }

  return { mode: rawMode, gatewaySecret, trustedProxy };
}

function singleHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value;
}

export function isWebSocketOriginAllowed(
  headers: IncomingHttpHeaders,
  trust: TrustConfig,
  allowedOrigins: readonly string[],
): boolean {
  const origin = singleHeader(headers, "origin");
  if (!origin) return trust.mode === "local";

  let parsed: URL;
  try {
    parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      !["http:", "https:"].includes(parsed.protocol)
    ) {
      return false;
    }
  } catch {
    return false;
  }

  if (trust.mode === "local" && singleHeader(headers, "host") === parsed.host) {
    return true;
  }

  return allowedOrigins.includes(origin);
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

  if (
    !secretsEqual(
      singleHeader(headers, "x-unosim-gateway-secret"),
      trust.gatewaySecret!,
    )
  ) {
    return { allowed: false, status: 401 };
  }

  const subject = singleHeader(headers, "x-unosim-subject");
  if (!subject || !SUBJECT_PATTERN.test(subject)) {
    return { allowed: false, status: 401 };
  }

  const rolesHeader = singleHeader(headers, "x-unosim-roles");
  if (!rolesHeader) return { allowed: false, status: 403 };
  const roles = rolesHeader
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  if (
    !roles.includes("user") ||
    roles.some((role) => !ALLOWED_ROLES.has(role))
  ) {
    return { allowed: false, status: 403 };
  }

  return { allowed: true, identity: { subject, roles } };
}

export function createUserAuthorizationMiddleware(
  trust: TrustConfig,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = resolveRequestAuthorization(req, trust);
    if (!result.allowed) {
      res
        .status(result.status)
        .json({ error: result.status === 401 ? "Unauthorized" : "Forbidden" });
      return;
    }

    res.locals.unosimIdentity = result.identity;
    if (result.cookie) res.appendHeader("Set-Cookie", result.cookie);
    next();
  };
}

/**
 * Issues a server-authenticated local session before static/API requests. This
 * keeps browser clients independent without trusting a client-provided user ID.
 * Gateway mode remains entirely governed by the gateway contract.
 */
export function createLocalSessionMiddleware(trust: TrustConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (trust.mode === "local") {
      const result = resolveRequestAuthorization(req, trust);
      if (result.allowed) {
        res.locals.unosimIdentity = result.identity;
        if (result.cookie) res.appendHeader("Set-Cookie", result.cookie);
      }
    }
    next();
  };
}

export function getRequestAuthorization(
  req: IncomingMessage,
  trust: TrustConfig,
): AuthorizationResult {
  return resolveRequestAuthorization(req, trust);
}

export function createWebSocketAuthorizationVerifier(
  trust: TrustConfig,
  allowedOrigins: readonly string[],
): VerifyClientCallbackAsync {
  return ({ req }, done) => {
    const result = resolveRequestAuthorization(req, trust);
    if (!result.allowed) {
      done(
        false,
        result.status,
        result.status === 401 ? "Unauthorized" : "Forbidden",
      );
      return;
    }
    if (!isWebSocketOriginAllowed(req.headers, trust, allowedOrigins)) {
      done(false, 403, "Forbidden origin");
      return;
    }
    if (result.cookie) {
      done(true, undefined, undefined, { "Set-Cookie": result.cookie });
      return;
    }
    done(true);
  };
}
