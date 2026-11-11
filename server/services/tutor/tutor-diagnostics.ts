import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  diagnosticBytes, TUTOR_DIAGNOSTIC_LIMITS, tutorDiagnosticEventSchema,
  type TutorDiagnosticData, type TutorDiagnosticEnvelope, type TutorDiagnosticEvent,
} from "@shared/tutor-diagnostics";
import { tutorDiagramType } from "@shared/tutor-mermaid-rules";
import {
  redactTutorReviewServerEntry, TUTOR_REVIEW_LIMITS, tutorReviewServerEntrySchema,
  type TutorReviewEnvelope, type TutorReviewServerEntry,
} from "@shared/tutor-review";
import { TUTOR_ASSESSMENT_GUIDANCE_REVISION, TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";

interface DiagnosticContext {
  traceId: string;
  requestId: string;
  operation: TutorDiagnosticEvent["operation"];
  credential?: string;
}
interface Collector extends DiagnosticContext {
  events: TutorDiagnosticEvent[];
  sequence: number;
  dropped: number;
  bytes: number;
  models?: Set<string>;
  /** The model name the provider reported for this request, once it passed the format check. */
  returnedModel?: string;
  diagramId?: string;
  providerAttempt: number;
  review: { entries: TutorReviewServerEntry[]; bytes: number; dropped: number; sanitized: number; draftGraphic: boolean };
}
const storage = new AsyncLocalStorage<Collector>();
const MODEL_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;

/** A model name may appear in diagnostics only in a plain, bounded form that cannot carry the credential. */
function isSafeModelId(model: string, credential: string | undefined): boolean {
  return model.length <= 128 && MODEL_ID_FORMAT.test(model) && !(credential && model.includes(credential));
}

/**
 * A requested name comes from the browser, so it must be one the provider listed for this credential.
 * The returned name comes from the provider and is also shown in the Tutor panel; it only has to be safe.
 */
function isAllowedModel(collector: Collector, key: "modelRequested" | "modelReturned", model: string): boolean {
  if (!isSafeModelId(model, collector.credential)) return false;
  return collector.models?.has(model) === true || (key === "modelReturned" && collector.returnedModel === model);
}

export function withTutorDiagnostics<T>(context: DiagnosticContext, operation: () => T): T {
  const credential = context.credential?.trim();
  const traceId = context.traceId === credential ? randomUUID() : context.traceId;
  const requestId = context.requestId === credential ? randomUUID() : context.requestId;
  return storage.run({ ...context, credential, traceId, requestId, events: [], sequence: 0, dropped: 0, bytes: 0, providerAttempt: 0, review: { entries: [], bytes: 0, dropped: 0, sanitized: 0, draftGraphic: false } }, operation);
}

export function reportTutorDiagnostic(data: TutorDiagnosticData): void {
  const collector = storage.getStore();
  if (!collector) return;
  if (data.stage === "safety") collector.diagramId ??= randomUUID();
  const parsed = tutorDiagnosticEventSchema.safeParse({
    version: 1, traceId: collector.traceId, requestId: collector.requestId,
    sequence: ++collector.sequence, timestamp: new Date().toISOString(), operation: collector.operation,
    ...(collector.diagramId ? { diagramId: collector.diagramId } : {}),
    ...(collector.providerAttempt ? { providerAttempt: collector.providerAttempt } : {}), ...data,
  });
  if (!parsed.success) { collector.dropped++; return; }
  const event = parsed.data;
  // A caller cannot bypass the model allowlist through the general event API.
  for (const key of ["modelRequested", "modelReturned"] as const) {
    const model = event[key];
    if (model && !isAllowedModel(collector, key, model)) delete event[key];
  }
  const bytes = diagnosticBytes(event);
  const terminal = event.stage === "request" && ["completed", "failed", "aborted"].includes(event.outcome);
  if (!terminal && (collector.events.length >= TUTOR_DIAGNOSTIC_LIMITS.events - 2 || collector.bytes + bytes > TUTOR_DIAGNOSTIC_LIMITS.envelopeBytes - 4_096)) {
    collector.dropped++;
    return;
  }
  collector.events.push(event);
  collector.bytes += bytes;
}

export function getTutorDiagnostics(): TutorDiagnosticEnvelope | undefined {
  const collector = storage.getStore();
  if (!collector) return undefined;
  const events = [...collector.events];
  if (collector.dropped > 0) events.push({
    version: 1, traceId: collector.traceId, requestId: collector.requestId, sequence: collector.sequence + 1,
    timestamp: new Date().toISOString(), origin: "service", operation: collector.operation,
    stage: "buffer", outcome: "truncated", reason: "event-limit", dropped: collector.dropped,
  });
  return { version: 1, traceId: collector.traceId, requestId: collector.requestId, events, truncated: collector.dropped };
}

export function reportTutorModelList(models: readonly string[]): void {
  const collector = storage.getStore();
  if (!collector) return;
  collector.models = new Set(models.slice(0, 256).filter((model) => isSafeModelId(model, collector.credential)));
}
export function reportTutorModel(requested: string, returned?: string): void {
  const collector = storage.getStore();
  if (!collector) return;
  const requestedAllowed = isAllowedModel(collector, "modelRequested", requested);
  const returnedAllowed = returned !== undefined && isSafeModelId(returned, collector.credential);
  if (returnedAllowed) collector.returnedModel = returned;
  reportTutorDiagnostic({
    origin: "provider", stage: "provider", outcome: returned === undefined ? "started" : "completed",
    ...(requestedAllowed ? { modelRequested: requested } : {}),
    ...(returnedAllowed ? { modelReturned: returned } : {}),
    ...modelWithheldReason(collector, requestedAllowed, returned === undefined || returnedAllowed),
  });
}
/** Names why a model name is missing from the event; a provider-specific version name is not a reason. */
function modelWithheldReason(collector: Collector, requestedAllowed: boolean, returnedAllowed: boolean): Pick<TutorDiagnosticData, "reason"> {
  if (!returnedAllowed) return { reason: "model-id-withheld" };
  if (requestedAllowed) return {};
  return { reason: collector.models ? "model-id-not-listed" : "model-list-unavailable" };
}
export function beginTutorProviderAttempt(): void {
  const collector = storage.getStore();
  if (collector) collector.providerAttempt++;
}
export function reportTutorMermaidField(value: unknown): void {
  const collector = storage.getStore();
  if (!collector) return;
  if (typeof value === "string" && value.trim()) collector.diagramId ??= randomUUID();
  const metadata = typeof value === "string" ? { chars: Math.min(value.length, 1_000_000_000), diagramType: tutorDiagramType(value) } : {};
  if (value === undefined) reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "not-provided", reason: "not-provided" });
  else if (value === null) reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "null", reason: "null-field" });
  else if (typeof value !== "string") reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "rejected", reason: "invalid-field-type" });
  else if (!value.trim()) reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "empty", reason: "empty", ...metadata });
  else if (value.trim().length > 12_000) reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "rejected", reason: "too-long", ...metadata });
  else reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "provided", ...metadata });
}

// ---- Review block (LearningQuestions 12.7) ------------------------------------------------------

/** Room kept in the review block for its envelope fields, including the guidance texts it carries. */
const REVIEW_ENVELOPE_RESERVE = 2_048 + 2 * Buffer.byteLength(TUTOR_RATING_RUBRIC + TUTOR_DIFFICULTY_GUIDANCE);

/**
 * Adds one draft or decision to this request's review block. Every text is redacted against the request's
 * credential before it is kept; an entry that would exceed the block budget is dropped and counted.
 */
export function reportTutorReview(entry: TutorReviewServerEntry): void {
  const collector = storage.getStore();
  if (!collector) return;
  const { review } = collector;
  // Structure and fixed codes are checked first; only then the free content fields are redacted, and the
  // result is checked again against the shared redacted-length bound.
  const checked = tutorReviewServerEntrySchema.safeParse(entry);
  const redacted = checked.success ? redactTutorReviewServerEntry(checked.data, collector.credential) : undefined;
  const parsed = redacted ? tutorReviewServerEntrySchema.safeParse(redacted.value) : checked;
  const bytes = parsed.success ? diagnosticBytes(parsed.data) : 0;
  const tooLarge = review.bytes + bytes > TUTOR_REVIEW_LIMITS.serverBlockBytes - REVIEW_ENVELOPE_RESERVE;
  if (!parsed.success || tooLarge || review.entries.length >= TUTOR_REVIEW_LIMITS.serverEntries) {
    review.dropped++;
    return;
  }
  review.sanitized += redacted?.count ?? 0;
  review.entries.push(parsed.data);
  review.bytes += bytes;
}

/** The current request's review block; the prompt revision comes from the route, which knows the prompts. */
export function getTutorReview(promptRevision: TutorReviewEnvelope["promptRevision"]): TutorReviewEnvelope | undefined {
  const collector = storage.getStore();
  if (!collector) return undefined;
  const { review } = collector;
  return {
    version: 1, traceId: collector.traceId, requestId: collector.requestId, operation: collector.operation,
    promptRevision, guidanceRevision: TUTOR_ASSESSMENT_GUIDANCE_REVISION,
    guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE },
    entries: [...review.entries], dropped: review.dropped, sanitized: review.sanitized,
  };
}

/** The provider's normalized draft of this attempt: the fields the service then checks, plans and may replace. */
export function reportTutorReviewDraft(draft: Omit<Extract<TutorReviewServerEntry, { kind: "draft" }>, "kind" | "attempt">): void {
  const collector = storage.getStore();
  if (!collector) return;
  if (draft.mermaid) collector.review.draftGraphic = true;
  reportTutorReview({ kind: "draft", attempt: collector.providerAttempt, ...draft });
}

/** Whether a provider draft of this request carried a graphic, so a missing final graphic counts as discarded. */
export function tutorReviewDraftHadGraphic(): boolean {
  return storage.getStore()?.review.draftGraphic ?? false;
}
