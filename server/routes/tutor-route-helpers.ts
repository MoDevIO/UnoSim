import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { TutorProviderError } from "../services/tutor/llm-provider";
import type { TutorSource } from "../services/tutor/tutor-service";
import type { BoardId } from "@shared/boards";
import type { RequestIdentity } from "../security/access-control";
import {
  prepareTutorCourseContentSession,
  type TutorCourseContentSessionStore,
  type PinnedTutorCourseContent,
  type ResolvedTutorCourseContent,
  type TutorCourseContentResolver,
} from "../services/course-content/course-content-session";
import { ExamplesError } from "../services/examples/examples-error";
import type { RequestContext } from "../services/examples/source-provider";
import type { TutorCourseContentContext } from "@shared/tutor";

/** Shared request handling of the Tutor routes. */

type TutorRateLimiter = { checkLimit: (identity: string) => { allowed: true } | { allowed: false; retryAfter: number } };

export function responseError(
  res: Response,
  status: number,
  code: "CREDENTIAL_REQUIRED" | "CREDENTIAL_INVALID" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "RATE_LIMITED" | "MODEL_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE" | "INVALID_REQUEST" | "COURSE_CONTENT_STALE"
    | "SUPPORT_SESSION_INVALID" | "SUPPORT_CONFLICT" | "SUPPORT_LOCKED",
  message: string,
  retryAfter?: number,
): void {
  if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
  res.status(status).json({ error: { code, message, ...(retryAfter === undefined ? {} : { retryAfter }) } });
}

export function mapProviderError(res: Response, error: TutorProviderError): void {
  switch (error.kind) {
    case "credential-invalid":
      responseError(res, 401, "CREDENTIAL_INVALID", "Der Tutor-Zugang wurde abgelehnt.");
      return;
    case "provider-timeout":
      responseError(res, 504, "PROVIDER_TIMEOUT", "Der Tutor-Dienst hat zu lange nicht geantwortet.");
      return;
    case "rate-limited":
      responseError(res, 429, "RATE_LIMITED", "Das Tutor-Kontingent ist momentan erschöpft.", error.retryAfter);
      return;
    case "model-unavailable":
      responseError(res, 502, "MODEL_UNAVAILABLE", "Das konfigurierte Tutor-Modell ist nicht verfügbar.");
      return;
    case "invalid-response":
      responseError(res, 502, "INVALID_PROVIDER_RESPONSE", "Der Tutor-Dienst hat keine gültige Lernfrage geliefert.");
      return;
    default:
      responseError(res, 502, "PROVIDER_UNAVAILABLE", "Der Tutor-Dienst ist momentan nicht erreichbar.");
  }
}

export function enforceTutorRateLimit(res: Response, deps: { readonly rateLimiter?: TutorRateLimiter; readonly disableRateLimit?: boolean }): boolean {
  if (!deps.rateLimiter || deps.disableRateLimit) return true;
  const identity = res.locals.unosimIdentity as RequestIdentity | undefined;
  if (!identity) {
    responseError(res, 500, "PROVIDER_UNAVAILABLE", "Tutor-Anfrage konnte nicht autorisiert werden.");
    return false;
  }
  const result = deps.rateLimiter.checkLimit(identity.subject);
  if (!result.allowed) {
    responseError(res, 429, "RATE_LIMITED", "Zu viele Tutor-Anfragen. Bitte später erneut versuchen.", result.retryAfter);
    return false;
  }
  return true;
}

export function isLoopbackRequest(req: Request): boolean {
  const address = req.ip || req.socket.remoteAddress || "";
  const normalizedAddress = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return normalizedAddress === "127.0.0.1" || normalizedAddress === "::1";
}

export function hasSafeCredentialTransport(req: Request): boolean {
  return req.secure || isLoopbackRequest(req) || config.dockerTestBypassGateway;
}

export function requireRequestCredential(req: Request, res: Response, credential: string | undefined): boolean {
  if (!credential?.trim()) {
    responseError(res, 400, "CREDENTIAL_REQUIRED", "Für den Pilotbetrieb wird ein persönlicher Tutor-Key benötigt.");
    return false;
  }
  if (!hasSafeCredentialTransport(req)) {
    responseError(res, 400, "INVALID_REQUEST", "Persönliche Tutor-Keys werden außerhalb von Loopback nur über HTTPS übertragen.");
    return false;
  }
  return true;
}

export function bindRequestAbortSignal(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Request aborted", "AbortError"));
  const cleanup = () => {
    req.off("aborted", abort);
    res.off("close", onClose);
    res.off("finish", cleanup);
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
    cleanup();
  };
  req.once("aborted", abort);
  res.once("close", onClose);
  res.once("finish", cleanup);
  if ((req.destroyed && !req.complete) || res.destroyed) abort();
  return controller.signal;
}

/**
 * The service's last argument: the board id of a lone sketch as before, the whole source when the
 * request carries project files (the entry file is `code`), nothing without either.
 */
export function tutorSource({ board, headers, entryFile }: TutorSource): [] | [BoardId | TutorSource] {
  if (headers?.length || entryFile) return [{ ...(board ? { board } : {}), ...(headers?.length ? { headers } : {}), ...(entryFile ? { entryFile } : {}) }];
  return board ? [board] : [];
}

export type TutorRequestContent = {
  readonly identity: string;
  readonly content: PinnedTutorCourseContent;
  /** Present for an existing session; absent while a new session is only request-scoped. */
  readonly session?: string;
};

/**
 * A new Course Content session becomes visible only here, after the Tutor request
 * succeeded and before its response is sent. Failed, rejected, or aborted requests
 * therefore never leave a session behind.
 */
export function commitTutorSession(content: TutorRequestContent | undefined, sessions: TutorCourseContentSessionStore): string | undefined {
  if (!content) return undefined;
  return content.session ?? sessions.commit(content.identity, content.content);
}

/**
 * Returns undefined for the free Tutor, or after an error response was sent;
 * callers tell both apart by `res.headersSent`.
 */
export async function resolveTutorContent(
  req: Request,
  res: Response,
  request: TutorCourseContentContext | undefined,
  sessionHandle: string | undefined,
  resolver: TutorCourseContentResolver | undefined,
  sessions: TutorCourseContentSessionStore,
  signal: AbortSignal,
): Promise<TutorRequestContent | undefined> {
  if (signal.aborted) return undefined;
  if (sessionHandle === undefined && request === undefined) return undefined;
  // Sessions are owned by the authenticated subject; without one there is no owner to bind them to.
  const identity = (res.locals.unosimIdentity as RequestIdentity | undefined)?.subject;
  if (!identity) {
    responseError(res, 500, "PROVIDER_UNAVAILABLE", "Tutor-Anfrage konnte nicht autorisiert werden.");
    return undefined;
  }
  if (sessionHandle !== undefined) {
    const pinned = sessions.get(identity, sessionHandle);
    if (!pinned) {
      responseError(res, 400, "INVALID_REQUEST", "Der Tutor-Kontext ist abgelaufen oder ungültig.");
      return undefined;
    }
    return { identity, content: pinned, session: sessionHandle };
  }
  if (request === undefined) return undefined;
  if (!resolver) {
    responseError(res, 400, "INVALID_REQUEST", "Der Course-Content-Kontext ist nicht verfügbar.");
    return undefined;
  }
  const context: RequestContext = {
    identity,
    requestId: req.header("x-request-id") ?? randomUUID(),
    signal,
  };
  let resolved: ResolvedTutorCourseContent;
  try {
    resolved = await resolver.resolveTutorContent(request, context);
  } catch (error) {
    if (!signal.aborted) respondToUnresolvedContent(res, error);
    return undefined;
  }
  if (signal.aborted) return undefined;
  return { identity, content: prepareTutorCourseContentSession(resolved) };
}

/** Sends the error response for unresolved Course Content; the free Tutor needs none. */
export function respondToUnresolvedContent(res: Response, error: unknown): void {
  // Course Content SSOT 11, case G: without the current revision the free Tutor answers.
  if (isSnapshotUnavailable(error)) return;
  if (isStaleCourseContent(error)) {
    // The example's revision is neither a validated snapshot of its selection nor the current one.
    responseError(res, 409, "COURSE_CONTENT_STALE", "Der Kursinhalt wurde aktualisiert. Bitte das Beispiel neu laden.");
    return;
  }
  responseError(res, 400, "INVALID_REQUEST", "Der Course-Content-Kontext ist ungültig oder nicht mehr aktiv.");
}

export function isSnapshotUnavailable(error: unknown): boolean {
  return error instanceof ExamplesError
    && (error.code === "SOURCE_UNAVAILABLE" || error.code === "RATE_LIMITED" || error.code === "LOAD_CAPACITY_EXCEEDED");
}

export function isStaleCourseContent(error: unknown): boolean {
  return error instanceof ExamplesError && (error.code === "INVALID_REVISION" || error.code === "EXAMPLE_NOT_FOUND");
}
