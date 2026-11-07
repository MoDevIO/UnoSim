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
  withAnswerAttempt,
  withClarification,
  type SupportQuestion,
  type SupportSessionView,
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

/**
 * Why a support action cannot run on the server's state; answered without counting or committing anything.
 * `SUPPORT_SESSION_INVALID` (400) asks for a new learning question, the others (409) for the current one.
 */
class SupportActionRejected extends Error {
  constructor(readonly code: "SUPPORT_CONFLICT" | "SUPPORT_LOCKED" | "SUPPORT_SESSION_INVALID", message: string) {
    super(message);
  }

  get status(): 400 | 409 {
    return this.code === "SUPPORT_SESSION_INVALID" ? 400 : 409;
  }
}

/**
 * The support session is bound to the Course session it was opened with (review R5). A session opened while
 * the Course source was unavailable is bound to the free Tutor; once the source answers again, the request
 * brings Course Content that is new to this question. The question then belongs to another context, so the
 * learner starts a new question instead of getting a success whose Course session the support session would
 * reject afterwards (review N4). Nothing is committed for such a request.
 */
function checkCourseBinding(view: SupportSessionView, content: TutorRequestContent | undefined): void {
  if (view.courseSession === null && content !== undefined && content.session === undefined) {
    throw new SupportActionRejected("SUPPORT_SESSION_INVALID", "Der Kursinhalt ist wieder verfügbar. Bitte eine neue Lernfrage anfordern.");
  }
  if (view.courseSession !== (content?.session ?? null)) {
    throw new SupportActionRejected("SUPPORT_CONFLICT", "Lernhilfe und Kurs-Kontext gehören zu verschiedenen Dialogen.");
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

function identityOf(res: Response): string | undefined {
  return (res.locals.unosimIdentity as RequestIdentity | undefined)?.subject;
}

function referenceOf(question: string, sketch: SketchFields, content: PinnedTutorCourseContent | undefined): QuestionReference {
  // The reference must fit the whole project: the entry code, every header and the board (reviews N1, E1).
  return resolveQuestionReference(question, { code: sketch.code, headers: sketch.headers ?? [], board: sketch.board }, content);
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
  courseSession: string | undefined,
): TutorSupportState | undefined {
  const identity = identityOf(res);
  if (!identity) return undefined;
  const asked = newSupportQuestion(question, contextKey(sketch, content));
  // Bound to this Course session: an action with another one belongs to another dialog (review R5).
  const session = store.open(identity, asked, courseSession ?? null);
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
  if (question?.outcome !== "open") {
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
  readonly courseContent?: NonNullable<TutorSupportRequest["courseContent"]>;
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
  request: Record<string, unknown> & { readonly supportSession: string; readonly actionId: string; readonly courseContent?: NonNullable<TutorSupportRequest["courseContent"]>; readonly courseContentSession?: string },
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
    const run = action(content);
    const outcome = await context.supportStore.run(identity, request.supportSession, request.actionId, requestFingerprint(request), async (view) => {
      // Aborted while waiting in the session's queue: nothing runs and nothing is applied (review R6).
      signal.throwIfAborted();
      checkCourseBinding(view, content);
      const result = await run(view);
      signal.throwIfAborted();
      return result;
    });
    if (signal.aborted) return;
    if (outcome.status === "exhausted") {
      responseError(res, 400, "SUPPORT_SESSION_INVALID", "Diese Lernhilfe hat ihr Aktionslimit erreicht. Bitte eine neue Lernfrage anfordern.");
      return;
    }
    if (outcome.status === "missing") {
      responseError(res, 400, "SUPPORT_SESSION_INVALID", "Der Lernhilfe-Zustand ist abgelaufen. Bitte eine neue Lernfrage anfordern.");
      return;
    }
    if (outcome.status === "spent") {
      responseError(res, 409, "SUPPORT_CONFLICT", "Diese Aktion wurde bereits ausgeführt; ihr Ergebnis ist nicht mehr verfügbar.");
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
      responseError(res, error.status, error.code, error.message);
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

type SessionView = Parameters<Parameters<TutorSupportStore["run"]>[4]>[0];
type ActionResult<T> = { readonly body: T; readonly update: SupportUpdate };

/** What every action of one request shares: the request, its Course Content, the signal and the context. */
interface ActionScope<R extends SketchFields> {
  readonly request: R & { readonly credential?: string; readonly model?: string };
  readonly content: TutorRequestContent | undefined;
  readonly signal: AbortSignal;
  readonly context: TutorSupportContext;
  readonly view: SessionView;
  readonly question: SupportQuestion;
  readonly reference: QuestionReference;
}

function availableReference(reference: QuestionReference) {
  return reference.status === "available" ? { reference: reference.reference } : {};
}

/** A clarification or a hint from the provider; a clarification counts once it was delivered (R-SUP-2). */
async function explain<R extends SketchFields>(scope: ActionScope<R>, kind: "clarify" | "hint", learnerQuestion?: string) {
  const { request, question, signal } = scope;
  const explained = await scope.context.service.generateSupportExplanation({
    kind,
    code: request.code,
    question: question.text,
    credential: request.credential,
    requestedModel: request.model,
    earlierClarifications: question.clarificationTexts,
    ...(learnerQuestion ? { learnerQuestion } : {}),
    ...availableReference(scope.reference),
    courseContent: scope.content?.content,
    signal,
    source: sourceOf(request),
  });
  signal.throwIfAborted();
  const next = kind === "clarify" ? withClarification(question, explained.explanation) : question;
  return { explained, next, support: supportStateView(scope.view.handle, next, scope.reference.status === "available") };
}

/** A typed question about the question, or a request for help: no rating and no answer attempt (R-SUP-1). */
async function answerTypedHelp(scope: ActionScope<DialogRequest>, input: "clarification" | "help"): Promise<ActionResult<Record<string, unknown>>> {
  const { explained, next, support } = await explain(scope, input === "clarification" ? "clarify" : "hint", input === "clarification" ? scope.request.answer : undefined);
  const session = commitTutorSession(scope.content, scope.context.sessionStore);
  return {
    update: { question: next },
    body: {
      responseStyle: "normal" as const,
      feedback: explained.explanation,
      question: scope.question.text,
      learnerInput: input,
      provider: config.tutor.provider,
      model: explained.model,
      support,
      ...(session ? { courseContentSession: session } : {}),
    },
  };
}

/** An answer: counts one attempt; a weak one keeps the question open, a strong one asks the next (R-SUP-3). */
async function answerQuestion(scope: ActionScope<DialogRequest>, key: string): Promise<ActionResult<Record<string, unknown>>> {
  const { request, question, content, signal, context } = scope;
  const generated = await context.service.generateDialogResponse(
    request.code, request.history, question.text, request.answer, request.credential, request.model, request.difficulty,
    content?.content, signal, sourceOf(request),
    { ...availableReference(scope.reference), assisted: question.referenceShown },
  );
  signal.throwIfAborted();
  // Only an answer to the subject counts; a reply that leads away from the sketch does not (R-SUP-1).
  const answered = generated.result.responseStyle === "normal" ? withAnswerAttempt(question) : question;
  const nextQuestion = generated.retained ? answered : newSupportQuestion(generated.result.question, key);
  const nextReference = generated.retained ? scope.reference : referenceOf(nextQuestion.text, request, content?.content);
  const session = generated.withoutProvider ? content?.session : commitTutorSession(content, context.sessionStore);
  // An answer after the reference answer repeats it: feedback, but no rating (R-SUP-5).
  const result = question.referenceShown ? withoutRating(generated.result) : generated.result;
  return {
    update: { question: nextQuestion },
    body: {
      ...result,
      learnerInput: "answer" as const,
      provider: config.tutor.provider,
      model: generated.model,
      support: supportStateView(scope.view.handle, nextQuestion, nextReference.status === "available"),
      ...(session ? { courseContentSession: session } : {}),
    },
  };
}

/**
 * An answer in the learning-support cycle (`POST /api/tutor/dialog` with a support binding). A typed question
 * about the question is a clarification and a typed request for help gets a hint (R-SUP-1).
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
    const scope: ActionScope<DialogRequest> = { request, content, signal, context, view, question, reference: referenceOf(question.text, request, content?.content) };
    const input = classifyLearnerInput(request.answer);
    return input === "answer" ? answerQuestion(scope, key) : answerTypedHelp(scope, input);
  });
}

function withoutRating(result: TutorContentResult): TutorContentResult {
  if (result.responseStyle !== "normal") return result;
  const { answerRating: _rating, ...rest } = result;
  return rest;
}

type SupportScope = ActionScope<TutorSupportRequest>;

async function clarifyOrHint(scope: SupportScope, kind: "clarify" | "hint"): Promise<ActionResult<TutorSupportResponse>> {
  const { explained, next, support } = await explain(scope, kind);
  return {
    update: { question: next },
    body: supportBody({ provider: config.tutor.provider, action: kind, explanation: explained.explanation, model: explained.model, support }, scope.content, scope.context),
  };
}

/** The reviewed reference answer after three own answers; without one nothing is shown or counted (R-SUP-3). */
function reveal(scope: SupportScope): ActionResult<TutorSupportResponse> {
  const { question, reference, view } = scope;
  const available = reference.status === "available";
  if (!supportStateView(view.handle, question, available).canRevealReference) {
    throw new SupportActionRejected("SUPPORT_LOCKED", "Die Musterantwort ist erst nach drei eigenen Antwortversuchen verfügbar.");
  }
  const next = available ? { ...question, referenceShown: true } : question;
  return {
    update: { question: next },
    body: supportBody({
      provider: config.tutor.provider,
      action: "reveal",
      reference: referenceView(reference),
      model: scope.request.model ?? "reference",
      support: supportStateView(view.handle, next, available),
    }, scope.content, scope.context),
  };
}

/** Leaves the question unrated after two clarifications and asks another one, or completes (R-SUP-4). */
async function skip(scope: SupportScope, key: string): Promise<ActionResult<TutorSupportResponse>> {
  const { request, question, view, signal, content, context } = scope;
  if (!supportStateView(view.handle, question, scope.reference.status === "available").canSkip) {
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
  const left = { skippedQuestion: question.text };
  if (next.completed) {
    const focus = next.focusProgress ? { focusProgress: next.focusProgress } : {};
    return {
      update: { question: { ...question, outcome: "skipped" }, ...left },
      body: supportBody({ provider: config.tutor.provider, action: "skip", completed: true, model: next.model, ...focus }, content, context),
    };
  }
  const asked = newSupportQuestion(next.result.question, key);
  const { answerRating: _rating, focusProgress, ...nextContent } = next.result;
  return {
    update: { question: asked, ...left },
    body: supportBody({
      provider: config.tutor.provider,
      action: "skip",
      next: { ...nextContent, responseStyle: "normal" },
      model: next.model,
      support: supportStateView(view.handle, asked, referenceOf(asked.text, request, content?.content).status === "available"),
      ...(focusProgress ? { focusProgress } : {}),
    }, content, context),
  };
}

/** The explicit support actions on the asked question: `POST /api/tutor/support` (LearningQuestions 9.1, 11.3). */
export function registerTutorSupportRoute(
  app: Express,
  context: TutorSupportContext & { readonly rateLimiter?: NonNullable<Parameters<typeof enforceTutorRateLimit>[1]["rateLimiter"]>; readonly disableRateLimit?: boolean },
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
      const scope: SupportScope = { request, content, signal, context, view, question, reference: referenceOf(question.text, request, content?.content) };
      if (request.action === "reveal") return reveal(scope);
      if (request.action === "skip") return skip(scope, key);
      return clarifyOrHint(scope, request.action);
    });
  });
}

/** Adds the Course Content session, committed only now that the action succeeded. */
function supportBody(body: TutorSupportResponse, content: TutorRequestContent | undefined, context: TutorSupportContext): TutorSupportResponse {
  const session = commitTutorSession(content, context.sessionStore);
  return session ? { ...body, courseContentSession: session } : body;
}
