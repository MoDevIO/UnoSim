import type { LLMProviderRequest, ProviderQuestionResult } from "../llm-provider";
import { TutorProviderError } from "../llm-provider";
import { sha256 } from "./canonical";
import { findRevealedLiteral } from "./reveal-check";
import type {
  TutorQualityDeterministicCheck,
  TutorQualityInvariantViolation,
  TutorQualityProviderRequestArtifact,
  TutorQualityTechnicalError,
} from "./real-provider-evaluation";

/** Records shared by the service and the HTTP execution of the Tutor quality evaluation (Evaluation SSOT §11). */

/** One provider call as the counting provider saw it: the request and its result or error. */
export interface ProviderCapture {
  readonly request: LLMProviderRequest;
  readonly response?: ProviderQuestionResult;
  readonly error?: unknown;
}

/**
 * One provider attempt of a turn (review F3). The application may retry after an unusable result and
 * deliver only the last one; every attempt is raw model evidence, including the discarded ones.
 */
export interface TutorQualityProviderAttempt {
  readonly attempt: number;
  readonly systemPromptDigest: string;
  readonly userPromptDigest: string;
  readonly rawProviderResult?: Record<string, unknown>;
  readonly returnedModel?: string;
  readonly technicalError?: TutorQualityTechnicalError;
}

export function providerAttempts(captures: readonly ProviderCapture[], credential?: string): TutorQualityProviderAttempt[] {
  return captures.map((capture, index) => ({
    attempt: index + 1,
    systemPromptDigest: sha256(capture.request.systemPrompt),
    userPromptDigest: sha256(capture.request.userPrompt),
    ...(capture.response ? { rawProviderResult: safeResult(capture.response.result, credential), returnedModel: redact(String(capture.response.model ?? ""), credential) } : {}),
    ...(capture.error === undefined ? {} : { technicalError: technicalError(capture.error) }),
  }));
}

/** R-ID-4: a provider result names a non-empty model. */
export function hasReturnedModel(capture: ProviderCapture): boolean {
  const model = capture.response?.model;
  return typeof model === "string" && model.trim().length > 0;
}

export class EvaluationBudgetExceeded extends Error {
  constructor() {
    super("call-budget-exhausted");
    this.name = "EvaluationBudgetExceeded";
  }
}


export function technicalError(error: unknown): TutorQualityTechnicalError {
  if (error instanceof EvaluationBudgetExceeded) return { kind: "call-budget-exhausted", name: error.name };
  if (error instanceof TutorProviderError) return { kind: error.kind, name: error.name };
  return { kind: "provider-error", name: "ProviderError" };
}

export function redact(value: string, credential: string | undefined): string {
  return credential && credential.length > 0 ? value.split(credential).join("[REDACTED]") : value;
}

export function safeResult(value: unknown, credential?: string): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const allowed = new Set([
    "responseStyle", "feedback", "question", "topic", "difficulty", "answerRating", "mermaid",
    "topicId", "conceptId", "questionId", "indicatorId", "questionKind", "strategyId", "strategySource",
    "contentRevision", "learningPhase", "activeTopicId", "masteredTopicIds", "progressionBlockedReason",
    "extensionTargetTopicId",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof item === "string") {
      result[key] = redact(item, credential);
    } else if (typeof item === "number" || typeof item === "boolean" || item === undefined) {
      result[key] = item;
    } else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      result[key] = item.map((entry) => redact(entry, credential));
    }
  }
  return result;
}

export function requestArtifact(request: LLMProviderRequest, credential?: string): TutorQualityProviderRequestArtifact {
  return {
    model: request.model,
    systemPrompt: redact(request.systemPrompt, credential),
    systemPromptDigest: sha256(request.systemPrompt),
    userPrompt: redact(request.userPrompt, credential),
    userPromptDigest: sha256(request.userPrompt),
  };
}


export function addCheck(
  checks: TutorQualityDeterministicCheck[],
  name: string,
  passed: boolean,
  details?: string,
): void {
  checks.push({ name, outcome: passed ? "pass" : "fail", passed, ...(details ? { details } : {}) });
}

export function addNotApplicableCheck(
  checks: TutorQualityDeterministicCheck[],
  name: string,
  reason: string,
  details?: string,
): void {
  checks.push({ name, outcome: "not-applicable", passed: false, reason, ...(details ? { details } : {}) });
}

export function addViolation(
  violations: TutorQualityInvariantViolation[],
  code: string,
  source: TutorQualityInvariantViolation["source"],
  turnIndex: number | undefined,
  details?: string,
): void {
  violations.push({ code, source, ...(turnIndex === undefined ? {} : { turnIndex }), ...(details ? { details } : {}) });
}

/**
 * The literals a turn must not reveal: the case's for every turn, and the turn's own (R-SUP-E5). A case that
 * ends with the confirmation of a correct answer declares them only on the turns before it.
 */
export function revealLiteralsFor(
  expected: { readonly mustNotReveal?: readonly string[] } | undefined,
  turn: { readonly mustNotReveal?: readonly string[] },
): readonly string[] | undefined {
  const literals = [...(expected?.mustNotReveal ?? []), ...(turn.mustNotReveal ?? [])];
  return literals.length > 0 ? literals : undefined;
}

export function declaredLeakCheck(
  rawResult: unknown,
  literals: readonly string[] | undefined,
  turnIndex: number,
  checks: TutorQualityDeterministicCheck[],
  violations: TutorQualityInvariantViolation[],
): void {
  if (literals === undefined) return;
  const raw = typeof rawResult === "object" && rawResult !== null && !Array.isArray(rawResult)
    ? rawResult as { feedback?: unknown; question?: unknown }
    : {};
  const texts = [raw.feedback, raw.question].filter((text): text is string => typeof text === "string");
  if (texts.length === 0) {
    addNotApplicableCheck(checks, "raw-provider-no-declared-leak", "raw-provider-no-readable-text");
    return;
  }
  // A miss only means that no declared literal occurred (R-REV-3).
  const revealed = findRevealedLiteral(texts, literals);
  addCheck(checks, "raw-provider-no-declared-leak", revealed === undefined, revealed);
  if (revealed !== undefined) addViolation(violations, "solution-revealed", "raw-provider", turnIndex, revealed);
}

