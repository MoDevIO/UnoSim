import type {
  TutorQualityExecutionStatus,
  TutorQualityInvariantViolation,
} from "../real-provider-evaluation";
import type { Stage2ATranscriptReference } from "./transcript-reference";

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

export const CASE_EXPOSURE_STATUSES = [
  "unexposed",
  "case-known",
  "outcome-exposed",
  "used-for-targeted-change",
  "unknown",
] as const;
export type CaseExposureStatus = typeof CASE_EXPOSURE_STATUSES[number];

export type SemanticEvaluationStatus =
  | "completed"
  | "partially-completed"
  | "abstained"
  | "invalid"
  | "judge-technical-failure"
  | "not-evaluated";

export type SemanticDimensionAssessmentStatus = "assessed" | "not-assessable" | "abstained";
export type SemanticWeaknessSeverity = "critical" | "major" | "minor";

export interface SemanticEvidenceSource {
  readonly id: string;
  readonly kind: SemanticEvidenceSourceKind;
  readonly reference: string;
  readonly digest: string;
}

export interface SemanticRubricResult {
  readonly dimension: SemanticRubricDimension;
  readonly assessmentStatus: SemanticDimensionAssessmentStatus;
  /** Substantive outcomes are defined only by a separately versioned rubric. */
  readonly outcome?: string;
  readonly rationale?: string;
  readonly uncertainty?: string;
  readonly evidenceCitations?: readonly string[];
}

export interface SemanticIssue {
  readonly severity: SemanticWeaknessSeverity;
  readonly code: string;
  readonly affectedDimensions: readonly SemanticRubricDimension[];
  readonly evidenceCitations: readonly string[];
  readonly materialityRationale: string;
}

export interface SemanticSampleEvaluation {
  readonly schemaVersion: "tutor-quality-semantic-sample-v1";
  readonly semanticEvaluationIdentity: string;
  readonly transcriptReference: Stage2ATranscriptReference;
  readonly candidateIdentity: string;
  readonly caseExposureRecordIdentity: string;
  readonly caseExposureRecordDigest: string;
  readonly executionStatus: TutorQualityExecutionStatus;
  readonly invariantViolations: readonly TutorQualityInvariantViolation[];
  readonly semanticEvaluationStatus: SemanticEvaluationStatus;
  readonly rubricResults: readonly SemanticRubricResult[];
  readonly issues: readonly SemanticIssue[];
  readonly criticalSemanticFailures: readonly SemanticIssue[];
}

export interface CaseExposureRecordReference {
  readonly identity: string;
  readonly digest: string;
  readonly candidateIdentity: string;
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly caseId: string;
  readonly semanticCaseDigest: string;
}
