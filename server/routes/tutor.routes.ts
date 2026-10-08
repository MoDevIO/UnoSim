import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  tutorDialogRequestSchema,
  tutorModelsRequestSchema,
  tutorQuestionRequestSchema,
} from "@shared/tutor";
import { config } from "../config";
import { Logger } from "@shared/logger";
import { getTutorRateLimiter } from "../services/rate-limiter";
import { KiconnectProvider } from "../services/tutor/kiconnect-provider";
import {
  TutorProviderError,
} from "../services/tutor/llm-provider";
import { TutorService } from "../services/tutor/tutor-service";
import { createTutorService } from "../services/tutor/tutor-service-factory";
import type { RequestIdentity } from "../security/access-control";
import {
  prepareTutorCourseContentSession,
  TutorCourseContentSessionStore,
  type PinnedTutorCourseContent,
  type ResolvedTutorCourseContent,
  type TutorCourseContentResolver,
} from "../services/course-content/course-content-session";
import { ExamplesError } from "../services/examples/examples-error";
import type { RequestContext } from "../services/examples/source-provider";
import type { TutorCourseContentContext } from "@shared/tutor";

type TutorRouteDeps = {
  readonly service?: TutorService;
  readonly logger?: Pick<Logger, "warn" | "error">;
  readonly rateLimiter?: { checkLimit: (identity: string) => { allowed: true } | { allowed: false; retryAfter: number } };
  readonly disableRateLimit?: boolean;
  readonly courseContent?: TutorCourseContentResolver;
  readonly sessionStore?: TutorCourseContentSessionStore;
};

function responseError(
  res: Response,
  status: number,
  code: "CREDENTIAL_REQUIRED" | "CREDENTIAL_INVALID" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "RATE_LIMITED" | "MODEL_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE" | "INVALID_REQUEST" | "COURSE_CONTENT_STALE",
  message: string,
  retryAfter?: number,
): void {
  if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
  res.status(status).json({ error: { code, message, ...(retryAfter === undefined ? {} : { retryAfter }) } });
}

function mapProviderError(res: Response, error: TutorProviderError): void {
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

function enforceTutorRateLimit(res: Response, deps: TutorRouteDeps): boolean {
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

function isLoopbackRequest(req: Request): boolean {
  const address = req.ip || req.socket.remoteAddress || "";
  const normalizedAddress = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return normalizedAddress === "127.0.0.1" || normalizedAddress === "::1";
}

function hasSafeCredentialTransport(req: Request): boolean {
  return req.secure || isLoopbackRequest(req) || config.dockerTestBypassGateway;
}

function requireRequestCredential(req: Request, res: Response, credential: string | undefined): boolean {
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

function bindRequestAbortSignal(req: Request, res: Response): AbortSignal {
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

export function registerTutorRoutes(app: Express, deps: TutorRouteDeps = {}): void {
  const logger = deps.logger ?? new Logger("TutorRoutes");
  const service = deps.service ?? createTutorService(new KiconnectProvider());
  const rateLimiter = deps.rateLimiter ?? (deps.disableRateLimit ? undefined : getTutorRateLimiter());
  const sessionStore = deps.sessionStore ?? new TutorCourseContentSessionStore();

  app.post("/api/tutor/question", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorQuestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Sketch, Zugang und Modellangaben sind ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const content = await resolveTutorContent(req, res, parsed.data.courseContent, parsed.data.courseContentSession, deps.courseContent, sessionStore, signal);
      if (signal.aborted) return;
      if ((parsed.data.courseContent !== undefined || parsed.data.courseContentSession !== undefined) && !content) return;
      const generated = await service.generateQuestion(
        parsed.data.code,
        parsed.data.credential,
        parsed.data.model,
        parsed.data.difficulty,
        content?.content,
        signal,
      );
      if (signal.aborted) return;
      const session = commitTutorSession(content, sessionStore);
      res.json({
        ...generated.result,
        provider: config.tutor.provider,
        model: generated.model,
        ...(session ? { courseContentSession: session } : {}),
      });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor request failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Anfrage ist fehlgeschlagen.");
    }
  });

  app.post("/api/tutor/models", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorModelsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Der Tutor-Zugang ist ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const models = await service.getAvailableModels(parsed.data.credential, signal);
      if (signal.aborted) return;
      res.json({ models });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor model discovery failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Modelle konnten nicht geladen werden.");
    }
  });

  app.post("/api/tutor/dialog", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorDialogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Dialogverlauf, Antwort, Sketch oder Modellangaben sind ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const content = await resolveTutorContent(req, res, parsed.data.courseContent, parsed.data.courseContentSession, deps.courseContent, sessionStore, signal);
      if (signal.aborted) return;
      if ((parsed.data.courseContent !== undefined || parsed.data.courseContentSession !== undefined) && !content) return;
      const generated = await service.generateDialogResponse(
        parsed.data.code,
        parsed.data.history,
        parsed.data.question,
        parsed.data.answer,
        parsed.data.credential,
        parsed.data.model,
        parsed.data.difficulty,
        content?.content,
        signal,
      );
      if (signal.aborted) return;
      const session = commitTutorSession(content, sessionStore);
      res.json({
        ...generated.result,
        provider: config.tutor.provider,
        model: generated.model,
        ...(session ? { courseContentSession: session } : {}),
      });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor dialog request failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Anfrage ist fehlgeschlagen.");
    }
  });
}

type TutorRequestContent = {
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
function commitTutorSession(content: TutorRequestContent | undefined, sessions: TutorCourseContentSessionStore): string | undefined {
  if (!content) return undefined;
  return content.session ?? sessions.commit(content.identity, content.content);
}

async function resolveTutorContent(
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
    if (signal.aborted) return undefined;
    if (isStaleCourseContent(error)) {
      // The example's revision is neither a validated snapshot of its selection nor the current one.
      responseError(res, 409, "COURSE_CONTENT_STALE", "Der Kursinhalt wurde aktualisiert. Bitte das Beispiel neu laden.");
      return undefined;
    }
    responseError(res, 400, "INVALID_REQUEST", "Der Course-Content-Kontext ist ungültig oder nicht mehr aktiv.");
    return undefined;
  }
  if (signal.aborted) return undefined;
  return { identity, content: prepareTutorCourseContentSession(resolved) };
}

function isStaleCourseContent(error: unknown): boolean {
  return error instanceof ExamplesError && (error.code === "INVALID_REVISION" || error.code === "EXAMPLE_NOT_FOUND");
}
