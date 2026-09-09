import type { Express, Request, Response } from "express";
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
import type { RequestIdentity } from "../security/access-control";

type TutorRouteDeps = {
  readonly service?: TutorService;
  readonly logger?: Pick<Logger, "warn" | "error">;
  readonly rateLimiter?: { checkLimit: (identity: string) => { allowed: true } | { allowed: false; retryAfter: number } };
  readonly disableRateLimit?: boolean;
};

function responseError(
  res: Response,
  status: number,
  code: "TUTOR_DISABLED" | "CREDENTIAL_REQUIRED" | "CREDENTIAL_INVALID" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "RATE_LIMITED" | "MODEL_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE" | "INVALID_REQUEST",
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
  return req.secure || isLoopbackRequest(req);
}

function requireRequestCredential(req: Request, res: Response, credential: string | undefined): boolean {
  if (config.tutor.mode === "user-key" && !credential?.trim()) {
    responseError(res, 400, "CREDENTIAL_REQUIRED", "Für den Pilotbetrieb wird ein persönlicher Tutor-Key benötigt.");
    return false;
  }
  if (config.tutor.mode === "user-key" && !hasSafeCredentialTransport(req)) {
    responseError(res, 400, "INVALID_REQUEST", "Persönliche Tutor-Keys werden außerhalb von Loopback nur über HTTPS übertragen.");
    return false;
  }
  return true;
}

export function registerTutorRoutes(app: Express, deps: TutorRouteDeps = {}): void {
  const logger = deps.logger ?? new Logger("TutorRoutes");
  const service = deps.service ?? new TutorService(new KiconnectProvider());
  const rateLimiter = deps.rateLimiter ?? (deps.disableRateLimit ? undefined : getTutorRateLimiter());

  app.post("/api/tutor/question", async (req, res) => {
    if (config.tutor.mode === "disabled") {
      responseError(res, 404, "TUTOR_DISABLED", "Das Tutor-Feature ist deaktiviert.");
      return;
    }
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorQuestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Sketch, Zugang und Modellangaben sind ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const generated = await service.generateQuestion(
        parsed.data.code,
        parsed.data.credential,
        parsed.data.model,
      );
      res.json({
        ...generated.result,
        provider: config.tutor.provider,
        mode: config.tutor.mode,
        model: generated.model,
      });
    } catch (error) {
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor request failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Anfrage ist fehlgeschlagen.");
    }
  });

  app.post("/api/tutor/models", async (req, res) => {
    if (config.tutor.mode === "disabled") {
      responseError(res, 404, "TUTOR_DISABLED", "Das Tutor-Feature ist deaktiviert.");
      return;
    }
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorModelsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Der Tutor-Zugang ist ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const models = await service.getAvailableModels(parsed.data.credential);
      res.json({ models });
    } catch (error) {
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor model discovery failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Modelle konnten nicht geladen werden.");
    }
  });

  app.post("/api/tutor/dialog", async (req, res) => {
    if (config.tutor.mode === "disabled") {
      responseError(res, 404, "TUTOR_DISABLED", "Das Tutor-Feature ist deaktiviert.");
      return;
    }
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorDialogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Dialogverlauf, Antwort, Sketch oder Modellangaben sind ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const generated = await service.generateDialogResponse(
        parsed.data.code,
        parsed.data.history,
        parsed.data.question,
        parsed.data.answer,
        parsed.data.credential,
        parsed.data.model,
      );
      res.json({
        ...generated.result,
        provider: config.tutor.provider,
        mode: config.tutor.mode,
        model: generated.model,
      });
    } catch (error) {
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor dialog request failed without exposing provider details");
      responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Anfrage ist fehlgeschlagen.");
    }
  });
}
