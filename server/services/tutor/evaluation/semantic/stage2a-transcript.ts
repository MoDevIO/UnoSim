import { tutorContentResultSchema } from "@shared/tutor";
import type {
  TutorQualityEvaluationScenario,
  TutorQualityExecutionStatus,
  TutorQualityTranscript,
} from "../real-provider-evaluation";
import { canonicalSemanticDigest, canonicalSemanticJson, isSha256Digest } from "./semantic-canonical";
import { semanticCaseDigest, type SemanticCase } from "./semantic-corpus";
import { assessStageAScenarioCompatibility, type AdapterGeneratedProvenance } from "./stage2a-adapter";
import { stage2bTranscriptDigest } from "./transcript-reference";

export interface ExistingTranscriptCompatibilityMapping {
  readonly kind: "existing-transcript-compatibility";
  readonly mappingVersion: 1;
  readonly sourceId: string;
  readonly sourceEvaluationIdentity: string;
  readonly sourceScenarioId: string;
  readonly sourceScenario: TutorQualityEvaluationScenario;
  readonly sourceScenarioDigest: string;
  readonly semanticCorpusId: string;
  readonly semanticCorpusVersion: number;
  readonly semanticCaseId: string;
  readonly semanticCaseDigest: string;
  readonly frozenPreTurnContextDigest: string;
  readonly compatibilityDigest: string;
  readonly identity: string;
}

export type Stage2ATranscriptProvenance = AdapterGeneratedProvenance | ExistingTranscriptCompatibilityMapping;

export type Stage2ATranscriptValidation =
  | {
    readonly valid: true;
    readonly transcript: TutorQualityTranscript;
    readonly transcriptDigest: string;
    readonly compatibilityMapping: Stage2ATranscriptProvenance;
    readonly semanticEligibility: "eligible" | "not-evaluated";
  }
  | { readonly valid: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const LEARNING_PHASES = new Set(["LEARN", "DEEPEN", "EXPAND"]);

function isExpectedScenario(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ["topicId", "topicIdAbsent", "learningPhase", "stateUnchanged", "questionNotRepeat"])) return false;
  if (["topicId", "topicIdAbsent"].some((key) => value[key] !== undefined && !isNonEmptyString(value[key]))) return false;
  const phase = value.learningPhase;
  if (phase !== undefined && (typeof phase !== "string" || !LEARNING_PHASES.has(phase))) return false;
  if (value.stateUnchanged !== undefined && typeof value.stateUnchanged !== "boolean") return false;
  return value.questionNotRepeat === undefined || value.questionNotRepeat === "exact-or-heuristic";
}

function isStageAScenarioObject(value: unknown): value is TutorQualityEvaluationScenario {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "corpusId", "corpusVersion", "sketchRef", "sketch", "courseContent", "turns", "expected"])) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.corpusId) || !Number.isInteger(value.corpusVersion)
    || !isNonEmptyString(value.sketchRef) || typeof value.sketch !== "string" || !Array.isArray(value.turns)) return false;
  return isExpectedScenario(value.expected) && (value.courseContent === undefined || isRecord(value.courseContent));
}

function isExecutionStatus(value: unknown): value is TutorQualityExecutionStatus {
  return value === "completed" || value === "invalid" || value === "technical-failure" || value === "not-run";
}

interface TranscriptCallCounts {
  readonly total: number;
  readonly modelListCalls: number;
  readonly generationCalls: number;
}

const LAST_C0_CONTROL_CODE = 0x1f;
const DELETE_CONTROL_CODE = 0x7f;

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= LAST_C0_CONTROL_CODE || codePoint === DELETE_CONTROL_CODE)) return true;
  }
  return false;
}

function isCallCounts(value: unknown): value is TranscriptCallCounts {
  return isRecord(value)
    && ["total", "modelListCalls", "generationCalls"].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0)
    && Number(value.total) === Number(value.modelListCalls) + Number(value.generationCalls);
}

function isDeterministicChecks(value: unknown): boolean {
  return Array.isArray(value) && value.every((check) => isRecord(check)
    && hasOnlyKeys(check, ["name", "passed", "details"])
    && isNonEmptyString(check.name)
    && typeof check.passed === "boolean"
    && (check.details === undefined || typeof check.details === "string"));
}

function isInvariantViolations(value: unknown, turnCount: number): boolean {
  const sources = new Set(["raw-provider", "final-tutor", "state", "scenario"]);
  return Array.isArray(value) && value.every((violation) => isRecord(violation)
    && hasOnlyKeys(violation, ["code", "source", "turnIndex", "details"])
    && isNonEmptyString(violation.code)
    && sources.has(String(violation.source))
    && (violation.turnIndex === undefined || (Number.isInteger(violation.turnIndex) && Number(violation.turnIndex) >= 0 && Number(violation.turnIndex) < turnCount))
    && (violation.details === undefined || typeof violation.details === "string"));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTranscriptEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.schemaVersion === "tutor-quality-transcript-v1"
    && isSha256Digest(value.evaluationIdentity)
    && typeof value.runId === "string"
    && value.runId.length > 0
    && isExecutionStatus(value.executionStatus)
    && Array.isArray(value.turns)
    && isDeterministicChecks(value.deterministicChecks)
    && isRecord(value.scenario)
    && isRecord(value.metadata);
}

function isTranscriptScenario(value: unknown, executionStatus: TutorQualityExecutionStatus, turnCount: number): value is Record<string, unknown> & { readonly syntheticTurns: unknown[] } {
  if (!isRecord(value) || !Array.isArray(value.syntheticTurns)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.corpusId)
    || !Number.isInteger(value.corpusVersion) || Number(value.corpusVersion) < 1) return false;
  if (!isNonEmptyString(value.sketchRef) || typeof value.sketch !== "string") return false;
  if (executionStatus === "completed" && turnCount !== value.syntheticTurns.length) return false;
  return turnCount <= value.syntheticTurns.length;
}

function isTranscriptMetadata(metadata: unknown, scenario: Record<string, unknown>): metadata is Record<string, unknown> {
  if (!isRecord(metadata) || metadata.corpusId !== scenario.corpusId || metadata.corpusVersion !== scenario.corpusVersion) return false;
  if (!isNonEmptyString(metadata.providerId) || !isNonEmptyString(metadata.requestedModel)
    || !Array.isArray(metadata.returnedModels) || !metadata.returnedModels.every(isNonEmptyString)) return false;
  if (!isRecord(metadata.promptRevision) || !isNonEmptyString(metadata.promptRevision.id)
    || !isSha256Digest(metadata.promptRevision.templateDigest) || !isNonEmptyString(metadata.courseContentRevision)) return false;
  if (typeof metadata.gitSha !== "string" || !/^[0-9a-f]{40}$/.test(metadata.gitSha) || metadata.gitState !== "clean") return false;
  if (!Number.isInteger(metadata.sampleIndex) || Number(metadata.sampleIndex) < 0
    || !Number.isInteger(metadata.sampleCount) || Number(metadata.sampleCount) < 1) return false;
  return Number.isFinite(metadata.sampleDurationMs) && Number(metadata.sampleDurationMs) >= 0
    && isCallCounts(metadata.providerCalls)
    && Number.isInteger(metadata.maxCalls) && Number(metadata.maxCalls) >= 1;
}

function isTranscriptTurn(
  turn: unknown,
  index: number,
  syntheticTurn: unknown,
  executionStatus: TutorQualityExecutionStatus,
): turn is Record<string, unknown> & { readonly providerCalls: TranscriptCallCounts } {
  if (!isRecord(turn) || !isRecord(turn.input)) return false;
  if (Number(turn.index) !== index || !Number.isFinite(turn.durationMs) || Number(turn.durationMs) < 0) return false;
  if (!isDeterministicChecks(turn.deterministicChecks) || !isCallCounts(turn.providerCalls)) return false;
  const finalTutorResult = turn.finalTutorResult;
  if (finalTutorResult !== undefined && (!isRecord(finalTutorResult) || !tutorContentResultSchema.safeParse(finalTutorResult).success)) return false;
  if (turn.returnedModel !== undefined && typeof turn.returnedModel !== "string") return false;
  if (executionStatus === "completed" && finalTutorResult === undefined) return false;
  return canonicalSemanticJson(turn.input) === canonicalSemanticJson(syntheticTurn);
}

function transcriptTurnCallTotals(
  turns: unknown[],
  syntheticTurns: unknown[],
  executionStatus: TutorQualityExecutionStatus,
): TranscriptCallCounts | undefined {
  if (executionStatus === "completed" && turns.length !== syntheticTurns.length) return undefined;
  if (turns.length > syntheticTurns.length) return undefined;
  const totals = { total: 0, modelListCalls: 0, generationCalls: 0 };
  for (const [index, turn] of turns.entries()) {
    if (!isTranscriptTurn(turn, index, syntheticTurns[index], executionStatus)) return undefined;
    totals.total += Number(turn.providerCalls.total);
    totals.modelListCalls += Number(turn.providerCalls.modelListCalls);
    totals.generationCalls += Number(turn.providerCalls.generationCalls);
  }
  return totals;
}

function isTranscriptMinimum(value: unknown): value is TutorQualityTranscript {
  try {
    if (!isTranscriptEnvelope(value)) return false;
    const scenario = value.scenario as Record<string, unknown>;
    const metadata = value.metadata as Record<string, unknown>;
    const turns = value.turns as unknown[];
    const executionStatus = value.executionStatus as TutorQualityExecutionStatus;
    if (!isTranscriptScenario(scenario, executionStatus, turns.length)) return false;
    if (!isInvariantViolations(value.invariantViolations, scenario.syntheticTurns.length)) return false;
    if (!isTranscriptMetadata(metadata, scenario)) return false;
    const turnCalls = transcriptTurnCallTotals(turns, scenario.syntheticTurns, executionStatus);
    return turnCalls !== undefined
      && isCallCounts(metadata.providerCalls)
      && canonicalSemanticJson(turnCalls) === canonicalSemanticJson(metadata.providerCalls);
  } catch {
    return false;
  }
}

function transcriptMatchesScenario(transcript: TutorQualityTranscript, scenario: TutorQualityEvaluationScenario): boolean {
  const scenarioRecord = transcript.scenario;
  if (scenarioRecord.id !== scenario.id || scenarioRecord.corpusId !== scenario.corpusId || scenarioRecord.corpusVersion !== scenario.corpusVersion) return false;
  if (scenarioRecord.sketchRef !== scenario.sketchRef || scenarioRecord.sketch !== scenario.sketch) return false;
  if (canonicalSemanticJson(scenarioRecord.syntheticTurns) !== canonicalSemanticJson(scenario.turns)) return false;
  if (transcript.metadata.courseContentRevision !== (scenario.courseContent?.revision ?? "free-tutor")) return false;
  if (scenario.courseContent?.progressionState === undefined) return transcript.stateBefore === undefined;
  return transcript.stateBefore !== undefined && canonicalSemanticJson(transcript.stateBefore) === canonicalSemanticJson(scenario.courseContent.progressionState);
}

function existingMappingContent(input: Omit<ExistingTranscriptCompatibilityMapping, "identity">): Record<string, unknown> {
  return input;
}

function existingMappingIdentity(input: Omit<ExistingTranscriptCompatibilityMapping, "identity">): string {
  return canonicalSemanticDigest(existingMappingContent(input));
}

function expectedMappingCompatibilityDigest(
  transcript: TutorQualityTranscript,
  sourceScenario: TutorQualityEvaluationScenario,
  semanticCase: SemanticCase,
): string {
  return canonicalSemanticDigest({
    sourceEvaluationIdentity: transcript.evaluationIdentity,
    sourceScenario: sourceScenario,
    semanticCaseId: semanticCase.id,
    semanticCaseDigest: semanticCaseDigest(semanticCase),
    frozenPreTurnContextDigest: semanticCase.frozenPreTurnContext.digest,
  });
}

export function createExistingTranscriptCompatibilityMapping(input: {
  readonly sourceId: string;
  readonly transcript: TutorQualityTranscript;
  readonly sourceScenario: TutorQualityEvaluationScenario;
  readonly semanticCase: SemanticCase;
}): ExistingTranscriptCompatibilityMapping {
  const { sourceId, transcript, sourceScenario, semanticCase } = input;
  if (!sourceId.trim()) throw new Error("Existing-transcript mapping requires a stable source identity");
  if (sourceId.length > 512 || containsAsciiControlCharacter(sourceId)) throw new Error("Existing-transcript source identity must be bounded and contain no control characters");
  if (!isStageAScenarioObject(sourceScenario)) throw new Error("Existing Stage-A source scenario contains invalid or unsupported fields");
  if (!isTranscriptMinimum(transcript)) throw new Error("Existing Stage-2A transcript schema or identity is invalid");
  const compatibility = assessStageAScenarioCompatibility(sourceScenario, semanticCase);
  if (!compatibility.compatible) throw new Error(`Existing Stage-2A transcript is not compatible: ${compatibility.reason}`);
  if (!transcriptMatchesScenario(transcript, sourceScenario)) throw new Error("Existing Stage-2A transcript does not match its declared source scenario");
  const sourceScenarioDigest = canonicalSemanticDigest(sourceScenario);
  const mappingWithoutIdentity: Omit<ExistingTranscriptCompatibilityMapping, "identity"> = {
    kind: "existing-transcript-compatibility",
    mappingVersion: 1,
    sourceId,
    sourceEvaluationIdentity: transcript.evaluationIdentity,
    sourceScenarioId: sourceScenario.id,
    sourceScenario,
    sourceScenarioDigest,
    semanticCaseId: semanticCase.id,
    semanticCaseDigest: semanticCaseDigest(semanticCase),
    frozenPreTurnContextDigest: semanticCase.frozenPreTurnContext.digest,
    compatibilityDigest: expectedMappingCompatibilityDigest(transcript, sourceScenario, semanticCase),
    semanticCorpusId: semanticCase.corpusId,
    semanticCorpusVersion: semanticCase.corpusVersion,
  };
  return { ...mappingWithoutIdentity, identity: existingMappingIdentity(mappingWithoutIdentity) };
}

function validateAdapterProvenance(
  provenance: AdapterGeneratedProvenance,
  transcript: TutorQualityTranscript,
  semanticCase: SemanticCase,
): string | undefined {
  if (!isStageAScenarioObject(provenance.stageAScenario)) return "adapter-stage-a-scenario-schema-invalid";
  if (provenance.semanticCaseId !== semanticCase.id || provenance.semanticCaseDigest !== semanticCaseDigest(semanticCase)) return "adapter-case-identity-mismatch";
  if (provenance.frozenPreTurnContextDigest !== semanticCase.frozenPreTurnContext.digest) return "adapter-frozen-context-mismatch";
  if (provenance.scenarioId !== semanticCase.id || provenance.stageAScenario.id !== semanticCase.id) return "adapter-scenario-id-mismatch";
  if (provenance.stageAScenario.corpusId !== provenance.semanticCorpusId || provenance.stageAScenario.corpusVersion !== provenance.semanticCorpusVersion) return "adapter-corpus-source-identity-mismatch";
  if (provenance.semanticCorpusId !== semanticCase.corpusId || provenance.semanticCorpusVersion !== semanticCase.corpusVersion) return "adapter-corpus-identity-invalid";
  if (provenance.stageAScenarioDigest !== canonicalSemanticDigest(provenance.stageAScenario)) return "adapter-scenario-digest-mismatch";
  const identitySource = { ...provenance } as Record<string, unknown>;
  delete identitySource.identity;
  if (provenance.identity !== canonicalSemanticDigest(identitySource)) return "adapter-mapping-identity-mismatch";
  const compatible = assessStageAScenarioCompatibility(provenance.stageAScenario, semanticCase);
  if (!compatible.compatible) return compatible.reason;
  if (!transcriptMatchesScenario(transcript, provenance.stageAScenario)) return "transcript-does-not-match-adapter-scenario";
  return undefined;
}

function validateExistingProvenance(
  provenance: ExistingTranscriptCompatibilityMapping,
  transcript: TutorQualityTranscript,
  semanticCase: SemanticCase,
): string | undefined {
  if (!provenance.sourceId.trim() || provenance.sourceId.length > 512 || containsAsciiControlCharacter(provenance.sourceId)) return "existing-transcript-source-identity-missing-or-invalid";
  if (!isStageAScenarioObject(provenance.sourceScenario)) return "existing-transcript-source-scenario-invalid";
  if (provenance.sourceEvaluationIdentity !== transcript.evaluationIdentity) return "existing-transcript-evaluation-identity-mismatch";
  if (provenance.sourceScenarioId !== transcript.scenario.id || provenance.sourceScenario.id !== transcript.scenario.id) return "existing-transcript-source-scenario-mismatch";
  if (provenance.semanticCaseId !== semanticCase.id || provenance.semanticCaseDigest !== semanticCaseDigest(semanticCase)) return "existing-transcript-semantic-case-mismatch";
  if (provenance.semanticCorpusId !== semanticCase.corpusId || provenance.semanticCorpusVersion !== semanticCase.corpusVersion) return "existing-transcript-semantic-corpus-mismatch";
  if (provenance.frozenPreTurnContextDigest !== semanticCase.frozenPreTurnContext.digest) return "existing-transcript-context-mismatch";
  if (provenance.sourceScenarioDigest !== canonicalSemanticDigest(provenance.sourceScenario)) return "existing-transcript-source-scenario-digest-mismatch";
  const compatibility = assessStageAScenarioCompatibility(provenance.sourceScenario, semanticCase);
  if (!compatibility.compatible) return compatibility.reason;
  if (!transcriptMatchesScenario(transcript, provenance.sourceScenario)) return "existing-transcript-content-does-not-match-source-scenario";
  if (provenance.compatibilityDigest !== expectedMappingCompatibilityDigest(transcript, provenance.sourceScenario, semanticCase)) return "existing-transcript-compatibility-proof-mismatch";
  const mappingSource = { ...provenance } as Record<string, unknown>;
  delete mappingSource.identity;
  if (provenance.identity !== existingMappingIdentity(mappingSource as Omit<ExistingTranscriptCompatibilityMapping, "identity">)) return "existing-transcript-mapping-identity-mismatch";
  return undefined;
}

export function validateStage2ATranscript(
  input: unknown,
  semanticCase: SemanticCase,
  provenance?: AdapterGeneratedProvenance | ExistingTranscriptCompatibilityMapping,
): Stage2ATranscriptValidation {
  if (!isTranscriptMinimum(input)) return { valid: false, reason: "stage-a-transcript-schema-or-identity-invalid" };
  if (!provenance) return { valid: false, reason: "explicit-stage-b-transcript-mapping-required" };
  const transcript = input;
  const mappingKeys = provenance.kind === "adapter-generated"
    ? ["kind", "semanticCorpusId", "semanticCorpusVersion", "semanticCaseId", "semanticCaseDigest", "frozenPreTurnContextDigest", "scenarioId", "stageAScenario", "stageAScenarioDigest", "identity"]
    : ["kind", "mappingVersion", "sourceId", "sourceEvaluationIdentity", "sourceScenarioId", "sourceScenario", "sourceScenarioDigest", "semanticCorpusId", "semanticCorpusVersion", "semanticCaseId", "semanticCaseDigest", "frozenPreTurnContextDigest", "compatibilityDigest", "identity"];
  if (!isRecord(provenance) || !hasOnlyKeys(provenance, mappingKeys)) return { valid: false, reason: "stage-b-transcript-mapping-schema-invalid" };
  let reason: string | undefined;
  if (provenance.kind === "adapter-generated") {
    reason = validateAdapterProvenance(provenance, transcript, semanticCase);
  } else if (provenance.kind === "existing-transcript-compatibility") {
    reason = validateExistingProvenance(provenance, transcript, semanticCase);
  } else {
    reason = "unsupported-stage-b-transcript-mapping";
  }
  if (reason) return { valid: false, reason };
  try {
    return {
      valid: true,
      transcript,
      transcriptDigest: stage2bTranscriptDigest(transcript),
      compatibilityMapping: provenance,
      semanticEligibility: transcript.executionStatus === "completed" ? "eligible" : "not-evaluated",
    };
  } catch {
    return { valid: false, reason: "stage-a-transcript-cannot-be-canonicalized" };
  }
}

export { stage2bTranscriptDigest } from "./transcript-reference";
