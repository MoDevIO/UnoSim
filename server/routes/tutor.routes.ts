import {
  enterTutorUmlArtifacts,
  serializeTutorDiagram,
  tutorUmlSupportLifecycle,
} from "../services/tutor/uml/service";
import type { RequestIdentity } from "../security/access-control";
import { tutorDiagnosticMiddleware } from "./tutor-diagnostics";
import type { Express } from "express";
import {
  tutorDialogRequestSchema,
  tutorModelsRequestSchema,
  tutorQuestionRequestSchema,
} from "@shared/tutor-requests";
import { config } from "../config";
import { Logger } from "@shared/logger";
import { getTutorRateLimiter } from "../services/rate-limiter";
import { KiconnectProvider } from "../services/tutor/kiconnect-provider";
import { TutorProviderError } from "../services/tutor/llm-provider";
import type { TutorService } from "../services/tutor/tutor-service";
import { createTutorService } from "../services/tutor/tutor-service-factory";
import {
  TutorCourseContentSessionStore,
  type TutorCourseContentResolver,
} from "../services/course-content/course-content-session";
import { TutorSupportStore } from "../services/tutor/learning-support-store";
import {
  bindRequestAbortSignal,
  commitTutorSession,
  enforceTutorRateLimit,
  mapProviderError,
  requireRequestCredential,
  resolveTutorContent,
  responseError,
  tutorSource,
} from "./tutor-route-helpers";
import {
  handleSupportedDialog,
  openSupportSession,
  registerTutorSupportRoute,
} from "./tutor-support.routes";

type TutorRouteDeps = {
  readonly service?: TutorService;
  readonly logger?: Pick<Logger, "warn" | "error">;
  readonly rateLimiter?: {
    checkLimit: (
      identity: string,
    ) => { allowed: true } | { allowed: false; retryAfter: number };
  };
  readonly disableRateLimit?: boolean;
  readonly courseContent?: TutorCourseContentResolver;
  readonly sessionStore?: TutorCourseContentSessionStore;
  readonly supportStore?: TutorSupportStore;
};

type GraphicsRequest = Parameters<typeof tutorSource>[0] & {
  graphicsMode?: NonNullable<Parameters<TutorService["generateQuestion"]>[7]>;
  graphicsProfile?: NonNullable<
    Parameters<TutorService["generateQuestion"]>[8]
  >;
};
function questionOptions(
  data: GraphicsRequest,
): [
  source?: Parameters<TutorService["generateQuestion"]>[6],
  graphicsMode?: GraphicsRequest["graphicsMode"],
  graphicsProfile?: GraphicsRequest["graphicsProfile"],
] {
  const source = tutorSource(data);
  if (data.graphicsProfile !== undefined)
    return [source[0], data.graphicsMode, data.graphicsProfile];
  if (data.graphicsMode !== undefined) return [source[0], data.graphicsMode];
  return source;
}
function dialogOptions(
  data: GraphicsRequest,
): [
  source?: Parameters<TutorService["generateDialogResponse"]>[9],
  support?: undefined,
  graphicsMode?: GraphicsRequest["graphicsMode"],
  graphicsProfile?: GraphicsRequest["graphicsProfile"],
] {
  const source = tutorSource(data);
  if (data.graphicsProfile !== undefined)
    return [source[0], undefined, data.graphicsMode, data.graphicsProfile];
  if (data.graphicsMode !== undefined)
    return [source[0], undefined, data.graphicsMode];
  return source;
}

export function registerTutorRoutes(
  app: Express,
  deps: TutorRouteDeps = {},
): void {
  const logger = deps.logger ?? new Logger("TutorRoutes");
  const service = deps.service ?? createTutorService(new KiconnectProvider());
  const rateLimiter =
    deps.rateLimiter ??
    (deps.disableRateLimit ? undefined : getTutorRateLimiter());
  const sessionStore =
    deps.sessionStore ?? new TutorCourseContentSessionStore();
  const supportStore =
    deps.supportStore ??
    new TutorSupportStore(undefined, undefined, tutorUmlSupportLifecycle);
  const supportContext = {
    service,
    sessionStore,
    supportStore,
    courseContent: deps.courseContent,
    logger,
  };

  app.use("/api/tutor", (req, res, next) => {
    const owner = (res.locals.unosimIdentity as RequestIdentity | undefined)
      ?.subject;
    const json = res.json.bind(res);
    res.json = (body: unknown) => json(serializeTutorDiagram(body, owner));
    const release = enterTutorUmlArtifacts(
      owner,
      typeof req.body?.supportSession === "string"
        ? req.body.supportSession
        : undefined,
      next,
    );
    res.once("finish", release);
    res.once("close", release);
  });
  app.use("/api/tutor", tutorDiagnosticMiddleware);

  app.post("/api/tutor/question", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorQuestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(
        res,
        400,
        "INVALID_REQUEST",
        "Sketch, Zugang und Modellangaben sind ungültig.",
      );
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const content = await resolveTutorContent(
        req,
        res,
        parsed.data.courseContent,
        parsed.data.courseContentSession,
        deps.courseContent,
        sessionStore,
        signal,
        parsed.data.aspectFocus,
      );
      if (signal.aborted) return;
      if (res.headersSent) return;
      const options = questionOptions(parsed.data);
      const generated = await service.generateQuestion(
        parsed.data.code,
        parsed.data.credential,
        parsed.data.model,
        parsed.data.difficulty,
        content?.content,
        signal,
        ...options,
      );
      if (signal.aborted) return;
      const session = commitTutorSession(content, sessionStore);
      const support = parsed.data.learningSupport
        ? openSupportSession(
            res,
            supportStore,
            generated.result.question,
            parsed.data,
            content?.content,
            session,
            {
              graphic: generated.result,
              diagramArtifact: generated._diagramArtifact,
            },
          )
        : undefined;
      res.json({
        ...generated.result,
        ...(generated._diagramArtifact
          ? { _diagramArtifact: generated._diagramArtifact }
          : {}),
        provider: config.tutor.provider,
        model: generated.model,
        ...(session ? { courseContentSession: session } : {}),
        ...(support ? { support } : {}),
      });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error("Tutor request failed without exposing provider details");
      responseError(
        res,
        500,
        "PROVIDER_UNAVAILABLE",
        "Die Tutor-Anfrage ist fehlgeschlagen.",
      );
    }
  });

  app.post("/api/tutor/models", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorModelsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(
        res,
        400,
        "INVALID_REQUEST",
        "Der Tutor-Zugang ist ungültig.",
      );
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;

    try {
      const models = await service.getAvailableModels(
        parsed.data.credential,
        signal,
      );
      if (signal.aborted) return;
      res.json({ models });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TutorProviderError) {
        mapProviderError(res, error);
        return;
      }
      logger.error(
        "Tutor model discovery failed without exposing provider details",
      );
      responseError(
        res,
        500,
        "PROVIDER_UNAVAILABLE",
        "Die Tutor-Modelle konnten nicht geladen werden.",
      );
    }
  });

  app.post("/api/tutor/dialog", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, { ...deps, rateLimiter })) return;

    const parsed = tutorDialogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(
        res,
        400,
        "INVALID_REQUEST",
        "Dialogverlauf, Antwort, Sketch oder Modellangaben sind ungültig.",
      );
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;
    if (parsed.data.supportSession !== undefined) {
      await handleSupportedDialog(
        req,
        res,
        { ...parsed.data, supportSession: parsed.data.supportSession },
        signal,
        supportContext,
      );
      return;
    }

    try {
      const content = await resolveTutorContent(
        req,
        res,
        parsed.data.courseContent,
        parsed.data.courseContentSession,
        deps.courseContent,
        sessionStore,
        signal,
        parsed.data.aspectFocus,
      );
      if (signal.aborted) return;
      if (res.headersSent) return;
      const options = dialogOptions(parsed.data);
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
        ...options,
      );
      if (signal.aborted) return;
      // A provider-free fallback verified no credential: it may use an existing session but not create one.
      const session = generated.withoutProvider
        ? content?.session
        : commitTutorSession(content, sessionStore);
      res.json({
        ...generated.result,
        ...(generated._diagramArtifact
          ? { _diagramArtifact: generated._diagramArtifact }
          : {}),
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
      logger.error(
        "Tutor dialog request failed without exposing provider details",
      );
      responseError(
        res,
        500,
        "PROVIDER_UNAVAILABLE",
        "Die Tutor-Anfrage ist fehlgeschlagen.",
      );
    }
  });

  registerTutorSupportRoute(app, {
    ...supportContext,
    rateLimiter,
    disableRateLimit: deps.disableRateLimit,
  });
}
