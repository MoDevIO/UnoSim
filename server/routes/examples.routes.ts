import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  browserOverrideSelectionSchema,
  fullCommitShaSchema,
  repositorySlugSchema,
  validateExamplesRequestSchema,
  type ExamplesRequestSelection,
  type FullCommitSha,
  type RepositorySlug,
} from "@shared/examples";
import { config } from "../config";
import { getRequestAuthorization, type RequestIdentity, type TrustConfig } from "../security/access-control";
import { asExamplesError, ExamplesError } from "../services/examples/examples-error";
import { ExamplesRepository } from "../services/examples/examples-repository";
import type { RequestContext } from "../services/examples/source-provider";
import { IdentityRateLimiter } from "../services/rate-limiter";

export interface ExamplesRoutesOptions {
  trust?: TrustConfig;
  disableRateLimit?: boolean;
  validateRateLimiter?: IdentityRateLimiter;
  overrideRateLimiter?: IdentityRateLimiter;
}

export function registerExamplesRoutes(
  app: Express,
  repository: Pick<ExamplesRepository, "validate" | "getCatalog" | "getExample">,
  options: ExamplesRoutesOptions = {},
): void {
  const trust = options.trust ?? config.trust;
  const validateLimiter = options.validateRateLimiter ?? new IdentityRateLimiter("Examples validate", {
    maxRequests: config.examples.validateRateLimitMaxRequests,
    windowMs: 60_000,
    blockDurationMs: 60_000,
  });
  const overrideLimiter = options.overrideRateLimiter ?? new IdentityRateLimiter("Examples override read", {
    maxRequests: config.examples.overrideRateLimitMaxRequests,
    windowMs: 60_000,
    blockDurationMs: 30_000,
  });
  const disableRateLimit = options.disableRateLimit ?? config.server.disableRateLimit;

  app.post("/api/examples/validate", async (req, res) => {
    const parsed = validateExamplesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const code = hasInvalidRefOnly(req.body) ? "INVALID_REF" : "INVALID_SELECTION";
      return sendError(res, new ExamplesError(code, "Invalid external examples selection"));
    }
    const identity = authorizeOverride(req, res, trust);
    if (!identity) return;
    if (!disableRateLimit && !checkRateLimit(validateLimiter, identity, res)) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const source = await repository.validate(parsed.data.selection, requestContext(req, identity));
      res.json({ schemaVersion: 1, valid: true, source });
    } catch (error) {
      sendError(res, asExamplesError(error));
    }
  });

  app.get("/api/examples", async (req, res) => {
    const selection = parseCatalogSelection(req);
    if (selection instanceof ExamplesError) return sendError(res, selection);
    const identity = selection.kind === "browser-override"
      ? authorizeOverride(req, res, trust)
      : ({ subject: "default", roles: [] } satisfies RequestIdentity);
    if (!identity) return;
    if (selection.kind === "browser-override") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!disableRateLimit && !checkRateLimit(overrideLimiter, identity, res)) return;
    }
    try {
      res.json(await repository.getCatalog(selection, requestContext(req, identity)));
    } catch (error) {
      sendError(res, asExamplesError(error));
    }
  });

  app.get("/api/examples/:id", async (req, res) => {
    const detail = parseDetailSelection(req);
    if (detail instanceof ExamplesError) return sendError(res, detail);
    const isExternal = detail.repository !== undefined;
    const identity = isExternal
      ? authorizeOverride(req, res, trust)
      : ({ subject: "default", roles: [] } satisfies RequestIdentity);
    if (!identity) return;
    if (isExternal) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!disableRateLimit && !checkRateLimit(overrideLimiter, identity, res)) return;
    }
    try {
      const example = await repository.getExample(
        detail.repository,
        detail.revision,
        req.params.id,
        requestContext(req, identity),
      );
      if (!example) return sendError(res, new ExamplesError("EXAMPLE_NOT_FOUND", "Example not found"));
      res.json(example);
    } catch (error) {
      sendError(res, asExamplesError(error));
    }
  });
}

function parseCatalogSelection(req: Request): ExamplesRequestSelection | ExamplesError {
  if (Object.keys(req.query).some((key) => key !== "repository" && key !== "ref")) {
    return new ExamplesError("INVALID_SELECTION", "Unknown external examples query parameter");
  }
  const repository = singleQueryValue(req.query.repository);
  const ref = singleQueryValue(req.query.ref);
  if (repository === null || ref === null || (repository === undefined) !== (ref === undefined)) {
    return new ExamplesError("INVALID_SELECTION", "Repository and ref must be provided together");
  }
  if (repository === undefined || ref === undefined) return { kind: "default" };
  const parsedRepository = repositorySlugSchema.safeParse(repository);
  if (!parsedRepository.success) return new ExamplesError("INVALID_SELECTION", "Invalid external examples repository");
  const parsed = browserOverrideSelectionSchema.safeParse({ repository, ref });
  return parsed.success
    ? { kind: "browser-override", ...parsed.data }
    : new ExamplesError("INVALID_REF", "Invalid external examples ref");
}

function hasInvalidRefOnly(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.schemaVersion !== 1 || Object.keys(body).some((key) => key !== "schemaVersion" && key !== "selection")) return false;
  if (!body.selection || typeof body.selection !== "object" || Array.isArray(body.selection)) return false;
  const selection = body.selection as Record<string, unknown>;
  if (Object.keys(selection).length !== 2
    || Object.keys(selection).some((key) => key !== "repository" && key !== "ref")
    || typeof selection.ref !== "string") return false;
  return repositorySlugSchema.safeParse(selection.repository).success
    && !browserOverrideSelectionSchema.safeParse(selection).success;
}

function parseDetailSelection(req: Request):
  | { repository?: RepositorySlug; revision?: FullCommitSha }
  | ExamplesError {
  if (Object.keys(req.query).some((key) => key !== "repository" && key !== "revision")) {
    return new ExamplesError("INVALID_SELECTION", "Unknown external examples query parameter");
  }
  const repository = singleQueryValue(req.query.repository);
  const revision = singleQueryValue(req.query.revision);
  if (repository === null || revision === null || (repository === undefined) !== (revision === undefined)) {
    return new ExamplesError("INVALID_REVISION", "Repository and revision must be provided together");
  }
  if (repository === undefined || revision === undefined) return {};
  const parsedRepository = repositorySlugSchema.safeParse(repository);
  const parsedRevision = fullCommitShaSchema.safeParse(revision);
  if (!parsedRepository.success) return new ExamplesError("INVALID_SELECTION", "Invalid external examples repository");
  if (!parsedRevision.success) return new ExamplesError("INVALID_REVISION", "Invalid external examples revision");
  return { repository: parsedRepository.data, revision: parsedRevision.data };
}

function singleQueryValue(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function authorizeOverride(req: Request, res: Response, trust: TrustConfig): RequestIdentity | null {
  const authorization = getRequestAuthorization(req, trust);
  if (authorization.allowed) return authorization.identity;
  res.status(authorization.status).json({ error: authorization.status === 401 ? "Unauthorized" : "Forbidden" });
  return null;
}

function checkRateLimit(limiter: IdentityRateLimiter, identity: RequestIdentity, res: Response): boolean {
  const result = limiter.checkLimit(identity.subject);
  if (result.allowed) return true;
  res.setHeader("Retry-After", String(result.retryAfter));
  sendError(res, new ExamplesError("RATE_LIMITED", "External examples request rate exceeded", result.retryAfter));
  return false;
}

function requestContext(req: Request, identity: RequestIdentity): RequestContext {
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  const header = req.header("x-request-id");
  return {
    identity: identity.subject,
    requestId: header && header.length <= 128 ? header : randomUUID(),
    signal: controller.signal,
  };
}

function sendError(res: Response, error: ExamplesError): Response {
  if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
  return res.status(error.status).json({
    schemaVersion: 1,
    error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  });
}
