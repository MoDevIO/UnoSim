import { z } from "zod";
import { boundedArray } from "./bounded-array";
import { INPUT_LIMITS } from "./input-limits";
import { boardIdSchema } from "./boards";
import {
  tutorFocusProgressSchema, tutorLearnerInputSchema, tutorLearningPhaseSchema, tutorQuestionKindSchema, tutorQuestionOutcomeSchema,
  tutorResponseStyleSchema, tutorStrategySourceSchema,
} from "./tutor";
import { tutorDiagnosticEventSchema } from "./tutor-diagnostics";
import { tutorReferenceUnavailableReasonSchema } from "./tutor-support";

/**
 * The local Tutor review capture (LearningQuestions 12.7): what one Tutor test run asked, answered, rated,
 * replaced and showed, with the code each request sent. The server adds drafts and decisions in a separate
 * `review` block; the browser keeps the run in RAM and exports it with one copy action.
 */
export const TUTOR_REVIEW_FORMAT = "unosim-tutor-review";
export const TUTOR_REVIEW_FORMAT_VERSION = 1;

const KIB = 1024;
const MIB = 1024 * KIB;
export const TUTOR_REVIEW_LIMITS = {
  runs: 3,
  runBytes: 8 * MIB,
  totalBytes: 24 * MIB,
  requestAttempts: 100,
  contexts: 16,
  contextBytes: 2 * MIB,
  serverBlockBytes: 128 * KIB,
  serverEntries: 64,
  /** Kept free in every run for the closing status, counts and reasons. */
  closingReserveBytes: 16 * KIB,
  factsChars: 32 * KIB,
  /** Server rule sets kept per run besides the client's own; a further one is reported as missing. */
  guidanceSets: 16,
} as const;

export const TUTOR_REVIEW_REDACTED = "[REDACTED-CREDENTIAL]";

/** Why a question the learner received differs from the provider's draft, set where the service decides. */
export const TUTOR_REVIEW_TRIGGERS = [
  "planner-question",
  "repetition-fallback",
  "retain-open-question",
  "planned-question-rejected",
  "non-learning-fallback",
  "assisted-question-left",
] as const;
export const tutorReviewTriggerSchema = z.enum(TUTOR_REVIEW_TRIGGERS);
export type TutorReviewTrigger = z.infer<typeof tutorReviewTriggerSchema>;

export const TUTOR_REVIEW_INCOMPLETE_REASONS = [
  "capture-started-late",
  "capture-disabled",
  "capture-limit",
  "server-review-unavailable",
  "review-invalid",
  "request-aborted",
  "capture-cleared",
  "server-review-truncated",
] as const;
export const tutorReviewIncompleteReasonSchema = z.enum(TUTOR_REVIEW_INCOMPLETE_REASONS);

const text = (max: number) => z.string().max(max);
/** The most characters a redacted text of at most `max` characters can have (see `redactTutorReviewText`). */
export const tutorReviewRedactedChars = (max: number): number => max * TUTOR_REVIEW_REDACTED.length;
/**
 * A text after redaction, in every contract that carries one: server collector, transport, store and export.
 * Nothing is cut; the bound follows from the original limit.
 */
const redacted = (max: number) => z.string().max(tutorReviewRedactedChars(max));
const QUESTION_CHARS = 2_000;
const FEEDBACK_CHARS = INPUT_LIMITS.tutor.maxFeedbackChars;
const MERMAID_CHARS = 12_000;

const draftEntrySchema = z.object({
  kind: z.literal("draft"),
  attempt: z.number().int().min(0).max(1_000),
  responseStyle: tutorResponseStyleSchema.optional(),
  question: redacted(QUESTION_CHARS).optional(),
  feedback: redacted(FEEDBACK_CHARS).optional(),
  answerRating: z.number().int().min(1).max(5).optional(),
  topic: redacted(120).optional(),
  difficulty: z.number().int().min(1).max(100).optional(),
  mermaid: redacted(MERMAID_CHARS).optional(),
}).strict();

const decisionEntrySchema = z.object({
  kind: z.literal("decision"),
  trigger: tutorReviewTriggerSchema,
  /** The question before and after this decision, where the decision replaced it. */
  before: redacted(QUESTION_CHARS).optional(),
  after: redacted(QUESTION_CHARS).optional(),
}).strict();

const outcomeEntrySchema = z.object({
  kind: z.literal("outcome"),
  followUpSource: z.enum(["planner", "provider", "application-fallback"]),
  retained: z.boolean().optional(),
  withoutProvider: z.boolean().optional(),
  question: redacted(QUESTION_CHARS),
  graphic: z.enum(["kept", "discarded", "none"]),
}).strict();

const classificationEntrySchema = z.object({
  kind: z.literal("classification"),
  learnerInput: tutorLearnerInputSchema,
}).strict();

const factsEntrySchema = z.object({
  kind: z.literal("facts"),
  /** The deterministic sketch facts the prompt used, as JSON text; omitted with a reason when too large. */
  json: redacted(TUTOR_REVIEW_LIMITS.factsChars).optional(),
  omitted: z.literal("too-large").optional(),
}).strict();

const replayEntrySchema = z.object({
  kind: z.literal("replay"),
  reason: z.literal("support-cache"),
}).strict();

export const tutorReviewServerEntrySchema = z.discriminatedUnion("kind", [
  draftEntrySchema, decisionEntrySchema, outcomeEntrySchema, classificationEntrySchema, factsEntrySchema, replayEntrySchema,
]);
export type TutorReviewServerEntry = z.infer<typeof tutorReviewServerEntrySchema>;

/** The rating and difficulty texts of one guidance revision, as the Tutor used them. */
const guidanceTextsSchema = z.object({
  ratingRubric: text(4_000),
  difficultyGuidance: text(4_000),
}).strict();

const promptRevisionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/),
  templateDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** The server's `review` block of one request; it is attached to the outgoing response copy only. */
export const tutorReviewEnvelopeSchema = z.object({
  version: z.literal(1),
  traceId: z.uuid(),
  requestId: z.uuid(),
  operation: z.enum(["question", "answer", "support", "models"]),
  promptRevision: promptRevisionSchema,
  guidanceRevision: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/),
  /** The texts of `guidanceRevision`, so a review keeps the rules each request was rated with. */
  guidance: guidanceTextsSchema,
  entries: boundedArray(tutorReviewServerEntrySchema, TUTOR_REVIEW_LIMITS.serverEntries),
  dropped: z.number().int().min(0).max(1_000_000),
  sanitized: z.number().int().min(0).max(1_000_000),
}).strict();
export type TutorReviewEnvelope = z.infer<typeof tutorReviewEnvelopeSchema>;

// ---- Export ------------------------------------------------------------------------------------

const isoTime = z.iso.datetime();
const id = z.uuid();


const contextSchema = z.object({
  contextId: id,
  board: boardIdSchema.optional(),
  entryFile: redacted(INPUT_LIMITS.compile.maxHeaderNameChars).optional(),
  code: redacted(INPUT_LIMITS.compile.maxCodeChars),
  headers: boundedArray(z.object({
    name: redacted(INPUT_LIMITS.compile.maxHeaderNameChars),
    content: redacted(INPUT_LIMITS.compile.maxHeaderContentChars),
  }).strict(), INPUT_LIMITS.compile.maxHeaders),
}).strict();

const historyTurnSchema = z.object({
  question: redacted(QUESTION_CHARS),
  answer: redacted(INPUT_LIMITS.tutor.maxAnswerChars),
  feedback: redacted(FEEDBACK_CHARS).optional(),
  answerRating: z.number().int().min(1).max(5).optional(),
  responseStyle: tutorResponseStyleSchema.optional(),
}).strict();

/**
 * A history entry kept verbatim: answered before the run began (`before-capture`), or matching more than one
 * recorded step so that no single step can stand for it (`ambiguous`).
 */
const importedHistorySchema = historyTurnSchema.extend({ importId: id, reason: z.enum(["before-capture", "ambiguous"]) }).strict();

const historyRefSchema = z.union([
  z.object({ stepId: id }).strict(),
  z.object({ importId: id }).strict(),
]);

const requestSchema = z.object({
  endpoint: z.enum(["question", "dialog", "support", "models"]),
  action: z.enum(["clarify", "hint", "reveal", "skip"]).optional(),
  askedQuestion: redacted(QUESTION_CHARS).optional(),
  answer: redacted(INPUT_LIMITS.tutor.maxAnswerChars).optional(),
  difficulty: z.number().int().min(1).max(100).optional(),
  requestedModel: redacted(128).optional(),
  courseContent: z.object({
    repository: redacted(200), ref: redacted(200), revision: redacted(64), exampleId: redacted(128).optional(),
  }).strict().optional(),
  continuesCourseSession: z.boolean(),
  history: boundedArray(historyRefSchema, 64),
}).strict();

const referenceSchema = z.union([
  z.object({ status: z.literal("available"), answer: redacted(300), explanation: redacted(1_500), assumptions: boundedArray(redacted(160), 6).optional() }).strict(),
  z.object({ status: z.literal("unavailable"), reason: tutorReferenceUnavailableReasonSchema }).strict(),
]);

const learningSchema = z.object({
  topicId: redacted(64).optional(), conceptId: redacted(64).optional(), questionId: redacted(64).optional(), indicatorId: redacted(64).optional(),
  questionKind: tutorQuestionKindSchema.optional(), strategyId: redacted(64).optional(), strategySource: tutorStrategySourceSchema.optional(),
  contentRevision: redacted(64).optional(), learningPhase: tutorLearningPhaseSchema.optional(),
}).strict();

const focusProgressSchema = z.object({
  state: tutorFocusProgressSchema.shape.state, understoodAreas: z.number().int().min(0).max(8), totalAreas: z.number().int().min(1).max(8),
  openAreas: boundedArray(redacted(160), 8),
}).strict();

const responseSchema = z.object({
  responseStyle: tutorResponseStyleSchema.optional(),
  question: redacted(QUESTION_CHARS).optional(),
  feedback: redacted(FEEDBACK_CHARS).optional(),
  answerRating: z.number().int().min(1).max(5).optional(),
  learnerInput: tutorLearnerInputSchema.optional(),
  questionStatus: z.enum(["open", "closed"]).optional(),
  topic: redacted(120).optional(),
  difficulty: z.number().int().min(1).max(100).optional(),
  mermaid: redacted(MERMAID_CHARS).optional(),
  model: redacted(128).optional(),
  explanation: redacted(FEEDBACK_CHARS).optional(),
  reference: referenceSchema.optional(),
  /** The question a skip moved to, with everything the learning area shows of it. */
  next: z.object({
    question: redacted(QUESTION_CHARS),
    feedback: redacted(FEEDBACK_CHARS).optional(),
    topic: redacted(120).optional(),
    difficulty: z.number().int().min(1).max(100).optional(),
    mermaid: redacted(MERMAID_CHARS).optional(),
    learning: learningSchema.optional(),
    focusProgress: focusProgressSchema.optional(),
  }).strict().optional(),
  completed: z.boolean().optional(),
  learning: learningSchema.optional(),
  support: z.object({
    answerAttempts: z.number().int().min(0).max(1_000), clarifications: z.number().int().min(0).max(1_000),
    canRevealReference: z.boolean(), canSkip: z.boolean(), referenceShown: z.boolean(), outcome: tutorQuestionOutcomeSchema.optional(),
  }).strict().optional(),
  focusProgress: focusProgressSchema.optional(),
}).strict();

const serverSchema = z.object({
  status: z.enum(["received", "unavailable", "invalid", "disabled"]),
  promptRevision: promptRevisionSchema.optional(),
  /** A revision code, checked like in the envelope; not redacted. */
  guidanceRevision: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/).optional(),
  entries: boundedArray(tutorReviewServerEntrySchema, TUTOR_REVIEW_LIMITS.serverEntries),
  dropped: z.number().int().min(0).optional(),
  sanitized: z.number().int().min(0).optional(),
}).strict();

export const TUTOR_REVIEW_STEP_KINDS = ["question", "answer", "support", "models", "held", "displayed", "reset", "rating-summary"] as const;

const stepSchema = z.object({
  stepId: id,
  sequence: z.number().int().min(1),
  at: isoTime,
  kind: z.enum(TUTOR_REVIEW_STEP_KINDS),
  status: z.enum(["open", "completed", "failed", "aborted", "discarded", "recorded"]),
  /** Steps of the same learner action share a trace; a retry is another attempt of it. */
  traceId: id.optional(),
  requestId: id.optional(),
  attempt: z.number().int().min(1).optional(),
  relatesTo: id.optional(),
  contextId: id.optional(),
  request: requestSchema.optional(),
  response: responseSchema.optional(),
  server: serverSchema.optional(),
  failure: z.object({ httpStatus: z.number().int().optional(), code: redacted(64).optional() }).strict().optional(),
  note: z.enum(["late-result-discarded", "replayed", "rating-summary"]).optional(),
  ratingSummary: z.object({ average: z.number().min(1).max(5).nullable(), count: z.number().int().min(0), window: text(64) }).strict().optional(),
  events: boundedArray(tutorDiagnosticEventSchema, 256),
}).strict();

export const tutorReviewExportSchema = z.object({
  format: z.literal(TUTOR_REVIEW_FORMAT),
  formatVersion: z.literal(TUTOR_REVIEW_FORMAT_VERSION),
  runId: id,
  exportedAt: isoTime,
  startedAt: isoTime,
  endedAt: isoTime.optional(),
  appRevision: text(64),
  capture: z.object({
    status: z.enum(["recording", "stopped", "finished"]),
    complete: z.boolean(),
    incompleteReasons: boundedArray(tutorReviewIncompleteReasonSchema, TUTOR_REVIEW_INCOMPLETE_REASONS.length),
    stoppedReason: tutorReviewIncompleteReasonSchema.optional(),
    sanitizedTexts: z.number().int().min(0),
    notCapturedActions: z.number().int().min(0),
    openSteps: z.number().int().min(0),
    requestAttempts: z.number().int().min(0),
  }).strict(),
  legend: z.object({
    guidanceRevision: text(64),
    confirmation: z.enum(["confirmed-by-server", "differs-from-server", "client-only"]),
    ratingRubric: text(4_000),
    difficultyGuidance: text(4_000),
    /** Rule sets the server reported that differ from the client's texts above; steps name theirs by revision. */
    serverSets: boundedArray(z.object({
      guidanceRevision: text(64), ratingRubric: redacted(4_000), difficultyGuidance: redacted(4_000),
    }).strict(), TUTOR_REVIEW_LIMITS.guidanceSets),
    /**
     * Revisions steps name whose texts were not kept at the limit; the run is then incomplete. Each request
     * names at most one revision, so the request limit bounds this list and no revision is ever left out.
     */
    missingServerSets: boundedArray(text(64), TUTOR_REVIEW_LIMITS.requestAttempts),
  }).strict(),
  contexts: boundedArray(contextSchema, TUTOR_REVIEW_LIMITS.contexts),
  importedHistory: boundedArray(importedHistorySchema, 64),
  steps: boundedArray(stepSchema, 10_000),
}).strict();
export type TutorReviewExport = z.infer<typeof tutorReviewExportSchema>;
export type TutorReviewStep = TutorReviewExport["steps"][number];
export type TutorReviewContext = TutorReviewExport["contexts"][number];
export type TutorReviewHistoryRef = z.infer<typeof historyRefSchema>;
export type TutorReviewImportedTurn = z.infer<typeof importedHistorySchema>;
export type TutorReviewGuidanceSet = TutorReviewExport["legend"]["serverSets"][number];

// ---- Secret redaction -------------------------------------------------------------------------

/**
 * The spellings of a credential that may appear in a text: as given, trimmed, JSON-escaped and URL-encoded.
 * Every accepted credential counts, however short: a short test key may also hide an ordinary word, which is
 * the lesser harm than keeping a secret.
 */
function credentialSpellings(credential: string | undefined): string[] {
  const trimmed = credential?.trim() ?? "";
  if (trimmed.length === 0) return [];
  const spellings = new Set([credential!, trimmed, JSON.stringify(trimmed).slice(1, -1), encodeURIComponent(trimmed)]);
  return [...spellings].sort((a, b) => b.length - a.length);
}

/** The [start, end) spans of every marker in `text`; markers cannot overlap, `[` and `]` occur only at their ends. */
function markerSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  for (let index = text.indexOf(TUTOR_REVIEW_REDACTED); index >= 0; index = text.indexOf(TUTOR_REVIEW_REDACTED, index + TUTOR_REVIEW_REDACTED.length)) {
    spans.push([index, index + TUTOR_REVIEW_REDACTED.length]);
  }
  return spans;
}

/** Whether a spelling still occurs anywhere except entirely inside a marker. */
function exposes(text: string, spellings: readonly string[]): boolean {
  const spans = markerSpans(text);
  return spellings.some((spelling) => {
    let span = 0;
    for (let index = text.indexOf(spelling); index >= 0; index = text.indexOf(spelling, index + 1)) {
      while (span < spans.length && spans[span][1] <= index) span++;
      const inside = span < spans.length && spans[span][0] <= index && index + spelling.length <= spans[span][1];
      if (!inside) return true;
    }
    return false;
  });
}

/**
 * Replaces every known spelling of the credential in `value`; `count` is the number of replacements.
 *
 * Markers already in the text are left alone, so redacting a redacted text changes nothing: the server's
 * redaction, the browser's own pass and any later pass give the same result. Each replaced spelling has at
 * least one character and becomes one marker, so the result has at most `TUTOR_REVIEW_REDACTED.length` times
 * the characters of `value` (see `tutorReviewRedactedChars`). Where a spelling would still show across a
 * marker's edge, the whole text becomes one marker, counted as one more replacement.
 */
export function redactTutorReviewText(value: string, credential: string | undefined): { readonly text: string; readonly count: number } {
  const spellings = credentialSpellings(credential);
  if (spellings.length === 0) return { text: value, count: 0 };
  let text = value;
  let count = 0;
  for (const spelling of spellings) {
    text = text.split(TUTOR_REVIEW_REDACTED).map((piece) => {
      const parts = piece.split(spelling);
      count += parts.length - 1;
      return parts.join(TUTOR_REVIEW_REDACTED);
    }).join(TUTOR_REVIEW_REDACTED);
  }
  if (exposes(text, spellings)) return { text: TUTOR_REVIEW_REDACTED, count: count + 1 };
  return { text, count };
}

/**
 * Redacts the free content of a server entry that already passed its schema. Kind and fixed codes (response
 * style, classification, trigger, source, graphic status, omission and replay reasons) keep their checked
 * values: a credential that happens to spell a public code takes nothing secret from a content field.
 */
export function redactTutorReviewServerEntry(entry: TutorReviewServerEntry, credential: string | undefined): { readonly value: TutorReviewServerEntry; readonly count: number } {
  let count = 0;
  const free = <T extends string | undefined>(value: T): T => {
    if (value === undefined) return value;
    const redacted = redactTutorReviewText(value, credential);
    count += redacted.count;
    return redacted.text as T;
  };
  const value = ((): TutorReviewServerEntry => {
    switch (entry.kind) {
      case "draft":
        return { ...entry, question: free(entry.question), feedback: free(entry.feedback), topic: free(entry.topic), mermaid: free(entry.mermaid) };
      case "decision":
        return { ...entry, before: free(entry.before), after: free(entry.after) };
      case "outcome":
        return { ...entry, question: free(entry.question) };
      case "facts":
        return { ...entry, json: free(entry.json) };
      case "classification":
      case "replay":
        return entry;
    }
  })();
  // Optional fields stay absent instead of appearing as undefined.
  return { value: Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as TutorReviewServerEntry, count };
}

/**
 * Redacts every string inside a JSON-like value. Only for values made entirely of free content (code
 * contexts without their board, course identifiers, rule texts); values with fixed codes use a typed
 * selection of their content fields instead.
 */
export function redactTutorReviewValue<T>(value: T, credential: string | undefined): { readonly value: T; readonly count: number } {
  if (credentialSpellings(credential).length === 0) return { value, count: 0 };
  let count = 0;
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      const redacted = redactTutorReviewText(item, credential);
      count += redacted.count;
      return redacted.text;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    }
    return item;
  };
  return { value: visit(value) as T, count };
}
