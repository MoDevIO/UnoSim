export const SEMANTIC_CASE_ROLES = ["development", "calibration", "held-out-evaluation"] as const;
export type SemanticCaseRole = typeof SEMANTIC_CASE_ROLES[number];

export const SEMANTIC_RUBRIC_DIMENSIONS = [
  "factual-correctness",
  "sketch-code-grounding",
  "learner-answer-diagnosis",
  "precision",
  "instructional-usefulness",
  "scaffolding",
  "dialogic-progression",
  "non-repetition",
  "difficulty-appropriateness",
] as const;
export type SemanticRubricDimension = typeof SEMANTIC_RUBRIC_DIMENSIONS[number];

export const SEMANTIC_ANSWER_CATEGORIES = [
  "fully-correct",
  "partially-correct",
  "typical-misconception",
  "terminology-confusion",
  "correct-poorly-phrased",
  "explicitly-unknown",
  "off-topic",
  "unexpectedly-strong",
] as const;
export type SemanticAnswerCategory = typeof SEMANTIC_ANSWER_CATEGORIES[number];

export const SEMANTIC_EVIDENCE_SOURCE_KINDS = [
  "repository/sketch",
  "repository/course-content",
  "draft-factual-reference",
  "reviewed-factual-reference",
  "permitted-external-knowledge",
] as const;
export type SemanticEvidenceSourceKind = typeof SEMANTIC_EVIDENCE_SOURCE_KINDS[number];

export type CaseExposureStatus =
  | "unexposed"
  | "case-known"
  | "outcome-exposed"
  | "used-for-targeted-change"
  | "unknown";

export interface SemanticEvidenceSource {
  readonly id: string;
  readonly kind: SemanticEvidenceSourceKind;
  readonly reference: string;
  readonly digest: string;
}
