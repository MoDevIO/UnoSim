import express from "express";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TutorContentResult, TutorDialogTurn, TutorSupportState } from "@shared/tutor";
import { registerTutorRoutes } from "../../../routes/tutor.routes";
import type { ResolvedTutorCourseContent } from "../../course-content/course-content-session";
import type { TutorService } from "../tutor-service";
import type { TutorPlanningContentContext } from "../tutor-planning";
import type { TutorQualityExpectation, TutorQualitySupportExpectation } from "./anchor-corpus";
import { addCheck, addNotApplicableCheck, addViolation, declaredLeakCheck, redact, requestArtifact, safeResult } from "./evaluation-records";
import { canonicalJson } from "./canonical";
import { findRevealedLiteral } from "./reveal-check";
import type {
  CountingProvider,
  TutorQualityDeterministicCheck,
  TutorQualityEvaluationOptions,
  TutorQualityEvaluationScenario,
  TutorQualityExecutionStatus,
  TutorQualityInvariantViolation,
  TutorQualityTechnicalError,
  TutorQualityTranscriptTurn,
  TutorQualityTurn,
} from "./real-provider-evaluation";

/**
 * HTTP replay of a learning-support scenario (Evaluation SSOT 15, R-SUP-E1/E4): the production Tutor routes
 * on loopback with the evaluation's counting provider, learning support switched on, and the question, the
 * Course and support sessions and the history carried forward exactly as the browser does. It is isolated
 * route evidence: gateway, authentication, rate limit and Course Content loading are not part of it.
 *
 * Every turn is checked against its action. The raw provider output and the delivered application output
 * are checked separately; a clarification or hint must not reveal a declared literal, an authorized reveal
 * is no leak, an unexpected question is a binding problem, never answered by an unrelated scripted value.
 */

export interface HttpReplayContext {
  readonly options: TutorQualityEvaluationOptions;
  readonly provider: CountingProvider;
  readonly service: TutorService;
  readonly scenario: TutorQualityEvaluationScenario;
  readonly content: TutorPlanningContentContext | undefined;
  /** The service evaluation's raw checks of a question or dialog result. */
  readonly rawChecks: (raw: unknown, turn: TutorQualityTurn, turnIndex: number, checks: TutorQualityDeterministicCheck[], questionRetained: boolean) => void;
  /** The service evaluation's expectation checks of a delivered question or dialog result. */
  readonly finalChecks: (result: TutorContentResult, turn: TutorQualityTurn, turnIndex: number, checks: TutorQualityDeterministicCheck[]) => void;
}

export interface HttpReplayOutcome {
  readonly turns: readonly TutorQualityTranscriptTurn[];
  readonly violations: readonly TutorQualityInvariantViolation[];
  readonly returnedModels: readonly string[];
  readonly executionStatus: TutorQualityExecutionStatus;
  readonly invalidReason?: string;
  readonly technicalError?: TutorQualityTechnicalError;
}

type Body = Record<string, unknown>;
type Post = (route: string, body: unknown) => Promise<{ readonly status: number; readonly body: Body }>;

const EVALUATION_SUBJECT = "eval.tutor-quality";
const EVALUATION_COURSE = { repository: "evaluation/course-content", ref: "main" } as const;
const HISTORY_WINDOW = 8;

/** Provider error codes of the Tutor routes and the technical-failure kinds of the evaluation. */
const TECHNICAL_KINDS: Readonly<Record<string, string>> = {
  PROVIDER_TIMEOUT: "timeout",
  PROVIDER_UNAVAILABLE: "provider-unavailable",
  INVALID_PROVIDER_RESPONSE: "invalid-response",
  RATE_LIMITED: "rate-limited",
  MODEL_UNAVAILABLE: "model-unavailable",
  CREDENTIAL_INVALID: "credential-invalid",
};

interface ReplayState {
  question?: string;
  support?: TutorSupportState;
  courseSession?: string;
  history: TutorDialogTurn[];
}

async function startRoutes(service: TutorService, content: TutorPlanningContentContext | undefined): Promise<{ server: Server; post: Post }> {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: EVALUATION_SUBJECT, roles: ["user"] };
    next();
  });
  const resolved = content ? resolvedContent(content) : undefined;
  registerTutorRoutes(app, {
    service,
    ...(resolved ? { courseContent: { resolveTutorContent: async () => resolved } } : {}),
    disableRateLimit: true,
    logger: { warn: () => undefined, error: () => undefined } as never,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post: Post = async (route, body) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as Body };
  };
  return { server, post };
}

/** The scenario's pinned Course Content as the resolver returns it; its progression state is the sample's. */
function resolvedContent(content: TutorPlanningContentContext): ResolvedTutorCourseContent {
  return {
    ...EVALUATION_COURSE,
    revision: content.revision as ResolvedTutorCourseContent["revision"],
    ...(content.exampleId === undefined ? {} : { exampleId: content.exampleId }),
    tutor: content.tutor ?? { status: "absent" },
    ...(content.exampleTutorAnnotation ? { exampleTutorAnnotation: content.exampleTutorAnnotation } : {}),
    ...(content.exampleProgram ? { exampleProgram: content.exampleProgram } : {}),
    ...(content.progressionState ? { progressionState: content.progressionState } : {}),
    contentBytes: 0,
  };
}

function courseField(content: TutorPlanningContentContext | undefined, state: ReplayState): Body {
  if (!content) return {};
  if (state.courseSession) return { courseContentSession: state.courseSession };
  return { courseContent: { ...EVALUATION_COURSE, revision: content.revision, ...(content.exampleId === undefined ? {} : { exampleId: content.exampleId }) } };
}

function binding(state: ReplayState): Body {
  return state.support ? { supportSession: state.support.session, questionHandle: state.support.questionHandle, actionId: randomUUID() } : {};
}

function requestFor(context: HttpReplayContext, turn: TutorQualityTurn, state: ReplayState): { readonly route: string; readonly body: Body } {
  const { options, scenario, content } = context;
  const common = {
    code: scenario.sketch,
    credential: options.credential,
    model: options.requestedModel,
    difficulty: turn.difficulty ?? 30,
    ...courseField(content, state),
  };
  if (turn.kind === "initial") return { route: "/api/tutor/question", body: { ...common, learningSupport: true } };
  if (turn.kind === "dialog") {
    return { route: "/api/tutor/dialog", body: { ...common, history: state.history, question: state.question, answer: turn.answer, ...binding(state) } };
  }
  return { route: "/api/tutor/support", body: { ...common, history: state.history, action: turn.action, ...binding(state) } };
}

/** What the application delivered for the turn, reduced to the transcript's allowlisted fields. */
function deliveredResult(turn: TutorQualityTurn, body: Body, askedQuestion: string | undefined, credential?: string): Record<string, unknown> | undefined {
  if (turn.kind !== "support") return safeResult(body, credential);
  if (turn.action === "clarify" || turn.action === "hint") {
    return typeof body.explanation === "string" && askedQuestion !== undefined
      ? safeResult({ responseStyle: "normal", question: askedQuestion, feedback: body.explanation }, credential)
      : undefined;
  }
  if (turn.action === "skip") {
    const next = body.next as Body | undefined;
    return next ? safeResult(next, credential) : undefined;
  }
  const reference = body.reference as { status?: string; answer?: string; explanation?: string } | undefined;
  return reference?.status === "available"
    ? safeResult({ responseStyle: "normal", question: askedQuestion, feedback: `${reference.answer ?? ""}\n${reference.explanation ?? ""}`.trim() }, credential)
    : undefined;
}

function technicalKind(status: number, body: Body, provider: CountingProvider, maxCalls: number): string {
  if (provider.counts.total >= maxCalls) return "call-budget-exhausted";
  const code = (body.error as { code?: string } | undefined)?.code;
  return (code && TECHNICAL_KINDS[code]) ?? `http-${status}`;
}

function applyResponse(turn: TutorQualityTurn, body: Body, state: ReplayState, askedQuestion: string | undefined, answer?: string): void {
  if (typeof body.courseContentSession === "string") state.courseSession = body.courseContentSession;
  if (body.support) state.support = body.support as TutorSupportState;
  if (turn.kind === "dialog" && body.learnerInput === "answer" && askedQuestion !== undefined && answer !== undefined) {
    const rating = typeof body.answerRating === "number" ? { answerRating: body.answerRating as TutorDialogTurn["answerRating"] } : {};
    const feedback = typeof body.feedback === "string" ? { feedback: body.feedback } : {};
    const entry = { question: askedQuestion, answer, responseStyle: "normal" as const, ...feedback, ...rating } as TutorDialogTurn;
    state.history = [...state.history, entry].slice(-HISTORY_WINDOW);
  }
  const next = turn.kind === "support" ? body.next as Body | undefined : body;
  if (typeof next?.question === "string") state.question = next.question;
}

/** Action-aware leak check of the delivered text (R-SUP-E4): an authorized reveal is no leak. */
function deliveredLeakCheck(turn: TutorQualityTurn, delivered: Record<string, unknown> | undefined, expected: TutorQualityExpectation | undefined, turnIndex: number, checks: TutorQualityDeterministicCheck[], violations: TutorQualityInvariantViolation[]): void {
  const literals = expected?.mustNotReveal;
  if (literals === undefined || turn.kind === "initial") return;
  if (turn.kind === "support" && turn.action === "reveal") {
    addNotApplicableCheck(checks, "final-tutor-no-declared-leak", "authorized-reference-answer");
    return;
  }
  const texts = [delivered?.feedback, delivered?.question].filter((text): text is string => typeof text === "string");
  if (texts.length === 0) {
    addNotApplicableCheck(checks, "final-tutor-no-declared-leak", "final-tutor-no-readable-text");
    return;
  }
  const revealed = findRevealedLiteral(texts, literals);
  addCheck(checks, "final-tutor-no-declared-leak", revealed === undefined, revealed);
  if (revealed !== undefined) addViolation(violations, "solution-revealed", "final-tutor", turnIndex, revealed);
}

/** A reveal or a skip must have been unlocked by the server before (R-SUP-1). */
function authorizationCheck(turn: TutorQualityTurn, before: TutorSupportState | undefined, status: number, turnIndex: number, checks: TutorQualityDeterministicCheck[], violations: TutorQualityInvariantViolation[]): void {
  if (turn.kind !== "support" || (turn.action !== "reveal" && turn.action !== "skip") || status !== 200) return;
  const unlocked = turn.action === "reveal" ? before?.canRevealReference === true : before?.canSkip === true;
  addCheck(checks, `${turn.action}-was-unlocked`, unlocked);
  if (!unlocked) addViolation(violations, "support-action-not-unlocked", "final-tutor", turnIndex, turn.action);
}

function supportMismatches(expected: TutorQualitySupportExpectation, actual: TutorSupportState | undefined): string[] {
  return Object.entries(expected)
    .filter(([key, value]) => (actual as Record<string, unknown> | undefined)?.[key] !== value)
    .map(([key, value]) => `${key}: expected ${String(value)}, got ${String((actual as Record<string, unknown> | undefined)?.[key])}`);
}

/** The learning-support expectations of the final turn (R-SUP-E2/E3); the references come from the corpus. */
function finalSupportChecks(context: HttpReplayContext, body: Body, status: number, raw: unknown, turnIndex: number, checks: TutorQualityDeterministicCheck[], violations: TutorQualityInvariantViolation[]): void {
  const expected = context.scenario.expected;
  if (!expected || turnIndex !== context.scenario.turns.length - 1) return;
  if (expected.learnerInput !== undefined) {
    const passed = body.learnerInput === expected.learnerInput;
    addCheck(checks, "expected-learner-input", passed, `${expected.learnerInput}, got ${String(body.learnerInput)}`);
    if (!passed) addViolation(violations, "learner-input-mismatch", "final-tutor", turnIndex, String(body.learnerInput));
  }
  if (expected.supportAfter !== undefined) {
    const mismatches = supportMismatches(expected.supportAfter, body.support as TutorSupportState | undefined);
    addCheck(checks, "expected-support-state", mismatches.length === 0, mismatches.join("; ") || undefined);
    if (mismatches.length > 0) addViolation(violations, "support-state-mismatch", "state", turnIndex, mismatches.join("; "));
  }
  if (expected.referenceAnswer !== undefined) {
    const reference = body.reference as { status?: string; answer?: string } | undefined;
    const passed = reference?.status === "available" && reference.answer === expected.referenceAnswer;
    addCheck(checks, "expected-reference-answer", passed, `${expected.referenceAnswer}, got ${reference?.status === "available" ? reference.answer : reference?.status}`);
    if (!passed) addViolation(violations, "reference-answer-mismatch", "final-tutor", turnIndex);
  }
  if (expected.actionRejected !== undefined) {
    const code = (body.error as { code?: string } | undefined)?.code;
    const passed = status === 409 && code === expected.actionRejected;
    addCheck(checks, "expected-action-rejected", passed, `${expected.actionRejected}, got ${status} ${code ?? ""}`.trim());
    if (!passed) addViolation(violations, "support-action-not-rejected", "final-tutor", turnIndex);
  }
  const band = expected.answerRating;
  if (band !== undefined && context.scenario.turns[turnIndex]?.kind === "dialog") {
    // The model's own rating, before the application's reference correction: raw model quality.
    const rating = (raw as { answerRating?: unknown } | undefined)?.answerRating;
    const passed = typeof rating === "number" && rating >= band[0] && rating <= band[1];
    addCheck(checks, "raw-provider-answer-rating", passed, `${band[0]}-${band[1]}, got ${String(rating)}`);
  }
}

interface TurnRecord {
  readonly transcriptTurn: TutorQualityTranscriptTurn;
  readonly returnedModel?: string;
  readonly stop?: { readonly status: TutorQualityExecutionStatus; readonly invalidReason?: string; readonly technicalError?: TutorQualityTechnicalError };
}

async function replayTurn(context: HttpReplayContext, post: Post, state: ReplayState, turn: TutorQualityTurn, turnIndex: number, violations: TutorQualityInvariantViolation[]): Promise<TurnRecord> {
  const { options, provider, scenario } = context;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const callsBefore = provider.stageACounts;
  const capturesBefore = provider.generationCaptures.length;
  const checks: TutorQualityDeterministicCheck[] = [];
  const askedQuestion = state.question;
  const supportBefore = state.support;
  const record = (extra: Partial<TutorQualityTranscriptTurn>, delivered?: Record<string, unknown>, status?: number): TutorQualityTranscriptTurn => {
    const capture = provider.generationCaptures.length > capturesBefore ? provider.generationCaptures.at(-1) : undefined;
    const callsAfter = provider.stageACounts;
    return {
      index: turnIndex,
      input: turn.kind === "dialog" ? { ...turn, question: redact(turn.question, options.credential), answer: redact(turn.answer, options.credential) } : turn,
      startedAt: startedAt.toISOString(),
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      providerCalls: { total: callsAfter.total - callsBefore.total, modelListCalls: callsAfter.modelListCalls - callsBefore.modelListCalls, generationCalls: callsAfter.generationCalls - callsBefore.generationCalls },
      ...(capture?.request ? { providerRequest: requestArtifact(capture.request, options.credential) } : {}),
      ...(capture?.response ? { rawProviderResult: safeResult(capture.response.result, options.credential), returnedModel: redact(capture.response.model, options.credential) } : {}),
      ...(delivered ? { finalTutorResult: delivered } : {}),
      ...(status === undefined ? {} : { httpStatus: status }),
      ...(askedQuestion === undefined ? {} : { askedQuestion: redact(askedQuestion, options.credential) }),
      ...(supportBefore ? { supportBefore } : {}),
      ...(state.support ? { supportAfter: state.support } : {}),
      deterministicChecks: checks,
      ...extra,
    };
  };
  if (turn.kind === "dialog" && turn.question !== askedQuestion) {
    // R-SUP-E1: the scripted answer belongs to another question than the one the application asked.
    addCheck(checks, "question-binding", false, askedQuestion);
    addViolation(violations, "question-binding-mismatch", "scenario", turnIndex, askedQuestion);
    return { transcriptTurn: record({}), stop: { status: "invalid", invalidReason: "question-binding-mismatch" } };
  }
  const request = requestFor(context, turn, state);
  const progressionBefore = context.content?.progressionState ? canonicalJson(context.content.progressionState) : undefined;
  const response = await post(request.route, request.body);
  const capture = provider.generationCaptures.length > capturesBefore ? provider.generationCaptures.at(-1) : undefined;
  const raw = capture?.response?.result;
  const finalTurn = turnIndex === scenario.turns.length - 1;
  if (response.status >= 500 || (capture?.error !== undefined && response.status !== 200)) {
    const kind = technicalKind(response.status, response.body, provider, options.maxCalls);
    const technicalError = { kind, name: "HttpReplayError" };
    addCheck(checks, "final-tutor-response-present", false, kind);
    // A failed turn changes nothing; earlier turns of the dialog may have (R-SUP-1).
    if (progressionBefore !== undefined && context.content?.progressionState) {
      const unchanged = canonicalJson(context.content.progressionState) === progressionBefore;
      addCheck(checks, "state-unchanged-after-failure", unchanged);
      if (!unchanged) addViolation(violations, "state-mutated-after-failure", "state", turnIndex);
    }
    return { transcriptTurn: record({ technicalError }, undefined, response.status), stop: { status: "technical-failure", technicalError } };
  }
  if (response.status !== 200) {
    finalSupportChecks(context, response.body, response.status, raw, turnIndex, checks, violations);
    const expectedRejection = finalTurn && scenario.expected?.actionRejected !== undefined;
    if (!expectedRejection) {
      addCheck(checks, "http-request-accepted", false, `${response.status} ${(response.body.error as { code?: string } | undefined)?.code ?? ""}`.trim());
      addViolation(violations, "request-refused", "final-tutor", turnIndex, String(response.status));
    }
    return { transcriptTurn: record({}, undefined, response.status), ...(expectedRejection ? {} : { stop: { status: "completed" } }) };
  }
  addCheck(checks, "http-request-accepted", true);
  const delivered = deliveredResult(turn, response.body, askedQuestion, options.credential);
  addCheck(checks, "final-tutor-response-present", delivered !== undefined);
  applyResponse(turn, response.body, state, askedQuestion, turn.kind === "dialog" ? turn.answer : undefined);
  if (raw !== undefined) {
    if (turn.kind === "support" && (turn.action === "clarify" || turn.action === "hint")) {
      declaredLeakCheck(raw, scenario.expected?.mustNotReveal, turnIndex, checks, violations);
    } else {
      const dialogTurn: TutorQualityTurn = turn.kind === "dialog" ? { ...turn, history: state.history } : turn;
      context.rawChecks(raw, dialogTurn, turnIndex, checks, turn.kind === "dialog" && response.body.question === askedQuestion);
    }
  }
  deliveredLeakCheck(turn, delivered, scenario.expected, turnIndex, checks, violations);
  authorizationCheck(turn, supportBefore, response.status, turnIndex, checks, violations);
  if (turn.kind !== "support" && delivered) context.finalChecks(response.body as unknown as TutorContentResult, turn, turnIndex, checks);
  finalSupportChecks(context, response.body, response.status, raw, turnIndex, checks, violations);
  return { transcriptTurn: record({}, delivered, response.status), ...(capture?.response?.model ? { returnedModel: capture.response.model } : {}) };
}

export async function replayHttpScenario(context: HttpReplayContext): Promise<HttpReplayOutcome> {
  const { server, post } = await startRoutes(context.service, context.content);
  const state: ReplayState = { history: [] };
  const turns: TutorQualityTranscriptTurn[] = [];
  const violations: TutorQualityInvariantViolation[] = [];
  const returnedModels: string[] = [];
  try {
    for (const [turnIndex, turn] of context.scenario.turns.entries()) {
      const result = await replayTurn(context, post, state, turn, turnIndex, violations);
      turns.push(result.transcriptTurn);
      if (result.returnedModel) returnedModels.push(result.returnedModel);
      if (result.stop) {
        return {
          turns, violations, returnedModels,
          executionStatus: result.stop.status,
          ...(result.stop.invalidReason ? { invalidReason: result.stop.invalidReason } : {}),
          ...(result.stop.technicalError ? { technicalError: result.stop.technicalError } : {}),
        };
      }
    }
    return { turns, violations, returnedModels, executionStatus: "completed" };
  } finally {
    server.close();
  }
}
