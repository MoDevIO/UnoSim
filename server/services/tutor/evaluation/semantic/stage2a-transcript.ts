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

function isStageAScenarioObject(value: unknown): value is TutorQualityEvaluationScenario {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "corpusId", "corpusVersion", "sketchRef", "sketch", "courseContent", "turns", "expected"])) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.corpusId) || !Number.isInteger(value.corpusVersion)
    || !isNonEmptyString(value.sketchRef) || typeof value.sketch !== "string" || !Array.isArray(value.turns)) return false;
  if (value.expected !== undefined) {
    if (!isRecord(value.expected) || !hasOnlyKeys(value.expected, ["topicId", "topicIdAbsent", "learningPhase", "stateUnchanged", "questionNotRepeat"])) return false;
    if (["topicId", "topicIdAbsent"].some((key) => value.expected && (value.expected as Record<string, unknown>)[key] !== undefined && !isNonEmptyString((value.expected as Record<string, unknown>)[key]))) return false;
    if (value.expected.learningPhase !== undefined && !["LEARN", "DEEPEN", "EXPAND"].includes(String(value.expected.learningPhase))) return false;
    if (value.expected.stateUnchanged !== undefined && typeof value.expected.stateUnchanged !== "boolean") return false;
    if (value.expected.questionNotRepeat !== undefined && value.expected.questionNotRepeat !== "exact-or-heuristic") return false;
  }
  if (value.courseContent !== undefined && !isRecord(value.courseContent)) return false;
  return true;
}

function isExecutionStatus(value: unknown): value is TutorQualityExecutionStatus {
  return value === "completed" || value === "invalid" || value === "technical-failure" || value === "not-run";
}

function isCallCounts(value: unknown): value is { readonly total: number; readonly modelListCalls: number; readonly generationCalls: number } {
  return isRecord(value)
    && ["total", "modelListCalls", "generationCalls"].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0)
    && Number(value.total) === Number(value.modelListCalls) + Number(value.generationCalls);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTranscriptMinimum(value: unknown): value is TutorQualityTranscript {
  try {
  if (!isRecord(value) || value.schemaVersion !== "tutor-quality-transcript-v1" || !isSha256Digest(value.evaluationIdentity)) return false;
  if (typeof value.runId !== "string" || value.runId.length === 0 || !isExecutionStatus(value.executionStatus)) return false;
  if (!Array.isArray(value.invariantViolations) || !Array.isArray(value.turns) || !Array.isArray(value.deterministicChecks)) return false;
  if (!isRecord(value.scenario) || !isRecord(value.metadata)) return false;
  const scenario = value.scenario;
  const metadata = value.metadata;
  const syntheticTurns = scenario.syntheticTurns;
  if (!isNonEmptyString(scenario.id) || !isNonEmptyString(scenario.corpusId) || !Number.isInteger(scenario.corpusVersion) || Number(scenario.corpusVersion) < 1) return false;
  if (!isNonEmptyString(scenario.sketchRef) || typeof scenario.sketch !== "string" || !Array.isArray(syntheticTurns)) return false;
  if (metadata.corpusId !== scenario.corpusId || metadata.corpusVersion !== scenario.corpusVersion) return false;
  if (!isNonEmptyString(metadata.providerId) || !isNonEmptyString(metadata.requestedModel)
    || !Array.isArray(metadata.returnedModels) || !metadata.returnedModels.every(isNonEmptyString)
    || !isRecord(metadata.promptRevision) || !isNonEmptyString(metadata.promptRevision.id) || !isSha256Digest(metadata.promptRevision.templateDigest)
    || !isNonEmptyString(metadata.courseContentRevision) || typeof metadata.gitSha !== "string" || !/^[0-9a-f]{40}$/.test(metadata.gitSha)
    || metadata.gitState !== "clean" || !Number.isInteger(metadata.sampleIndex) || Number(metadata.sampleIndex) < 0
    || !Number.isInteger(metadata.sampleCount) || Number(metadata.sampleCount) < 1 || !Number.isFinite(metadata.sampleDurationMs)
    || Number(metadata.sampleDurationMs) < 0 || !isCallCounts(metadata.providerCalls)
    || !Number.isInteger(metadata.maxCalls) || Number(metadata.maxCalls) < 1) return false;
  if (value.executionStatus === "completed" && value.turns.length !== syntheticTurns.length) return false;
  if (value.turns.length > syntheticTurns.length) return false;
  const turnCalls = { total: 0, modelListCalls: 0, generationCalls: 0 };
  for (const [index, turn] of value.turns.entries()) {
    if (!isRecord(turn)) return false;
    const providerCalls = turn.providerCalls;
    if (Number(turn.index) !== index || !isRecord(turn.input)
      || !Number.isFinite(turn.durationMs) || Number(turn.durationMs) < 0
      || !Array.isArray(turn.deterministicChecks) || !isCallCounts(providerCalls)
      || (turn.finalTutorResult !== undefined && !isRecord(turn.finalTutorResult))
      || (turn.returnedModel !== undefined && typeof turn.returnedModel !== "string")
      || (value.executionStatus === "completed" && !isRecord(turn.finalTutorResult))
      || canonicalSemanticJson(turn.input) !== canonicalSemanticJson(syntheticTurns[index])) return false;
    turnCalls.total += Number(providerCalls.total);
    turnCalls.modelListCalls += Number(providerCalls.modelListCalls);
    turnCalls.generationCalls += Number(providerCalls.generationCalls);
  }
  return isCallCounts(metadata.providerCalls)
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
  if (sourceId.length > 512 || /[\u0000-\u001f\u007f]/u.test(sourceId)) throw new Error("Existing-transcript source identity must be bounded and contain no control characters");
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
  if (!provenance.sourceId.trim() || provenance.sourceId.length > 512 || /[\u0000-\u001f\u007f]/u.test(provenance.sourceId)) return "existing-transcript-source-identity-missing-or-invalid";
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
  const reason = provenance.kind === "adapter-generated"
    ? validateAdapterProvenance(provenance, transcript, semanticCase)
    : provenance.kind === "existing-transcript-compatibility"
      ? validateExistingProvenance(provenance, transcript, semanticCase)
      : "unsupported-stage-b-transcript-mapping";
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

export { stage2bTranscriptDigest };
