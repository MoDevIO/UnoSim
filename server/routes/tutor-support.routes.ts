import type { Express, Request, Response } from "express";
import type { TutorContentResult, TutorDialogTurn, TutorSupportState } from "@shared/tutor";
import {
  tutorSupportRequestSchema,
  type TutorReferenceView,
  type TutorSupportRequest,
  type TutorSupportResponse,
} from "@shared/tutor-support";
import type { BoardId } from "@shared/boards";
import type { Logger } from "@shared/logger";
import { config } from "../config";
import type { RequestIdentity } from "../security/access-control";
import { canonicalDigest } from "../services/tutor/evaluation/canonical";
import { TutorProviderError } from "../services/tutor/llm-provider";
import { classifyLearnerInput } from "../services/tutor/learning-support";
import {
  newSupportQuestion,
  resetSupportQuestion,
  supportStateView,
  withClarification,
  type SupportQuestion,
  type SupportUpdate,
  type TutorSupportStore,
} from "../services/tutor/learning-support-store";
import { resolveQuestionReference, type QuestionReference } from "../services/tutor/question-reference";
import type { TutorService, TutorSource } from "../services/tutor/tutor-service";
import type {
  PinnedTutorCourseContent,
  TutorCourseContentResolver,
  TutorCourseContentSessionStore,
} from "../services/course-content/course-content-session";
import {
  bindRequestAbortSignal,
  commitTutorSession,
  enforceTutorRateLimit,
  mapProviderError,
  requireRequestCredential,
  resolveTutorContent,
  responseError,
  tutorSource,
  type TutorRequestContent,
} from "./tutor-route-helpers";

export interface TutorSupportContext {
  readonly service: TutorService;
  readonly sessionStore: TutorCourseContentSessionStore;
  readonly supportStore: TutorSupportStore;
  readonly courseContent?: TutorCourseContentResolver;
  readonly logger: Pick<Logger, "warn" | "error">;
}

/** Why a support action cannot run on the server's state; mapped to a 409 without counting anything. */
class SupportActionRejected extends Error {
  constructor(readonly code: "SUPPORT_CONFLICT" | "SUPPORT_LOCKED", message: string) {
    super(message);
  }
}

type SketchFields = {
  readonly code: string;
  readonly headers?: readonly { readonly name: string; readonly content: string }[];
  readonly entryFile?: string;
  readonly board?: BoardId;
};

/**
 * What the question was asked for: the code with all project files, the board and the pinned Course
 * Content. When it changes, the question's counters and unlocks start over (LearningQuestions R-SUP-6).
 */
function contextKey(sketch: SketchFields, content: PinnedTutorCourseContent | undefined): string {
  return canonicalDigest({
    code: sketch.code,
    headers: sketch.headers ?? [],
    entryFile: sketch.entryFile ?? null,
    board: sketch.board ?? null,
    course: content ? { repository: content.repository, revision: content.revision, exampleId: content.exampleId ?? null } : null,
  });
}

/** The code the reference must fit: the entry file and every header, as the Tutor sees the project. */
function projectCode(sketch: SketchFields): string {
  return [sketch.code, ...(sketch.headers ?? []).map(({ content }) => content)].join("\n");
}

function identityOf(res: Response): string | undefined {
  return (res.locals.unosimIdentity as RequestIdentity | undefined)?.subject;
}

function referenceOf(question: string, sketch: SketchFields, content: PinnedTutorCourseContent | undefined): QuestionReference {
  return resolveQuestionReference(question, projectCode(sketch), content);
}

function referenceView(reference: QuestionReference): TutorReferenceView {
  if (reference.status === "unavailable") return { status: "unavailable", reason: reference.reason };
  const { answer, explanation, assumptions } = reference.reference;
  return { status: "available", answer, explanation, ...(assumptions ? { assumptions: [...assumptions] } : {}) };
}

/**
 * Opens the support session of a newly delivered question (`learningSupport: true`); returns its state, or
 * nothing when the request has no authenticated subject to own it.
 */
export function openSupportSession(
  res: Response,
  store: TutorSupportStore,
  question: string,
  sketch: SketchFields,
  content: PinnedTutorCourseContent | undefined,
): TutorSupportState | undefined {
  const identity = identityOf(res);
  if (!identity) return undefined;
  const asked = newSupportQuestion(question, contextKey(sketch, content));
  const session = store.open(identity, asked);
  return supportStateView(session, asked, referenceOf(question, sketch, content).status === "available");
}

/** The fingerprint of a request for duplicate detection; the credential and the action id are not part of it. */
function requestFingerprint(body: Record<string, unknown>): string {
  const { credential: _credential, actionId: _actionId, ...rest } = body;
  return canonicalDigest(rest);
}

/** The active question as the action finds it, reset when its code, board or Course Content changed. */
function activeQuestion(
  question: SupportQuestion | null,
  questionHandle: string,
  questionText: string | undefined,
  key: string,
): SupportQuestion {
  if (!question || question.outcome !== "open") {
    throw new SupportActionRejected("SUPPORT_CONFLICT", "Diese Frage ist nicht mehr offen.");
  }
  if (question.handle !== questionHandle || (questionText !== undefined && questionText !== question.text)) {
    throw new SupportActionRejected("SUPPORT_CONFLICT", "Die Aktion gehört zu einer anderen Frage.");
  }
  return question.contextKey === key ? question : resetSupportQuestion(question, key);
}

type DialogRequest = SketchFields & {
  readonly history: readonly TutorDialogTurn[];
  readonly question: string;
  readonly answer: string;
  readonly credential?: string;
  readonly model?: string;
  readonly difficulty: number;
  readonly courseContent?: TutorSupportRequest["courseContent"];
  readonly courseContentSession?: string;
  readonly supportSession?: string;
  readonly questionHandle?: string;
  readonly actionId?: string;
};

/**
 * Runs one support action under the session's lock and answers it; a retry of the same action gets the
 * stored result (R-SUP-1). Errors before the action was applied leave the state unchanged.
 */
async function runSupportAction<T>(
  req: Request,
  res: Response,
  request: Record<string, unknown> & { readonly supportSession: string; readonly actionId: string; readonly courseContent?: TutorSupportRequest["courseContent"]; readonly courseContentSession?: string },
  signal: AbortSignal,
  context: TutorSupportContext,
  action: (content: TutorRequestContent | undefined) => (view: Parameters<Parameters<TutorSupportStore["run"]>[4]>[0]) => Promise<{ readonly body: T; readonly update: SupportUpdate }>,
): Promise<void> {
  const identity = identityOf(res);
  if (!identity) {
    responseError(res, 500, "PROVIDER_UNAVAILABLE", "Tutor-Anfrage konnte nicht autorisiert werden.");
    return;
  }
  try {
    const content = await resolveTutorContent(req, res, request.courseContent, request.courseContentSession, context.courseContent, context.sessionStore, signal);
    if (signal.aborted || res.headersSent) return;
    const outcome = await context.supportStore.run(identity, request.supportSession, request.actionId, requestFingerprint(request), action(content));
    if (signal.aborted) return;
    if (outcome.status === "missing") {
      responseError(res, 400, "SUPPORT_SESSION_INVALID", "Der Lernhilfe-Zustand ist abgelaufen. Bitte eine neue Lernfrage anfordern.");
      return;
    }
    if (outcome.status === "conflict") {
      responseError(res, 409, "SUPPORT_CONFLICT", "Diese Aktion wurde bereits mit anderen Angaben gesendet.");
      return;
    }
    res.json(outcome.body);
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof SupportActionRejected) {
      responseError(res, 409, error.code, error.message);
      return;
    }
    if (error instanceof TutorProviderError) {
      mapProviderError(res, error);
      return;
    }
    context.logger.error("Tutor support request failed without exposing provider details");
    responseError(res, 500, "PROVIDER_UNAVAILABLE", "Die Tutor-Anfrage ist fehlgeschlagen.");
  }
}

function sourceOf(request: SketchFields): TutorSource | BoardId | undefined {
  return tutorSource(request)[0];
}

/**
 * An answer in the learning-support cycle (`POST /api/tutor/dialog` with a support binding). A typed question
 * about the question is a clarification and a typed request for help gets a hint; neither is rated or uses an
 * answer attempt (R-SUP-1). An answer counts one attempt; a weak one keeps the question open (R-SUP-3).
 */
export async function handleSupportedDialog(
  req: Request,
  res: Response,
  request: DialogRequest & { readonly supportSession: string; readonly questionHandle?: string; readonly actionId?: string },
  signal: AbortSignal,
  context: TutorSupportContext,
): Promise<void> {
  const binding = { supportSession: request.supportSession, questionHandle: request.questionHandle!, actionId: request.actionId! };
  await runSupportAction<Record<string, unknown>>(req, res, { ...request, ...binding }, signal, context, (content) => async (view) => {
    const key = contextKey(request, content?.content);
    const question = activeQuestion(view.question, binding.questionHandle, request.question, key);
    const reference = referenceOf(question.text, request, content?.content);
    const input = classifyLearnerInput(request.answer);
    if (input !== "answer") {
      const explained = await context.service.generateSupportExplanation({
        kind: input === "clarification" ? "clarify" : "hint",
        code: request.code,
        question: question.text,
        credential: request.credential,
        requestedModel: request.model,
        earlierClarifications: question.clarificationTexts,
        ...(input === "clarification" ? { learnerQuestion: request.answer } : {}),
        ...(reference.status === "available" ? { reference: reference.reference } : {}),
        courseContent: content?.content,
        signal,
        source: sourceOf(request),
      });
      signal.throwIfAborted();
      const next = input === "clarification" ? withClarification(question, explained.explanation) : question;
      const session = commitTutorSession(content, context.sessionStore);
      return {
        update: { question: next },
        body: {
          responseStyle: "normal" as const,
          feedback: explained.explanation,
          question: question.text,
          learnerInput: input,
          provider: config.tutor.provider,
          model: explained.model,
          support: supportStateView(view.handle, next, reference.status === "available"),
          ...(session ? { courseContentSession: session } : {}),
        },
      };
    }
    const generated = await context.service.generateDialogResponse(
      request.code,
      request.history,
      question.text,
      request.answer,
      request.credential,
      request.model,
      request.difficulty,
      content?.content,
      signal,
      sourceOf(request),
      { ...(reference.status === "available" ? { reference: reference.reference } : {}), assisted: question.referenceShown },
    );
    signal.throwIfAborted();
    // Only an answer to the subject counts; a reply that leads away from the sketch does not (R-SUP-1).
    const counted = generated.result.responseStyle === "normal" ? 1 : 0;
    const answered = { ...question, answerAttempts: question.answerAttempts + counted };
    const nextQuestion = generated.retained
      ? answered
      : newSupportQuestion(generated.result.question, key);
    const nextReference = generated.retained ? reference : referenceOf(nextQuestion.text, request, content?.content);
    const session = generated.withoutProvider ? content?.session : commitTutorSession(content, context.sessionStore);
    // An answer after the reference answer repeats it: feedback, but no rating (R-SUP-5).
    const result: TutorContentResult = question.referenceShown && generated.result.responseStyle === "normal"
      ? withoutRating(generated.result)
      : generated.result;
    return {
      update: { question: nextQuestion },
      body: {
        ...result,
        learnerInput: "answer" as const,
        provider: config.tutor.provider,
        model: generated.model,
        support: supportStateView(view.handle, nextQuestion, nextReference.status === "available"),
        ...(session ? { courseContentSession: session } : {}),
      },
    };
  });
}

function withoutRating(result: TutorContentResult): TutorContentResult {
  if (result.responseStyle !== "normal") return result;
  const { answerRating: _rating, ...rest } = result;
  return rest;
}

/** The explicit support actions on the asked question: `POST /api/tutor/support` (LearningQuestions 9.1, 11.3). */
export function registerTutorSupportRoute(
  app: Express,
  context: TutorSupportContext & { readonly rateLimiter?: Parameters<typeof enforceTutorRateLimit>[1]["rateLimiter"]; readonly disableRateLimit?: boolean },
): void {
  app.post("/api/tutor/support", async (req, res) => {
    const signal = bindRequestAbortSignal(req, res);
    if (!enforceTutorRateLimit(res, context)) return;
    const parsed = tutorSupportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      responseError(res, 400, "INVALID_REQUEST", "Lernhilfe-Aktion, Sketch oder Modellangaben sind ungültig.");
      return;
    }
    if (!requireRequestCredential(req, res, parsed.data.credential)) return;
    const request = parsed.data;
    await runSupportAction(req, res, request, signal, context, (content) => async (view) => {
      const key = contextKey(request, content?.content);
      const question = activeQuestion(view.question, request.questionHandle, undefined, key);
      const reference = referenceOf(question.text, request, content?.content);
      const available = reference.status === "available";
      const base = { provider: config.tutor.provider };
      switch (request.action) {
        case "clarify":
        case "hint": {
          const explained = await context.service.generateSupportExplanation({
            kind: request.action,
            code: request.code,
            question: question.text,
            credential: request.credential,
            requestedModel: request.model,
            earlierClarifications: question.clarificationTexts,
            ...(available ? { reference: reference.reference } : {}),
            courseContent: content?.content,
            signal,
            source: sourceOf(request),
          });
          signal.throwIfAborted();
          const next = request.action === "clarify" ? withClarification(question, explained.explanation) : question;
          return {
            update: { question: next },
            body: supportBody({ ...base, action: request.action, explanation: explained.explanation, model: explained.model, support: supportStateView(view.handle, next, available) }, content, context),
          };
        }
        case "reveal": {
          const view0 = supportStateView(view.handle, question, available);
          if (!view0.canRevealReference) {
            throw new SupportActionRejected("SUPPORT_LOCKED", "Die Musterantwort ist erst nach drei eigenen Antwortversuchen verfügbar.");
          }
          // Nothing is shown without a reviewed, applicable reference, so nothing counts as shown (R-SUP-3).
          const next = available ? { ...question, referenceShown: true } : question;
          return {
            update: { question: next },
            body: supportBody({ ...base, action: "reveal", reference: referenceView(reference), model: request.model ?? "reference", support: supportStateView(view.handle, next, available) }, content, context),
          };
        }
        case "skip": {
          if (!supportStateView(view.handle, question, available).canSkip) {
            throw new SupportActionRejected("SUPPORT_LOCKED", "Überspringen ist erst nach zwei beantworteten Klärungsnachfragen möglich.");
          }
          const next = await context.service.generateNextQuestion({
            code: request.code,
            credential: request.credential,
            requestedModel: request.model,
            difficulty: request.difficulty,
            courseContent: content?.content,
            signal,
            source: sourceOf(request),
            options: { leave: { question: question.text, history: request.history }, avoidQuestions: [...view.skippedQuestions, question.text] },
          });
          signal.throwIfAborted();
          const skipped: SupportQuestion = { ...question, outcome: "skipped" };
          if (next.completed) {
            return {
              update: { question: skipped, skippedQuestion: question.text },
              body: supportBody({ ...base, action: "skip", completed: true, model: next.model, ...(next.focusProgress ? { focusProgress: next.focusProgress } : {}) }, content, context),
            };
          }
          const asked = newSupportQuestion(next.result.question, key);
          const { answerRating: _rating, focusProgress, ...nextContent } = next.result.responseStyle === "normal"
            ? next.result
            : { ...next.result, responseStyle: "normal" as const };
          return {
            update: { question: asked, skippedQuestion: question.text },
            body: supportBody({
              ...base,
              action: "skip",
              next: { ...nextContent, responseStyle: "normal" },
              model: next.model,
              support: supportStateView(view.handle, asked, referenceOf(asked.text, request, content?.content).status === "available"),
              ...(focusProgress ? { focusProgress } : {}),
            }, content, context),
          };
        }
      }
    });
  });
}

/** Adds the Course Content session, committed only now that the action succeeded. */
function supportBody(body: TutorSupportResponse, content: TutorRequestContent | undefined, context: TutorSupportContext): TutorSupportResponse {
  const session = commitTutorSession(content, context.sessionStore);
  return session ? { ...body, courseContentSession: session } : body;
}
