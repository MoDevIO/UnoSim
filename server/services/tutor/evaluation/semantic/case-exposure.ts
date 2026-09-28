import { canonicalSemanticDigest, canonicalSemanticJson, deepFreeze, isSha256Digest } from "./semantic-canonical";
import { CASE_EXPOSURE_STATUSES, type CaseExposureStatus } from "./semantic-types";

export type CaseExposureAvailability = "available" | "unavailable" | "unknown";
export type CaseExposureArtifact = "caseDefinition" | "tutorOutput" | "humanReference" | "judgeResult";

export interface CaseExposureSnapshot {
  readonly recordedAt: string;
  readonly availableArtifacts: Readonly<Record<CaseExposureArtifact, CaseExposureAvailability>>;
  readonly targetedChange: {
    readonly status: "informed" | "not-informed" | "unknown";
    readonly rationale?: string;
  };
}

export interface CaseExposureRecordInput {
  readonly candidateIdentity: string;
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly caseId: string;
  readonly semanticCaseDigest: string;
  readonly history: readonly CaseExposureSnapshot[];
}

export interface CaseExposureRecord extends CaseExposureRecordInput {
  readonly schemaVersion: "tutor-quality-case-exposure-v1";
  readonly recordVersion: number;
  readonly exposureStatus: CaseExposureStatus;
  readonly identity: string;
  readonly digest: string;
  readonly previousRecordDigest?: string;
}

export interface CaseExposureBinding {
  readonly candidateIdentity: string;
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly caseId: string;
  readonly semanticCaseDigest: string;
}

export type CaseExposureRecordValidation =
  | { readonly valid: true; readonly record: CaseExposureRecord }
  | { readonly valid: false; readonly reason: string };

const ARTIFACTS: readonly CaseExposureArtifact[] = ["caseDefinition", "tutorOutput", "humanReference", "judgeResult"];
const OUTCOME_ARTIFACTS: readonly CaseExposureArtifact[] = ["tutorOutput", "humanReference", "judgeResult"];

function recordIdentity(input: CaseExposureRecordInput, recordVersion: number, previousRecordDigest?: string): string {
  return canonicalSemanticDigest({
    schemaVersion: "tutor-quality-case-exposure-v1",
    candidateIdentity: input.candidateIdentity,
    corpusId: input.corpusId,
    corpusVersion: input.corpusVersion,
    caseId: input.caseId,
    semanticCaseDigest: input.semanticCaseDigest,
    recordVersion,
    ...(previousRecordDigest ? { previousRecordDigest } : {}),
  });
}

function exposureStatus(snapshot: CaseExposureSnapshot): CaseExposureStatus {
  if (snapshot.targetedChange.status === "informed") return "used-for-targeted-change";
  if (snapshot.targetedChange.status === "unknown" || ARTIFACTS.some((artifact) => snapshot.availableArtifacts[artifact] === "unknown")) return "unknown";
  if (OUTCOME_ARTIFACTS.some((artifact) => snapshot.availableArtifacts[artifact] === "available")) return "outcome-exposed";
  if (snapshot.availableArtifacts.caseDefinition === "available") return "case-known";
  return "unexposed";
}

function validateSnapshot(snapshot: CaseExposureSnapshot, index: number, previous?: CaseExposureSnapshot): void {
  if (snapshot === null || typeof snapshot !== "object") throw new Error(`Exposure history[${index}] must be an object`);
  if (Object.keys(snapshot).some((key) => !["recordedAt", "availableArtifacts", "targetedChange"].includes(key))) throw new Error(`Exposure history[${index}] contains an unsupported field`);
  if (typeof snapshot.recordedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(snapshot.recordedAt) || Number.isNaN(Date.parse(snapshot.recordedAt))) {
    throw new Error(`Exposure history[${index}] recordedAt must be an explicit UTC timestamp`);
  }
  if (previous && Date.parse(snapshot.recordedAt) <= Date.parse(previous.recordedAt)) throw new Error("Exposure history timestamps must be strictly increasing");
  if (!snapshot.availableArtifacts || Object.keys(snapshot.availableArtifacts).length !== ARTIFACTS.length || ARTIFACTS.some((artifact) => !Object.prototype.hasOwnProperty.call(snapshot.availableArtifacts, artifact) || !["available", "unavailable", "unknown"].includes(snapshot.availableArtifacts[artifact]))) {
    throw new Error(`Exposure history[${index}] must record availability for every artifact`);
  }
  if (!snapshot.targetedChange || !["informed", "not-informed", "unknown"].includes(snapshot.targetedChange.status)) {
    throw new Error(`Exposure history[${index}] targeted-change state is invalid`);
  }
  if (Object.keys(snapshot.targetedChange).some((key) => !["status", "rationale"].includes(key))) throw new Error(`Exposure history[${index}] targeted-change state contains an unsupported field`);
  if (snapshot.targetedChange.status === "informed" && (!snapshot.targetedChange.rationale || snapshot.targetedChange.rationale.trim().length === 0)) {
    throw new Error(`Exposure history[${index}] requires the rationale for a targeted change`);
  }
  if (snapshot.targetedChange.status !== "informed" && snapshot.targetedChange.rationale !== undefined) {
    throw new Error(`Exposure history[${index}] cannot attach a targeted-change rationale to a non-targeted state`);
  }
  if (previous) {
    for (const artifact of ARTIFACTS) {
      if (previous.availableArtifacts[artifact] === "available" && snapshot.availableArtifacts[artifact] !== "available") {
        throw new Error(`Exposure history cannot erase known availability of ${artifact}`);
      }
    }
    if (previous.targetedChange.status === "informed" && snapshot.targetedChange.status !== "informed") {
      throw new Error("Exposure history cannot erase a previously recorded targeted change");
    }
  }
}

function validateInput(input: CaseExposureRecordInput, record = false): void {
  const allowedKeys = record
    ? ["schemaVersion", "candidateIdentity", "corpusId", "corpusVersion", "caseId", "semanticCaseDigest", "history", "recordVersion", "exposureStatus", "identity", "digest", "previousRecordDigest"]
    : ["candidateIdentity", "corpusId", "corpusVersion", "caseId", "semanticCaseDigest", "history"];
  if (input === null || typeof input !== "object" || Object.keys(input).some((key) => !allowedKeys.includes(key))) throw new Error("CaseExposureRecord input contains an unsupported field");
  if (!isSha256Digest(input.candidateIdentity)) throw new Error("Candidate identity must be a lowercase SHA-256 digest");
  if (!isSha256Digest(input.semanticCaseDigest)) throw new Error("Semantic Case digest must be a lowercase SHA-256 digest");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.corpusId)) throw new Error("Corpus ID is invalid");
  if (!Number.isInteger(input.corpusVersion) || input.corpusVersion < 1) throw new Error("Corpus version must be a positive integer");
  if (!/^[A-Z0-9][A-Z0-9-]{0,63}$/.test(input.caseId)) throw new Error("Semantic Case ID is invalid");
  if (!Array.isArray(input.history) || input.history.length === 0) throw new Error("Exposure history must contain at least one version snapshot");
  input.history.forEach((snapshot, index) => validateSnapshot(snapshot, index, input.history[index - 1]));
  const versions = input.history.length;
  if (versions > 10_000) throw new Error("Exposure history exceeds the bounded record limit");
}

function sameBinding(left: CaseExposureBinding, right: CaseExposureBinding): boolean {
  return left.candidateIdentity === right.candidateIdentity
    && left.corpusId === right.corpusId
    && left.corpusVersion === right.corpusVersion
    && left.caseId === right.caseId
    && left.semanticCaseDigest === right.semanticCaseDigest;
}

function recordDigestContent(record: Omit<CaseExposureRecord, "digest"> | CaseExposureRecord): Record<string, unknown> {
  const { digest: _digest, ...source } = record as CaseExposureRecord;
  return source;
}

export function createCaseExposureRecord(input: CaseExposureRecordInput, previous?: CaseExposureRecord): CaseExposureRecord {
  validateInput(input);
  const recordVersion = input.history.length;
  if (previous) {
    if (!sameBinding(input, previous)) throw new Error("CaseExposureRecord revision cannot change Candidate or Semantic Case binding");
    const priorValidation = validateCaseExposureRecord(previous, input);
    if (!priorValidation.valid) throw new Error(`CaseExposureRecord revision requires a valid prior record: ${priorValidation.reason}`);
    if (recordVersion !== previous.recordVersion + 1) throw new Error("CaseExposureRecord revision must append exactly one new history snapshot");
    if (canonicalSemanticJson(input.history.slice(0, previous.history.length)) !== canonicalSemanticJson(previous.history)) {
      throw new Error("CaseExposureRecord revision must append to prior history without rewriting it");
    }
  } else if (recordVersion !== 1) {
    throw new Error("Initial CaseExposureRecord must start at version 1");
  }
  const previousRecordDigest = previous?.digest;
  if (previousRecordDigest !== undefined && !isSha256Digest(previousRecordDigest)) throw new Error("Previous CaseExposureRecord digest is invalid");
  const base = {
    schemaVersion: "tutor-quality-case-exposure-v1" as const,
    ...input,
    history: input.history.map((snapshot) => ({
      ...snapshot,
      availableArtifacts: { ...snapshot.availableArtifacts },
      targetedChange: { ...snapshot.targetedChange },
    })),
    recordVersion,
    exposureStatus: exposureStatus(input.history.at(-1)!),
    identity: recordIdentity(input, recordVersion, previousRecordDigest),
    ...(previousRecordDigest ? { previousRecordDigest } : {}),
  };
  const digest = canonicalSemanticDigest(base);
  return deepFreeze({ ...base, digest }) as CaseExposureRecord;
}

export function validateCaseExposureRecord(input: unknown, expected: CaseExposureBinding): CaseExposureRecordValidation {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return { valid: false, reason: "record-must-be-object" };
    const record = input as CaseExposureRecord;
    validateInput(record, true);
    if (record.schemaVersion !== "tutor-quality-case-exposure-v1") return { valid: false, reason: "unsupported-record-schema" };
    if (record.recordVersion !== record.history.length) return { valid: false, reason: "record-version-history-mismatch" };
    if (!sameBinding(record, expected)) return { valid: false, reason: "candidate-or-case-binding-mismatch" };
    if (record.exposureStatus !== exposureStatus(record.history.at(-1)!)) return { valid: false, reason: "exposure-status-mismatch" };
    if (!isSha256Digest(record.identity) || record.identity !== recordIdentity(record, record.recordVersion, record.previousRecordDigest)) return { valid: false, reason: "record-identity-mismatch" };
    if (!isSha256Digest(record.digest) || record.digest !== canonicalSemanticDigest(recordDigestContent(record))) return { valid: false, reason: "record-digest-mismatch" };
    return { valid: true, record };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "invalid-case-exposure-record" };
  }
}

export function caseExposureStatusValues(): readonly CaseExposureStatus[] {
  return CASE_EXPOSURE_STATUSES;
}
