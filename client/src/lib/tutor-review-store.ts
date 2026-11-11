import { z } from "zod";
import { boardIdSchema } from "@shared/boards";
import { INPUT_LIMITS } from "@shared/input-limits";
import {
  tutorFocusProgressSchema, tutorLearnerInputSchema, tutorLearningPhaseSchema, tutorQuestionKindSchema, tutorQuestionOutcomeSchema,
  tutorResponseStyleSchema, tutorStrategySourceSchema,
} from "@shared/tutor";
import { TUTOR_ASSESSMENT_GUIDANCE_REVISION, TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import { tutorReferenceUnavailableReasonSchema } from "@shared/tutor-support";
import type { TutorDiagnosticEvent } from "@shared/tutor-diagnostics";
import {
  redactTutorReviewServerEntry, redactTutorReviewText, redactTutorReviewValue, TUTOR_REVIEW_LIMITS, tutorReviewEnvelopeSchema,
  type TutorReviewContext, type TutorReviewExport, type TutorReviewGuidanceSet, type TutorReviewHistoryRef,
  type TutorReviewImportedTurn, type TutorReviewStep,
} from "@shared/tutor-review";
import { tutorReviewExportBytes, utf8Bytes } from "./tutor-review-text";

/**
 * The local Tutor review capture (LearningQuestions 12.7): the content of Tutor test runs in this tab's RAM.
 * It is fed from the request each Tutor call actually sent and the response it received, never rebuilt from
 * the editor or the model's eight-entry history. Every text is redacted against that request's credential
 * before it is kept; the credential itself is never stored.
 */

type IncompleteReason = TutorReviewExport["capture"]["incompleteReasons"][number];
type Endpoint = "question" | "dialog" | "support" | "models";
type LocalStepKind = "held" | "displayed" | "reset";

export interface TutorReviewRun {
  readonly runId: string;
  readonly startedAt: string;
  endedAt?: string;
  status: "recording" | "stopped" | "finished";
  stoppedReason?: IncompleteReason;
  readonly incomplete: Set<IncompleteReason>;
  readonly contexts: TutorReviewContext[];
  readonly importedHistory: TutorReviewImportedTurn[];
  readonly steps: TutorReviewStep[];
  /** Rule sets the server reported that differ from the client's own texts. */
  readonly guidanceSets: TutorReviewGuidanceSet[];
  /** Server rule revisions a step names but whose texts were not kept (limit). */
  readonly missingGuidance: Set<string>;
  sanitized: number;
  notCaptured: number;
  requestAttempts: number;
  /**
   * Upper bound of the full export's UTF-8 size, kept per change instead of serializing the report. It
   * counts each text as the export renders it (tutorReviewExportBytes), so the export stays within the limit.
   */
  estimatedBytes: number;
  ratingSummary?: NonNullable<TutorReviewStep["ratingSummary"]>;
}

interface RunIndex {
  readonly contextKeys: Map<string, string>;
  readonly importKeys: Map<string, string>;
  readonly stepsByRequest: Map<string, TutorReviewStep>;
  readonly traces: Map<string, { readonly firstStepId: string; attempts: number }>;
}

/** An in-flight request; it holds the credential only until the response is recorded. */
export interface TutorReviewHandle {
  readonly epoch: number;
  readonly runId: string;
  readonly stepId: string;
  readonly endpoint: Endpoint;
  credential?: string;
}

/** An item's share of the export, plus its own heading line and spacing. */
const estimate = (value: unknown): number => tutorReviewExportBytes(value) + 1_024;
/** The header, the fixed legend and the client's rule texts every export carries. */
const RUN_BASE_BYTES = 16 * 1_024 + tutorReviewExportBytes({ TUTOR_RATING_RUBRIC, TUTOR_DIFFICULTY_GUIDANCE });
const now = (): string => new Date().toISOString();
const newId = (): string => crypto.randomUUID();

let epoch = 0;
let runs: TutorReviewRun[] = [];
const indexes = new WeakMap<TutorReviewRun, RunIndex>();
let startNewRun = true;
let removedRuns = 0;
let version = 0;
let sequence = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeTutorReview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function tutorReviewVersion(): number { return version; }
/** Raised by Clear and by DEBUG off/on; content and technical events of an older epoch are not kept. */
export function tutorReviewEpoch(): number { return epoch; }
export function tutorReviewRuns(): readonly TutorReviewRun[] { return runs; }
export function tutorReviewRemovedRuns(): number { return removedRuns; }

function indexOf(run: TutorReviewRun): RunIndex {
  let index = indexes.get(run);
  if (!index) {
    index = { contextKeys: new Map(), importKeys: new Map(), stepsByRequest: new Map(), traces: new Map() };
    indexes.set(run, index);
  }
  return index;
}

function totalBytes(): number {
  return runs.reduce((sum, run) => sum + run.estimatedBytes, 0);
}

function currentRun(): TutorReviewRun | undefined {
  const last = runs.at(-1);
  return last?.status === "recording" ? last : undefined;
}

function beginRun(): TutorReviewRun {
  const last = runs.at(-1);
  if (last?.status === "recording") finishRun(last);
  if (runs.length >= TUTOR_REVIEW_LIMITS.runs) {
    runs = runs.slice(1);
    removedRuns++;
  }
  const run: TutorReviewRun = {
    runId: newId(), startedAt: now(), status: "recording", incomplete: new Set(),
    contexts: [], importedHistory: [], steps: [], guidanceSets: [], missingGuidance: new Set(), sanitized: 0, notCaptured: 0, requestAttempts: 0, estimatedBytes: RUN_BASE_BYTES,
  };
  runs = [...runs, run];
  startNewRun = false;
  return run;
}

function finishRun(run: TutorReviewRun): void {
  if (run.status !== "recording") return;
  run.status = "finished";
  run.endedAt = now();
}

function stopRun(run: TutorReviewRun, reason: IncompleteReason): void {
  if (run.status === "recording") {
    run.status = "stopped";
    run.stoppedReason = reason;
    run.endedAt = now();
  }
  run.incomplete.add(reason);
}

/** The run new content goes to; a stopped run only counts what it no longer records. */
function runForNewAction(): TutorReviewRun | undefined {
  const active = currentRun();
  if (active) return active;
  const last = runs.at(-1);
  if (last && !startNewRun) {
    last.notCaptured++;
    changed();
    return undefined;
  }
  return beginRun();
}

/** Reserves room for `bytes`; at a limit the run stops and keeps its closing reserve. */
function reserve(run: TutorReviewRun, bytes: number): boolean {
  const runLimit = TUTOR_REVIEW_LIMITS.runBytes - TUTOR_REVIEW_LIMITS.closingReserveBytes;
  if (run.estimatedBytes + bytes > runLimit || totalBytes() + bytes > TUTOR_REVIEW_LIMITS.totalBytes) {
    stopRun(run, "capture-limit");
    run.notCaptured++;
    return false;
  }
  run.estimatedBytes += bytes;
  return true;
}

function redactedText(value: unknown, max: number, run: TutorReviewRun, credential: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const redacted = redactTutorReviewText(value.slice(0, max), credential);
  run.sanitized += redacted.count;
  return redacted.text;
}

function redactedValue<T>(value: T, run: TutorReviewRun, credential: string | undefined): T {
  const redacted = redactTutorReviewValue(value, credential);
  run.sanitized += redacted.count;
  return redacted.value;
}

// ---- Request ----------------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return {};
  try { return asRecord(JSON.parse(body)); } catch { return {}; }
}

const COMPILE = INPUT_LIMITS.compile;

/**
 * Whether the sent files keep the request limits. The capture sees the body before the server checks it; a
 * context beyond them is one the server rejects, so it is not recorded at all rather than cut short.
 */
function withinRequestLimits(code: string, entryFile: unknown, headers: ReadonlyArray<{ name: string; content: string }>): boolean {
  return code.length <= COMPILE.maxCodeChars
    && (typeof entryFile !== "string" || entryFile.length <= COMPILE.maxHeaderNameChars)
    && headers.length <= COMPILE.maxHeaders
    && headers.every((header) => header.name.length <= COMPILE.maxHeaderNameChars && header.content.length <= COMPILE.maxHeaderContentChars);
}

function contextOf(body: Record<string, unknown>, run: TutorReviewRun, credential: string | undefined): Omit<TutorReviewContext, "contextId"> | "outside-limits" | undefined {
  if (typeof body.code !== "string") return undefined;
  const headers = Array.isArray(body.headers)
    ? body.headers.map(asRecord).filter((header) => typeof header.name === "string" && typeof header.content === "string")
      .map((header) => ({ name: String(header.name), content: String(header.content) }))
    : [];
  if (!withinRequestLimits(body.code, body.entryFile, headers)) return "outside-limits";
  // The board is a fixed code; file names, code and header contents are free content.
  return {
    ...present("board", code(boardIdSchema, body.board)),
    ...redactedValue({ ...(typeof body.entryFile === "string" ? { entryFile: body.entryFile } : {}), code: body.code, headers }, run, credential),
  };
}

/** The sent code once per distinct state; unchanged states share their context. */
function contextIdFor(run: TutorReviewRun, context: Omit<TutorReviewContext, "contextId">): string | undefined | false {
  const key = JSON.stringify(context);
  const index = indexOf(run);
  const known = index.contextKeys.get(key);
  if (known) return known;
  const bytes = estimate(context);
  if (run.contexts.length >= TUTOR_REVIEW_LIMITS.contexts || utf8Bytes(key) > TUTOR_REVIEW_LIMITS.contextBytes || !reserve(run, bytes)) {
    if (run.status === "recording") { stopRun(run, "capture-limit"); run.notCaptured++; }
    return false;
  }
  const contextId = newId();
  run.contexts.push({ contextId, ...context });
  index.contextKeys.set(key, contextId);
  return contextId;
}

const TURN_FIELDS = ["question", "answer", "feedback", "answerRating", "responseStyle"] as const;
type Turn = Partial<Record<(typeof TURN_FIELDS)[number], unknown>>;

/** The turn a completed answer step stands for, in the fields a history entry carries. */
function stepTurn(step: TutorReviewStep): Turn {
  return {
    question: step.request?.askedQuestion, answer: step.request?.answer,
    feedback: step.response?.feedback, answerRating: step.response?.answerRating, responseStyle: step.response?.responseStyle,
  };
}

/** A step stands for a sent turn only when every field the turn carries is the same, feedback and rating included. */
function sameTurn(turn: Turn, step: TutorReviewStep): boolean {
  const recorded = stepTurn(step);
  return TURN_FIELDS.every((field) => turn[field] === undefined || turn[field] === recorded[field]);
}

/** Keeps a sent history entry verbatim when no single recorded step can stand for it. */
function importTurn(run: TutorReviewRun, turn: Turn, reason: TutorReviewImportedTurn["reason"]): TutorReviewHistoryRef[] {
  const index = indexOf(run);
  const key = JSON.stringify([reason, turn]);
  let importId = index.importKeys.get(key);
  if (!importId) {
    const imported = { ...(turn as Omit<TutorReviewImportedTurn, "importId" | "reason">), reason };
    if (!reserve(run, estimate(imported))) return [];
    importId = newId();
    run.importedHistory.push({ importId, ...imported });
    index.importKeys.set(key, importId);
  }
  // A history entry without any recorded step was answered before this run began.
  if (reason === "before-capture") run.incomplete.add("capture-started-late");
  return [{ importId }];
}

/**
 * Each history entry the request sent, as a reference to the one completed step that produced exactly this
 * turn, or kept verbatim. Entries are matched in order, so a later entry never points before an earlier one.
 */
function historyRefs(run: TutorReviewRun, history: unknown, credential: string | undefined): TutorReviewHistoryRef[] {
  if (!Array.isArray(history)) return [];
  let after = 0;
  return history.slice(0, 64).map(asRecord).flatMap((entry): TutorReviewHistoryRef[] => {
    const free = freeText(run, credential);
    const turn: Turn = Object.fromEntries(Object.entries({
      question: free(entry.question, 2_000), answer: free(entry.answer, 2_000), feedback: free(entry.feedback, 1_000),
      answerRating: optionalNumber(entry.answerRating, "answerRating", 1, 5).answerRating,
      responseStyle: code(tutorResponseStyleSchema, entry.responseStyle),
    }).filter(([, value]) => value !== undefined));
    if (typeof turn.question !== "string" || typeof turn.answer !== "string") return [];
    const candidates = run.steps.filter((step) => step.kind === "answer" && step.status === "completed" && step.sequence > after && sameTurn(turn, step));
    if (candidates.length === 1) {
      after = candidates[0].sequence;
      return [{ stepId: candidates[0].stepId }];
    }
    return importTurn(run, turn, candidates.length === 0 ? "before-capture" : "ambiguous");
  });
}

function requestRecord(endpoint: Endpoint, body: Record<string, unknown>, run: TutorReviewRun, credential: string | undefined): NonNullable<TutorReviewStep["request"]> {
  const course = asRecord(body.courseContent);
  const action = body.action;
  return {
    endpoint,
    ...(action === "clarify" || action === "hint" || action === "reveal" || action === "skip" ? { action } : {}),
    ...(endpoint === "dialog" && typeof body.question === "string" ? { askedQuestion: redactedText(body.question, 2_000, run, credential)! } : {}),
    ...(endpoint === "dialog" && typeof body.answer === "string" ? { answer: redactedText(body.answer, 2_000, run, credential)! } : {}),
    ...(typeof body.difficulty === "number" && Number.isInteger(body.difficulty) && body.difficulty >= 1 && body.difficulty <= 100 ? { difficulty: body.difficulty } : {}),
    ...(typeof body.model === "string" ? { requestedModel: redactedText(body.model, 128, run, credential)! } : {}),
    // Only the identifiers of course content, never the session handle that continues it; redacted like every text.
    ...(typeof course.repository === "string" && typeof course.ref === "string" && typeof course.revision === "string" ? {
      courseContent: redactedValue({
        repository: course.repository.slice(0, 200), ref: course.ref.slice(0, 200), revision: course.revision.slice(0, 64),
        ...(typeof course.exampleId === "string" ? { exampleId: course.exampleId.slice(0, 128) } : {}),
      }, run, credential),
    } : {}),
    continuesCourseSession: typeof body.courseContentSession === "string",
    history: historyRefs(run, body.history, credential),
  };
}

const STEP_KIND: Record<Endpoint, TutorReviewStep["kind"]> = { question: "question", dialog: "answer", support: "support", models: "models" };

/** Records the request a Tutor call is about to send; undefined when this action is not captured. */
export function beginTutorReviewRequest(input: {
  readonly traceId: string;
  readonly requestId: string;
  readonly endpoint: Endpoint;
  readonly body: BodyInit | null | undefined;
}): TutorReviewHandle | undefined {
  const run = runForNewAction();
  if (!run) return undefined;
  const body = parseBody(input.body);
  const credential = typeof body.credential === "string" ? body.credential : undefined;
  if (run.requestAttempts >= TUTOR_REVIEW_LIMITS.requestAttempts) {
    stopRun(run, "capture-limit");
    run.notCaptured++;
    changed();
    return undefined;
  }
  const sent = contextOf(body, run, credential);
  // The step stays, without its code; the missing context makes the run visibly incomplete.
  if (sent === "outside-limits") run.incomplete.add("capture-limit");
  const context = sent === "outside-limits" ? undefined : sent;
  const contextId = context ? contextIdFor(run, context) : undefined;
  if (contextId === false) { changed(); return undefined; }
  if (run.steps.length === 0 && (input.endpoint === "dialog" || input.endpoint === "support")) run.incomplete.add("capture-started-late");
  const index = indexOf(run);
  const trace = index.traces.get(input.traceId);
  const step: TutorReviewStep = {
    stepId: newId(),
    sequence: ++sequence,
    at: now(),
    kind: STEP_KIND[input.endpoint],
    status: "open",
    traceId: input.traceId,
    requestId: input.requestId,
    attempt: (trace?.attempts ?? 0) + 1,
    ...(trace ? { relatesTo: trace.firstStepId } : {}),
    ...(contextId ? { contextId } : {}),
    request: requestRecord(input.endpoint, body, run, credential),
    events: [],
  };
  if (!reserve(run, estimate(step))) { changed(); return undefined; }
  run.requestAttempts++;
  run.steps.push(step);
  index.stepsByRequest.set(input.requestId, step);
  if (trace) trace.attempts++;
  else index.traces.set(input.traceId, { firstStepId: step.stepId, attempts: 1 });
  changed();
  return { epoch, runId: run.runId, stepId: step.stepId, endpoint: input.endpoint, ...(credential ? { credential } : {}) };
}

// ---- Response ---------------------------------------------------------------------------------

function liveStep(handle: TutorReviewHandle | undefined): { run: TutorReviewRun; step: TutorReviewStep } | undefined {
  if (handle?.epoch !== epoch) return undefined;
  const run = runs.find((candidate) => candidate.runId === handle.runId);
  const step = run?.steps.find((candidate) => candidate.stepId === handle.stepId);
  return run && step ? { run, step } : undefined;
}

/**
 * Response content is built field by field: free content (texts, graphics, model and dynamic identifiers)
 * is cut to its limit and redacted; fixed public codes are kept only when they are one of their schema's
 * values, and never redacted. Unknown fields are not taken over.
 */
type Free = (value: unknown, max: number) => string | undefined;
const freeText = (run: TutorReviewRun, credential: string | undefined): Free => (value, max) => redactedText(value, max, run, credential);
/** A fixed code: kept only as one of its schema's values. */
const code = <T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T | undefined => schema.safeParse(value).data;
/** `{ [key]: value }` when there is a value, else nothing. */
const present = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

const LEARNING_IDS = ["topicId", "conceptId", "questionId", "indicatorId", "strategyId", "contentRevision"] as const;

/** Learning metadata: dynamic identifiers are free content; question kind, strategy source and phase are codes. */
function learningOf(body: Record<string, unknown>, free: Free) {
  const learning = {
    ...Object.fromEntries(LEARNING_IDS.flatMap((field) => {
      const value = free(body[field], 64);
      return value === undefined ? [] : [[field, value]];
    })),
    ...present("questionKind", code(tutorQuestionKindSchema, body.questionKind)),
    ...present("strategySource", code(tutorStrategySourceSchema, body.strategySource)),
    ...present("learningPhase", code(tutorLearningPhaseSchema, body.learningPhase)),
  };
  return Object.keys(learning).length ? { learning } : {};
}

/** The support state as the learner sees it, without its session and question handles. */
/** A count as the schemas define it: an integer within its range, else nothing. */
const count = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

function supportOf(value: unknown) {
  const support = asRecord(value);
  // The response is captured before the learning schema checks it, so its numbers are checked here first.
  const answerAttempts = count(support.answerAttempts, 0, 1_000);
  const clarifications = count(support.clarifications, 0, 1_000);
  if (answerAttempts === undefined || clarifications === undefined) return {};
  return {
    support: {
      answerAttempts, clarifications,
      canRevealReference: support.canRevealReference === true, canSkip: support.canSkip === true,
      referenceShown: support.referenceShown === true, ...present("outcome", code(tutorQuestionOutcomeSchema, support.outcome)),
    },
  };
}

function focusOf(value: unknown, free: Free) {
  const focus = asRecord(value);
  const state = code(tutorFocusProgressSchema.shape.state, focus.state);
  const totalAreas = count(focus.totalAreas, 1, 8);
  const understoodAreas = totalAreas === undefined ? undefined : count(focus.understoodAreas, 0, totalAreas);
  return state && totalAreas !== undefined && understoodAreas !== undefined ? { focusProgress: {
    state, understoodAreas, totalAreas,
    openAreas: Array.isArray(focus.openAreas) ? focus.openAreas.slice(0, 8).flatMap((area) => free(String(area), 160) ?? []) : [],
  } } : {};
}

/** The question a skip moved to, with everything the learning area shows of it, graphic and metadata included. */
function nextOf(value: unknown, free: Free) {
  const next = asRecord(value);
  const question = free(next.question, 2_000);
  if (question === undefined) return {};
  return { next: {
    question, ...present("feedback", free(next.feedback, 1_000)), ...present("topic", free(next.topic, 120)),
    ...optionalNumber(next.difficulty, "difficulty", 1, 100), ...present("mermaid", free(next.mermaid, 12_000)),
    ...learningOf(next, free), ...focusOf(next.focusProgress, free),
  } };
}

function optionalNumber(value: unknown, field: string, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? { [field]: value } : {};
}

/** A reference answer is part of the response only when it was revealed to the learner. */
function referenceOf(value: unknown, free: Free) {
  const reference = asRecord(value);
  const answer = free(reference.answer, 300);
  const explanation = free(reference.explanation, 1_500);
  if (reference.status === "available" && answer !== undefined && explanation !== undefined) {
    const assumptions = Array.isArray(reference.assumptions) ? reference.assumptions.slice(0, 6).flatMap((item) => free(String(item), 160) ?? []) : undefined;
    return { reference: { status: "available" as const, answer, explanation, ...present("assumptions", assumptions) } };
  }
  const reason = code(tutorReferenceUnavailableReasonSchema, reference.reason);
  if (reference.status === "unavailable" && reason) return { reference: { status: "unavailable" as const, reason } };
  return {};
}

function responseRecord(body: Record<string, unknown>, run: TutorReviewRun, credential: string | undefined): NonNullable<TutorReviewStep["response"]> {
  const free = freeText(run, credential);
  return {
    ...present("responseStyle", code(tutorResponseStyleSchema, body.responseStyle)),
    ...present("question", free(body.question, 2_000)), ...present("feedback", free(body.feedback, 1_000)),
    ...optionalNumber(body.answerRating, "answerRating", 1, 5),
    ...present("learnerInput", code(tutorLearnerInputSchema, body.learnerInput)),
    ...present("questionStatus", code(z.enum(["open", "closed"]), body.questionStatus)),
    ...present("topic", free(body.topic, 120)), ...optionalNumber(body.difficulty, "difficulty", 1, 100),
    ...present("mermaid", free(body.mermaid, 12_000)), ...present("model", free(body.model, 128)),
    ...present("explanation", free(body.explanation, 1_000)),
    ...referenceOf(body.reference, free),
    ...nextOf(body.next, free),
    ...(body.completed === true ? { completed: true } : {}),
    ...learningOf(body, free),
    ...supportOf(body.support),
    ...focusOf(body.focusProgress, free),
  } as NonNullable<TutorReviewStep["response"]>;
}

function serverRecord(review: unknown, step: TutorReviewStep, serverAvailable: boolean | undefined, run: TutorReviewRun, credential: string | undefined): NonNullable<TutorReviewStep["server"]> {
  if (review === undefined) {
    run.incomplete.add("server-review-unavailable");
    return { status: serverAvailable === false ? "disabled" : "unavailable", entries: [] };
  }
  // The server keeps its block within the limit; a larger one is not trusted, whatever its schema says.
  const oversized = utf8Bytes(JSON.stringify(review) ?? "") > TUTOR_REVIEW_LIMITS.serverBlockBytes;
  const parsed = oversized ? undefined : tutorReviewEnvelopeSchema.safeParse(review);
  const operation = step.kind === "answer" ? "answer" : step.kind;
  if (!parsed?.success || parsed.data.traceId !== step.traceId || parsed.data.requestId !== step.requestId || parsed.data.operation !== operation) {
    run.incomplete.add("review-invalid");
    return { status: "invalid", entries: [] };
  }
  const { promptRevision, guidanceRevision, guidance, entries, dropped, sanitized } = parsed.data;
  // Evidence the server left out makes the run incomplete, also where the step itself looks whole.
  if (dropped > 0 || entries.some((entry) => entry.kind === "facts" && entry.omitted !== undefined)) run.incomplete.add("server-review-truncated");
  // The rule texts are server content like any other and pass the same redaction.
  keepGuidance(run, { guidanceRevision, ...guidance }, credential);
  return { status: "received", promptRevision, guidanceRevision, entries: entries.map((entry) => {
    const redacted = redactTutorReviewServerEntry(entry, credential);
    run.sanitized += redacted.count;
    return redacted.value;
  }), dropped, sanitized };
}

/** Keeps a server rule set that differs from the client's texts, once per run, so each step's rules stay readable. */
function keepGuidance(run: TutorReviewRun, raw: TutorReviewGuidanceSet, credential: string | undefined): void {
  // Compared as sent: a short key must not make the client's own texts look like a different rule set.
  const own = raw.guidanceRevision === TUTOR_ASSESSMENT_GUIDANCE_REVISION && raw.ratingRubric === TUTOR_RATING_RUBRIC && raw.difficultyGuidance === TUTOR_DIFFICULTY_GUIDANCE;
  if (own) return;
  // A differing set is kept like any server content: redacted.
  const set = { guidanceRevision: raw.guidanceRevision, ...redactedValue({ ratingRubric: raw.ratingRubric, difficultyGuidance: raw.difficultyGuidance }, run, credential) };
  const known = run.guidanceSets.some((candidate) => candidate.guidanceRevision === set.guidanceRevision && candidate.ratingRubric === set.ratingRubric && candidate.difficultyGuidance === set.difficultyGuidance);
  if (known) return;
  if (run.guidanceSets.length >= TUTOR_REVIEW_LIMITS.guidanceSets) {
    // A step then names a rule set whose texts the run does not hold; that is missing evidence.
    run.incomplete.add("capture-limit");
    run.missingGuidance.add(set.guidanceRevision);
    return;
  }
  if (reserve(run, estimate(set))) run.guidanceSets.push(set);
  else run.missingGuidance.add(set.guidanceRevision);
}

/** Records the response of a captured request; nothing happens for a request of an earlier epoch. */
export function receiveTutorReviewResponse(handle: TutorReviewHandle | undefined, input: {
  readonly ok: boolean;
  readonly httpStatus?: number;
  readonly body: unknown;
  readonly review: unknown;
  readonly serverAvailable: boolean | undefined;
}): void {
  const live = liveStep(handle);
  const credential = handle?.credential;
  // The credential is needed only for this redaction; it never outlives the response, also a stale one.
  if (handle) delete handle.credential;
  if (!live) return;
  const { run, step } = live;
  const body = asRecord(input.body);
  const response = input.ok ? responseRecord(body, run, credential) : undefined;
  const server = step.kind === "models" ? undefined : serverRecord(input.review, step, input.serverAvailable, run, credential);
  const error = asRecord(body.error);
  const failure = input.ok ? undefined : {
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
    // Error codes are server text, not a closed enumeration here, so they are redacted like free content.
    ...(typeof error.code === "string" && /^[A-Z_]{1,64}$/.test(error.code) ? { code: redactedText(error.code, 64, run, credential) } : {}),
  };
  const addition = { response, server, failure };
  if (!reserve(run, estimate(addition))) {
    // The run stopped at its limit; the step must not later look complete without its content.
    step.status = "discarded";
    changed();
    return;
  }
  if (response) step.response = response;
  if (server) step.server = server;
  if (failure) { step.failure = failure; step.status = "failed"; }
  changed();
}

function finishStep(handle: TutorReviewHandle | undefined, status: TutorReviewStep["status"], code?: string): void {
  const live = liveStep(handle);
  if (handle) delete handle.credential;
  if (live?.step.status !== "open") return;
  live.step.status = status;
  if (code) live.step.failure = { ...live.step.failure, code };
  if (status === "aborted") live.run.incomplete.add("request-aborted");
  changed();
}

/** The response passed the learning schema and is shown or held. */
export function completeTutorReviewStep(handle: TutorReviewHandle | undefined): void { finishStep(handle, "completed"); }
export function failTutorReviewStep(handle: TutorReviewHandle | undefined, code: string): void { finishStep(handle, "failed", code); }
export function abortTutorReviewStep(handle: TutorReviewHandle | undefined): void { finishStep(handle, "aborted"); }

/** A technical event belongs to the step of its request; events of unknown requests are not kept. */
export function addTutorReviewEvent(event: TutorDiagnosticEvent): void {
  const run = currentRun() ?? runs.at(-1);
  const step = run ? indexOf(run).stepsByRequest.get(event.requestId) : undefined;
  if (!run || !step) return;
  const bytes = estimate(event);
  if (step.events.length >= 256 || run.estimatedBytes + bytes > TUTOR_REVIEW_LIMITS.runBytes - TUTOR_REVIEW_LIMITS.closingReserveBytes) {
    // A lost event is missing evidence; the header must say so.
    if (!run.incomplete.has("capture-limit")) { run.incomplete.add("capture-limit"); changed(); }
    return;
  }
  run.estimatedBytes += bytes;
  step.events.push(event);
  changed();
}

/** A local action without a request: the next question held back, shown after "Weiter", or a dialog reset. */
export function addTutorReviewLocalStep(kind: LocalStepKind, relatesTo?: TutorReviewHandle): void {
  const related = relatesTo && liveStep(relatesTo);
  // Held and displayed belong to a captured response of this epoch; without one they must not begin a new run.
  if ((kind !== "reset" || relatesTo) && !related) return;
  const run = kind === "reset" ? currentRun() : runForNewAction();
  if (!run) return;
  const step: TutorReviewStep = {
    stepId: newId(), sequence: ++sequence, at: now(), kind, status: "recorded",
    ...(related ? { relatesTo: related.step.stepId, traceId: related.step.traceId, contextId: related.step.contextId } : {}),
    events: [],
  };
  if (!reserve(run, estimate(step))) { changed(); return; }
  run.steps.push(step);
  changed();
}

/** The rating average the Tutor shows, with its count and window, as of the latest change. */
export function setTutorReviewRatingSummary(summary: NonNullable<TutorReviewStep["ratingSummary"]>): void {
  const run = currentRun();
  if (!run) return;
  run.ratingSummary = summary;
  changed();
}

// ---- Lifecycle --------------------------------------------------------------------------------

/** Manual clearing: all runs go, and requests started before cannot bring content back. */
export function clearTutorReviewRuns(): void {
  epoch++;
  runs = [];
  removedRuns = 0;
  startNewRun = true;
  changed();
}

/** DEBUG off ends recording, also for running requests; switching it on again begins a new run. */
export function setTutorReviewCaptureEnabled(enabled: boolean): void {
  epoch++;
  const active = currentRun();
  if (!enabled && active) stopRun(active, "capture-disabled");
  if (enabled) startNewRun = true;
  changed();
}

/** Ends the current run; the next Tutor action begins a new one. */
export function startNewTutorReviewRun(): void {
  const active = currentRun();
  if (active) finishRun(active);
  startNewRun = true;
  changed();
}
