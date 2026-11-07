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
import {
  addCheck,
  addNotApplicableCheck,
  addViolation,
  declaredLeakCheck,
  hasReturnedModel,
  providerAttempts,
  redact,
  requestArtifact,
  safeResult,
  type ProviderCapture,
} from "./evaluation-records";
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

/** Where a final-turn check writes its results. */
interface CheckSink {
  readonly turnIndex: number;
  readonly checks: TutorQualityDeterministicCheck[];
  readonly violations: TutorQualityInvariantViolation[];
}

function learnerInputCheck(expected: TutorQualityExpectation, body: Body, sink: CheckSink): void {
  if (expected.learnerInput === undefined) return;
  const passed = body.learnerInput === expected.learnerInput;
  addCheck(sink.checks, "expected-learner-input", passed, `${expected.learnerInput}, got ${String(body.learnerInput)}`);
  if (!passed) addViolation(sink.violations, "learner-input-mismatch", "final-tutor", sink.turnIndex, String(body.learnerInput));
}

function supportStateCheck(expected: TutorQualityExpectation, body: Body, sink: CheckSink): void {
  if (expected.supportAfter === undefined) return;
  const mismatches = supportMismatches(expected.supportAfter, body.support as TutorSupportState | undefined);
  addCheck(sink.checks, "expected-support-state", mismatches.length === 0, mismatches.join("; ") || undefined);
  if (mismatches.length > 0) addViolation(sink.violations, "support-state-mismatch", "state", sink.turnIndex, mismatches.join("; "));
}

function referenceAnswerCheck(expected: TutorQualityExpectation, body: Body, sink: CheckSink): void {
  if (expected.referenceAnswer === undefined) return;
  const reference = body.reference as { status?: string; answer?: string } | undefined;
  const shown = reference?.status === "available" ? reference.answer : reference?.status;
  const passed = reference?.status === "available" && reference.answer === expected.referenceAnswer;
  addCheck(sink.checks, "expected-reference-answer", passed, `${expected.referenceAnswer}, got ${String(shown)}`);
  if (!passed) addViolation(sink.violations, "reference-answer-mismatch", "final-tutor", sink.turnIndex);
}

function actionRejectedCheck(expected: TutorQualityExpectation, body: Body, status: number, sink: CheckSink): void {
  if (expected.actionRejected === undefined) return;
  const code = errorCode(body);
  const passed = status === 409 && code === expected.actionRejected;
  addCheck(sink.checks, "expected-action-rejected", passed, `${expected.actionRejected}, got ${status} ${code ?? ""}`.trim());
  if (!passed) addViolation(sink.violations, "support-action-not-rejected", "final-tutor", sink.turnIndex);
}

/**
 * The model's own rating, before the application's reference correction: raw model quality. A rating out of
 * the band is a raw-provider violation, so repeated wrong ratings reach the verdict (review F2, §8.2, R-VER-3/4).
 */
function rawRatingCheck(context: HttpReplayContext, raw: unknown, sink: CheckSink): void {
  const band = context.scenario.expected?.answerRating;
  if (band === undefined || sink.turnIndex !== context.scenario.turns.length - 1 || context.scenario.turns[sink.turnIndex]?.kind !== "dialog") return;
  const rating = (raw as { answerRating?: unknown } | undefined)?.answerRating;
  if (typeof rating !== "number") return;
  const passed = rating >= band[0] && rating <= band[1];
  addCheck(sink.checks, "raw-provider-answer-rating", passed, `${band[0]}-${band[1]}, got ${rating}`);
  if (!passed) addViolation(sink.violations, "answer-rating-out-of-band", "raw-provider", sink.turnIndex, `${rating} not in ${band[0]}-${band[1]}`);
}

/** The learning-support expectations of the final turn (R-SUP-E2/E3); the references come from the corpus. */
function finalSupportChecks(context: HttpReplayContext, response: { readonly status: number; readonly body: Body }, sink: CheckSink): void {
  const expected = context.scenario.expected;
  if (!expected || sink.turnIndex !== context.scenario.turns.length - 1) return;
  learnerInputCheck(expected, response.body, sink);
  supportStateCheck(expected, response.body, sink);
  referenceAnswerCheck(expected, response.body, sink);
  actionRejectedCheck(expected, response.body, response.status, sink);
}

function errorCode(body: Body): string | undefined {
  return (body.error as { code?: string } | undefined)?.code;
}

/**
 * R-SUP-7: in the learning-support cycle a weak answer keeps the question for another attempt. Asking it
 * again is then intended, whether the application kept it or the model, after rating the answer weak,
 * asked it once more in other words; a wrong weak rating is reported by the rating check instead.
 */
function questionRetained(raw: unknown, body: Body, askedQuestion: string | undefined): boolean {
  const rawRating = (raw as { answerRating?: unknown } | undefined)?.answerRating;
  return body.question === askedQuestion || (typeof rawRating === "number" && rawRating <= 2);
}

interface TurnRecord {
  readonly transcriptTurn: TutorQualityTranscriptTurn;
  readonly returnedModels?: readonly string[];
  readonly stop?: { readonly status: TutorQualityExecutionStatus; readonly invalidReason?: string; readonly technicalError?: TutorQualityTechnicalError };
}

/** R-ID-4: an attempt without a model identity makes the sample invalid, whatever else ended the turn. */
const MISSING_MODEL_STOP = { status: "invalid", invalidReason: "returned-model-missing" } as const;

/** What a turn knew before its request, and where its checks go. */
interface TurnScope extends CheckSink {
  readonly context: HttpReplayContext;
  readonly state: ReplayState;
  readonly turn: TutorQualityTurn;
  readonly startedAt: Date;
  readonly callsBefore: CountingProvider["stageACounts"];
  readonly capturesBefore: number;
  readonly askedQuestion?: string;
  readonly supportBefore?: TutorSupportState;
}

/** Every provider attempt of the turn, in order; the last one is what the application used. */
function turnCaptures(scope: TurnScope): readonly ProviderCapture[] {
  return scope.context.provider.generationCaptures.slice(scope.capturesBefore);
}

function transcriptTurn(scope: TurnScope, extra: Partial<TutorQualityTranscriptTurn>, delivered?: Record<string, unknown>, status?: number): TutorQualityTranscriptTurn {
  const { options, provider } = scope.context;
  const { turn, startedAt, callsBefore, askedQuestion, supportBefore, state } = scope;
  const now = options.now ?? (() => new Date());
  const captures = turnCaptures(scope);
  const capture = captures.at(-1);
  const callsAfter = provider.stageACounts;
  return {
    index: scope.turnIndex,
    input: turn.kind === "dialog" ? { ...turn, question: redact(turn.question, options.credential), answer: redact(turn.answer, options.credential) } : turn,
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
    providerCalls: { total: callsAfter.total - callsBefore.total, modelListCalls: callsAfter.modelListCalls - callsBefore.modelListCalls, generationCalls: callsAfter.generationCalls - callsBefore.generationCalls },
    ...(capture?.request ? { providerRequest: requestArtifact(capture.request, options.credential) } : {}),
    ...(capture?.response ? { rawProviderResult: safeResult(capture.response.result, options.credential), returnedModel: redact(String(capture.response.model ?? ""), options.credential) } : {}),
    ...(captures.length > 0 ? { providerAttempts: providerAttempts(captures, options.credential) } : {}),
    ...(delivered ? { finalTutorResult: delivered } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(askedQuestion === undefined ? {} : { askedQuestion: redact(askedQuestion, options.credential) }),
    ...(supportBefore ? { supportBefore } : {}),
    ...(state.support ? { supportAfter: state.support } : {}),
    deterministicChecks: scope.checks,
    ...extra,
  };
}

/**
 * A provider or server failure: technical, never a quality result; the failed turn changed nothing. An answer
 * the model gave before the failure is still raw evidence and is checked like any other (review G2).
 */
function technicalTurn(scope: TurnScope, response: { readonly status: number; readonly body: Body }, progressionBefore: string | undefined): TurnRecord {
  const { context } = scope;
  const kind = technicalKind(response.status, response.body, context.provider, context.options.maxCalls);
  const technicalError = { kind, name: "HttpReplayError" };
  addCheck(scope.checks, "final-tutor-response-present", false, kind);
  const modelsPresent = rawTurnChecks(scope, response.body);
  const state = context.content?.progressionState;
  if (progressionBefore !== undefined && state) {
    const unchanged = canonicalJson(state) === progressionBefore;
    addCheck(scope.checks, "state-unchanged-after-failure", unchanged);
    if (!unchanged) addViolation(scope.violations, "state-mutated-after-failure", "state", scope.turnIndex);
  }
  const stop = modelsPresent ? { status: "technical-failure" as const } : MISSING_MODEL_STOP;
  return { transcriptTurn: transcriptTurn(scope, { technicalError }, undefined, response.status), stop: { ...stop, technicalError } };
}

/** A refused request: expected for a final early reveal, otherwise an application finding that ends the sample. */
function refusedTurn(scope: TurnScope, response: { readonly status: number; readonly body: Body }): TurnRecord {
  const { scenario } = scope.context;
  const modelsPresent = rawTurnChecks(scope, response.body);
  finalSupportChecks(scope.context, response, scope);
  if (!modelsPresent) return { transcriptTurn: transcriptTurn(scope, {}, undefined, response.status), stop: MISSING_MODEL_STOP };
  const expectedRejection = scope.turnIndex === scenario.turns.length - 1 && scenario.expected?.actionRejected !== undefined;
  if (expectedRejection) return { transcriptTurn: transcriptTurn(scope, {}, undefined, response.status) };
  addCheck(scope.checks, "http-request-accepted", false, `${response.status} ${errorCode(response.body) ?? ""}`.trim());
  addViolation(scope.violations, "request-refused", "final-tutor", scope.turnIndex, String(response.status));
  return { transcriptTurn: transcriptTurn(scope, {}, undefined, response.status), stop: { status: "completed" } };
}

/**
 * Raw provider checks per action and per attempt (review F3): a discarded first attempt that revealed the
 * solution is still raw model evidence, also when the turn ends in a failure (review G2). Each turn runs them
 * exactly once. An explanation gets the generic and the leak checks, an answer or a question the full checks.
 * Every attempt must name its model (R-ID-4, review F4); one that does not is attributed to no model.
 */
function rawTurnChecks(scope: TurnScope, body: Body): boolean {
  const { context, turn, turnIndex, checks, violations, state } = scope;
  let modelsPresent = true;
  for (const capture of turnCaptures(scope)) {
    if (!capture.response) continue;
    const present = hasReturnedModel(capture);
    addCheck(checks, "returned-model-present", present, present ? undefined : "missing");
    modelsPresent &&= present;
    // Without a model identity the answer is evidence about no model: the sample becomes invalid instead.
    if (!present) continue;
    const raw = capture.response.result;
    if (turn.kind === "support" && (turn.action === "clarify" || turn.action === "hint")) {
      context.rawChecks(raw, turn, turnIndex, checks, false);
      declaredLeakCheck(raw, context.scenario.expected?.mustNotReveal, turnIndex, checks, violations);
      continue;
    }
    const dialogTurn: TutorQualityTurn = turn.kind === "dialog" ? { ...turn, history: state.history } : turn;
    context.rawChecks(raw, dialogTurn, turnIndex, checks, turn.kind === "dialog" && questionRetained(raw, body, scope.askedQuestion));
    rawRatingCheck(context, raw, scope);
  }
  return modelsPresent;
}

function acceptedTurn(scope: TurnScope, response: { readonly status: number; readonly body: Body }): TurnRecord {
  const { context, turn, turnIndex, checks, violations, askedQuestion } = scope;
  addCheck(checks, "http-request-accepted", true);
  const delivered = deliveredResult(turn, response.body, askedQuestion, context.options.credential);
  addCheck(checks, "final-tutor-response-present", delivered !== undefined);
  applyResponse(turn, response.body, scope.state, askedQuestion, turn.kind === "dialog" ? turn.answer : undefined);
  const modelsPresent = rawTurnChecks(scope, response.body);
  deliveredLeakCheck(turn, delivered, context.scenario.expected, turnIndex, checks, violations);
  authorizationCheck(turn, scope.supportBefore, response.status, turnIndex, checks, violations);
  if (turn.kind !== "support" && delivered) context.finalChecks(response.body as unknown as TutorContentResult, turn, turnIndex, checks);
  finalSupportChecks(context, response, scope);
  const record = transcriptTurn(scope, {}, delivered, response.status);
  // R-ID-4: without a proven model identity the sample says nothing about a model.
  if (!modelsPresent) return { transcriptTurn: record, stop: MISSING_MODEL_STOP };
  const returnedModels = turnCaptures(scope).filter(hasReturnedModel).map((capture) => capture.response!.model);
  return { transcriptTurn: record, returnedModels };
}

async function replayTurn(context: HttpReplayContext, post: Post, state: ReplayState, turn: TutorQualityTurn, turnIndex: number, violations: TutorQualityInvariantViolation[]): Promise<TurnRecord> {
  const { provider } = context;
  const scope: TurnScope = {
    context, state, turn, turnIndex, violations,
    checks: [],
    startedAt: (context.options.now ?? (() => new Date()))(),
    callsBefore: provider.stageACounts,
    capturesBefore: provider.generationCaptures.length,
    ...(state.question === undefined ? {} : { askedQuestion: state.question }),
    ...(state.support ? { supportBefore: state.support } : {}),
  };
  if (turn.kind === "dialog" && turn.question !== state.question) {
    // R-SUP-E1: the scripted answer belongs to another question than the one the application asked.
    addCheck(scope.checks, "question-binding", false, state.question);
    addViolation(violations, "question-binding-mismatch", "scenario", turnIndex, state.question);
    return { transcriptTurn: transcriptTurn(scope, {}), stop: { status: "invalid", invalidReason: "question-binding-mismatch" } };
  }
  const request = requestFor(context, turn, state);
  const progressionBefore = context.content?.progressionState ? canonicalJson(context.content.progressionState) : undefined;
  const response = await post(request.route, request.body);
  const capture = turnCaptures(scope).at(-1);
  if (response.status >= 500 || (capture?.error !== undefined && response.status !== 200)) return technicalTurn(scope, response, progressionBefore);
  if (response.status !== 200) return refusedTurn(scope, response);
  return acceptedTurn(scope, response);
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
      returnedModels.push(...(result.returnedModels ?? []));
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
