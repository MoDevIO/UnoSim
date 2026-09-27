import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { TutorContentResult, TutorDialogTurn } from "@shared/tutor";
import {
  inspectLearningQuestion,
  isSemanticallyRepeatedQuestion,
  TUTOR_PROMPT_REVISION,
  TutorService,
} from "../tutor-service";
import {
  TutorProviderError,
  type LLMProvider,
  type LLMProviderRequest,
  type ProviderQuestionResult,
} from "../llm-provider";
import { CurriculumTutorAdapter } from "../curriculum-tutor-adapter";
import type { TutorPlanningContentContext } from "../tutor-planning";
import type { TutorProgressionState } from "../curriculum/progression-state";

export type TutorQualityExecutionStatus = "completed" | "invalid" | "technical-failure" | "not-run";

export const MAX_TUTOR_QUALITY_SAMPLES = 20;
export const MAX_TUTOR_QUALITY_CALLS = 500;

export type TutorQualityTurn =
  | {
    readonly kind: "initial";
    readonly difficulty?: number;
  }
  | {
    readonly kind: "dialog";
    readonly question: string;
    readonly answer: string;
    readonly bindsToQuestion: string;
    readonly continuationOf?: number;
    readonly difficulty?: number;
    readonly history?: readonly TutorDialogTurn[];
  };

export interface TutorQualityEvaluationScenario {
  readonly id: string;
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly sketchRef: string;
  readonly sketch: string;
  readonly courseContent?: TutorPlanningContentContext;
  readonly turns: readonly TutorQualityTurn[];
  readonly expected?: {
    readonly topicId?: string;
    readonly topicIdAbsent?: string;
    readonly learningPhase?: "LEARN" | "DEEPEN" | "EXPAND";
    readonly stateUnchanged?: boolean;
    readonly questionNotRepeat?: "exact-or-heuristic";
  };
}

export interface TutorQualityGitState {
  readonly sha: string;
  readonly trackedClean: boolean;
  readonly relevantUntrackedClean: boolean;
}

export interface TutorQualityEvaluationOptions {
  readonly scenarios: readonly TutorQualityEvaluationScenario[];
  readonly provider: LLMProvider;
  readonly providerId: string;
  readonly endpointOrigin?: string;
  readonly credential?: string;
  readonly requestedModel: string;
  readonly samples: number;
  readonly maxCalls: number;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  readonly outputDir?: string;
  readonly git: TutorQualityGitState;
  readonly now?: () => Date;
  readonly runSuffix?: () => string;
  readonly artifactWriter?: (
    report: TutorQualityEvaluationReport,
    transcripts: readonly TutorQualityTranscript[],
  ) => Promise<void>;
}

export interface TutorQualityDeterministicCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly details?: string;
}

export interface TutorQualityInvariantViolation {
  readonly code: string;
  readonly source: "raw-provider" | "final-tutor" | "state" | "scenario";
  readonly turnIndex?: number;
  readonly details?: string;
}

export interface TutorQualityTechnicalError {
  readonly kind: string;
  readonly name: string;
}

export interface TutorQualityProviderRequestArtifact {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface TutorQualityTranscriptTurn {
  readonly index: number;
  readonly input: TutorQualityTurn;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly providerCalls: TutorQualityProviderCallCounts;
  readonly providerRequest?: TutorQualityProviderRequestArtifact;
  readonly rawProviderResult?: Record<string, unknown>;
  readonly finalTutorResult?: Record<string, unknown>;
  readonly returnedModel?: string;
  readonly deterministicChecks: readonly TutorQualityDeterministicCheck[];
  readonly technicalError?: TutorQualityTechnicalError;
}

export interface TutorQualityTranscript {
  readonly schemaVersion: "tutor-quality-transcript-v1";
  readonly runId: string;
  readonly evaluationIdentity: string;
  readonly metadata: TutorQualityMetadata;
  readonly scenario: {
    readonly id: string;
    readonly corpusId: string;
    readonly corpusVersion: number;
    readonly sketchRef: string;
    readonly sketch: string;
    readonly syntheticTurns: readonly TutorQualityTurn[];
  };
  readonly stateBefore?: TutorProgressionState;
  readonly stateAfter?: TutorProgressionState;
  readonly turns: readonly TutorQualityTranscriptTurn[];
  readonly deterministicChecks: readonly TutorQualityDeterministicCheck[];
  readonly executionStatus: TutorQualityExecutionStatus;
  readonly invalidReason?: string;
  readonly technicalError?: TutorQualityTechnicalError;
  readonly invariantViolations: readonly TutorQualityInvariantViolation[];
}

export interface TutorQualityMetadata {
  readonly providerId: string;
  readonly endpointOrigin?: string;
  readonly requestedModel: string;
  readonly returnedModels: readonly string[];
  readonly promptRevision: {
    readonly id: string;
    readonly templateDigest: string;
  };
  readonly courseContentRevision: string;
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly gitSha: string;
  readonly gitState: "clean";
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly sampleStartedAt: string;
  readonly sampleDurationMs: number;
  readonly providerCalls: TutorQualityProviderCallCounts;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  readonly maxCalls: number;
}

export interface TutorQualityProviderCallCounts {
  readonly total: number;
  readonly modelListCalls: number;
  readonly generationCalls: number;
}

export interface TutorQualityScenarioAggregate {
  readonly samplesRequested: number;
  readonly samplesObserved: number;
  readonly completed: number;
  readonly invalid: number;
  readonly technicalFailures: number;
  readonly notRun: number;
  readonly invariantViolationSamples: number;
  readonly budgetExhausted: number;
  readonly providerCalls: TutorQualityProviderCallCounts;
  readonly technicalErrorKinds: Readonly<Record<string, number>>;
  readonly rates: TutorQualityRates;
}

export interface TutorQualityRates {
  readonly completedOfObserved: number | null;
  readonly invalidOfObserved: number | null;
  readonly technicalFailureOfObserved: number | null;
  readonly notRunOfObserved: number | null;
  readonly invariantViolationOfObserved: number | null;
}

export interface TutorQualityEvaluationReport {
  readonly schemaVersion: "tutor-quality-report-v1";
  readonly runId: string;
  readonly evaluationIdentity: string;
  readonly runStatus: TutorQualityExecutionStatus;
  readonly reason?: string;
  readonly providerId: string;
  readonly requestedModel: string;
  readonly credentialPresent: boolean;
  readonly samplesRequested: number;
  readonly samplesObserved: number;
  readonly completed: number;
  readonly invalid: number;
  readonly technicalFailures: number;
  readonly notRun: number;
  readonly invariantViolationSamples: number;
  readonly budgetExhausted: number;
  readonly providerCalls: TutorQualityProviderCallCounts;
  readonly technicalErrorKinds: Readonly<Record<string, number>>;
  readonly byScenario: Readonly<Record<string, TutorQualityScenarioAggregate>>;
  readonly rates: TutorQualityRates;
  readonly monetaryCost: "unavailable";
}

export interface TutorQualityEvaluationResult {
  readonly report: TutorQualityEvaluationReport;
  readonly transcripts: readonly TutorQualityTranscript[];
}

interface ProviderCapture {
  readonly request: LLMProviderRequest;
  readonly response?: ProviderQuestionResult;
  readonly error?: unknown;
}

class EvaluationBudgetExceeded extends Error {
  constructor() {
    super("call-budget-exhausted");
    this.name = "EvaluationBudgetExceeded";
  }
}

class CountingProvider implements LLMProvider {
  private totalCalls = 0;
  private modelListCalls = 0;
  private generationCalls = 0;
  private readonly generations: ProviderCapture[] = [];

  constructor(
    private readonly provider: LLMProvider,
    private readonly maxCalls: number,
  ) {}

  get counts(): TutorQualityProviderCallCounts {
    return {
      total: this.totalCalls,
      modelListCalls: this.modelListCalls,
      generationCalls: this.generationCalls,
    };
  }

  get generationCaptures(): readonly ProviderCapture[] {
    return this.generations;
  }

  async listModels(credential: string): Promise<readonly string[]> {
    this.reserveCall();
    this.modelListCalls += 1;
    return this.provider.listModels(credential);
  }

  async generateLearningQuestion(request: LLMProviderRequest, credential: string): Promise<ProviderQuestionResult> {
    this.reserveCall();
    this.generationCalls += 1;
    try {
      const response = await this.provider.generateLearningQuestion(request, credential);
      this.generations.push({ request, response });
      return response;
    } catch (error) {
      this.generations.push({ request, error });
      throw error;
    }
  }

  private reserveCall(): void {
    if (this.totalCalls >= this.maxCalls) throw new EvaluationBudgetExceeded();
    this.totalCalls += 1;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function courseRevision(scenario: TutorQualityEvaluationScenario): string {
  return scenario.courseContent?.revision ?? "free-tutor";
}

function makeEvaluationIdentity(options: TutorQualityEvaluationOptions): string {
  const first = options.scenarios[0];
  return hashCanonical({
    unosimGitSha: options.git.sha,
    courseContentRevisions: [...new Set(options.scenarios.map(courseRevision))].sort(),
    corpusId: first?.corpusId,
    corpusVersion: first?.corpusVersion,
    providerId: options.providerId,
    requestedModel: options.requestedModel,
    promptRevision: {
      id: TUTOR_PROMPT_REVISION.id,
      templateDigest: TUTOR_PROMPT_REVISION.templateDigest,
    },
    parameters: {
      timeoutMs: options.timeoutMs,
      temperature: options.temperature,
      sampleCount: options.samples,
      maxCalls: options.maxCalls,
      difficulties: options.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.difficulty ?? 30)),
    },
  });
}

function makeRunId(options: TutorQualityEvaluationOptions): string {
  const now = (options.now ?? (() => new Date()))().toISOString().replaceAll(/[^0-9TZ]/g, "");
  return `tq2a-${now}-${(options.runSuffix ?? randomUUID)()}`;
}

function metadata(
  options: TutorQualityEvaluationOptions,
  scenario: TutorQualityEvaluationScenario,
  sampleIndex: number,
  returnedModels: readonly string[] = [],
  sampleStartedAt = new Date(0).toISOString(),
  sampleDurationMs = 0,
  providerCalls: TutorQualityProviderCallCounts = { total: 0, modelListCalls: 0, generationCalls: 0 },
): TutorQualityMetadata {
  return {
    providerId: options.providerId,
    ...(options.endpointOrigin ? { endpointOrigin: options.endpointOrigin } : {}),
    requestedModel: options.requestedModel,
    returnedModels,
    promptRevision: {
      id: TUTOR_PROMPT_REVISION.id,
      templateDigest: TUTOR_PROMPT_REVISION.templateDigest,
    },
    courseContentRevision: courseRevision(scenario),
    corpusId: scenario.corpusId,
    corpusVersion: scenario.corpusVersion,
    gitSha: options.git.sha,
    gitState: "clean",
    sampleIndex,
    sampleCount: options.samples,
    sampleStartedAt,
    sampleDurationMs,
    providerCalls,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    maxCalls: options.maxCalls,
  };
}

function technicalError(error: unknown): TutorQualityTechnicalError {
  if (error instanceof EvaluationBudgetExceeded) return { kind: "call-budget-exhausted", name: error.name };
  if (error instanceof TutorProviderError) return { kind: error.kind, name: error.name };
  return { kind: "provider-error", name: "ProviderError" };
}

function redact(value: string, credential: string | undefined): string {
  return credential && credential.length > 0 ? value.split(credential).join("[REDACTED]") : value;
}

function safeResult(value: unknown, credential?: string): Record<string, unknown> | undefined {
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

function requestArtifact(request: LLMProviderRequest, credential?: string): TutorQualityProviderRequestArtifact {
  return {
    model: request.model,
    systemPrompt: redact(request.systemPrompt, credential),
    userPrompt: redact(request.userPrompt, credential),
  };
}

function safeTurn(turn: TutorQualityTurn, credential?: string): TutorQualityTurn {
  if (turn.kind === "initial") return turn;
  return {
    ...turn,
    question: redact(turn.question, credential),
    answer: redact(turn.answer, credential),
    bindsToQuestion: redact(turn.bindsToQuestion, credential),
    ...(turn.history === undefined ? {} : {
      history: turn.history.map((entry) => ({
        ...entry,
        question: redact(entry.question, credential),
        answer: redact(entry.answer, credential),
        ...(entry.feedback === undefined ? {} : { feedback: redact(entry.feedback, credential) }),
      })),
    }),
  };
}

function historyFromSource(history: readonly TutorDialogTurn[] | undefined): readonly TutorDialogTurn[] {
  return history ?? [];
}

function addCheck(
  checks: TutorQualityDeterministicCheck[],
  name: string,
  passed: boolean,
  details?: string,
): void {
  checks.push({ name, passed, ...(details ? { details } : {}) });
}

function addViolation(
  violations: TutorQualityInvariantViolation[],
  code: string,
  source: TutorQualityInvariantViolation["source"],
  turnIndex: number | undefined,
  details?: string,
): void {
  violations.push({ code, source, ...(turnIndex === undefined ? {} : { turnIndex }), ...(details ? { details } : {}) });
}

function deterministicRawChecks(
  rawResult: unknown,
  turn: TutorQualityTurn,
  turnIndex: number,
  checks: TutorQualityDeterministicCheck[],
  violations: TutorQualityInvariantViolation[],
): void {
  const inspection = inspectLearningQuestion(rawResult, turn.difficulty);
  const issueCodes = new Set(inspection.violations.map(({ code }) => code));
  const schemaValid = !issueCodes.has("schema-invalid");
  addCheck(checks, "raw-provider-schema-valid", schemaValid);
  addCheck(checks, "raw-provider-one-primary-question", schemaValid && !issueCodes.has("multiple-primary-questions"));
  addCheck(checks, "raw-provider-no-complete-solution", schemaValid && !issueCodes.has("complete-solution"));
  for (const issue of inspection.violations) {
    addViolation(violations, issue.code, "raw-provider", turnIndex);
  }
  if (typeof rawResult === "object" && rawResult !== null && !Array.isArray(rawResult)) {
    const question = (rawResult as { question?: unknown }).question;
    if (typeof question === "string" && turn.kind === "dialog") {
      const previous = [turn.question, ...(turn.history ?? []).map(({ question: historyQuestion }) => historyQuestion)];
      const repeated = isSemanticallyRepeatedQuestion(question, previous);
      addCheck(checks, "raw-provider-question-not-repeated", !repeated);
      if (repeated) {
        addViolation(violations, "question-repeat", "raw-provider", turnIndex, question === turn.question ? "exact" : "stage1-heuristic");
      }
    }
  }
}

function expectedChecks(
  scenario: TutorQualityEvaluationScenario,
  result: TutorContentResult | undefined,
  turn: TutorQualityTurn,
  stateBefore: TutorProgressionState | undefined,
  stateAfter: TutorProgressionState | undefined,
  checks: TutorQualityDeterministicCheck[],
  violations: TutorQualityInvariantViolation[],
  turnIndex: number,
): void {
  const expected = scenario.expected;
  if (!expected || !result) return;
  if (expected.topicId !== undefined) {
    const passed = result.topicId === expected.topicId;
    addCheck(checks, "expected-topic", passed, expected.topicId);
    if (!passed) addViolation(violations, "topic-mismatch", "final-tutor", turnIndex, expected.topicId);
  }
  if (expected.topicIdAbsent !== undefined) {
    const passed = result.topicId !== expected.topicIdAbsent && result.activeTopicId !== expected.topicIdAbsent;
    addCheck(checks, "expected-topic-absent", passed, expected.topicIdAbsent);
    if (!passed) addViolation(violations, "forbidden-topic-activation", "final-tutor", turnIndex, expected.topicIdAbsent);
  }
  if (expected.learningPhase !== undefined) {
    const passed = result.learningPhase === expected.learningPhase || stateAfter?.phase === expected.learningPhase;
    addCheck(checks, "expected-learning-phase", passed, expected.learningPhase);
    if (!passed) addViolation(violations, "phase-mismatch", "final-tutor", turnIndex, expected.learningPhase);
  }
  if (expected.stateUnchanged && stateBefore !== undefined && stateAfter !== undefined) {
    const passed = stableJson(stateBefore) === stableJson(stateAfter);
    addCheck(checks, "expected-state-unchanged", passed);
    if (!passed) addViolation(violations, "state-changed-unexpectedly", "state", turnIndex);
  }
  if (expected.questionNotRepeat === "exact-or-heuristic" && turn.kind === "dialog") {
    const passed = !isSemanticallyRepeatedQuestion(result.question, [turn.question, ...(turn.history ?? []).map(({ question }) => question)]);
    addCheck(checks, "final-question-not-repeated", passed);
    if (!passed) addViolation(violations, "question-repeat", "final-tutor", turnIndex, "stage1-heuristic");
  }
}

function applicationMetadataChecks(
  result: TutorContentResult,
  courseContent: TutorPlanningContentContext | undefined,
  stateAfter: TutorProgressionState | undefined,
  checks: TutorQualityDeterministicCheck[],
  violations: TutorQualityInvariantViolation[],
  turnIndex: number,
): void {
  if (!courseContent) return;
  const revisionPassed = result.contentRevision === undefined || result.contentRevision === courseContent.revision;
  addCheck(checks, "content-revision-consistent", revisionPassed);
  if (!revisionPassed) addViolation(violations, "content-revision-mismatch", "final-tutor", turnIndex);
  if (!stateAfter) return;
  const phasePassed = result.learningPhase === undefined
    || stateAfter.phase === undefined
    || result.learningPhase === stateAfter.phase
    || (result.learningPhase === "LEARN" && stateAfter.phase === "DEEPEN");
  addCheck(checks, "phase-state-consistent", phasePassed);
  if (!phasePassed) addViolation(violations, "state-phase-mismatch", "state", turnIndex);
  const topicPassed = result.activeTopicId === undefined || result.activeTopicId === stateAfter.activeTopicId;
  addCheck(checks, "active-topic-state-consistent", topicPassed);
  if (!topicPassed) addViolation(violations, "state-topic-mismatch", "state", turnIndex);
}

function questionIdReuseCheck(
  result: TutorContentResult,
  turn: TutorQualityTurn,
  courseContent: TutorPlanningContentContext | undefined,
  checks: TutorQualityDeterministicCheck[],
  violations: TutorQualityInvariantViolation[],
  turnIndex: number,
): void {
  if (!courseContent?.tutor || turn.kind !== "dialog" || !result.questionId) return;
  const usedIds = new Set((turn.history ?? []).map(({ questionId }) => questionId).filter((id): id is string => id !== undefined));
  if (result.questionId === undefined) return;
  const passed = !usedIds.has(result.questionId);
  addCheck(checks, "question-id-not-reused", passed);
  if (!passed) addViolation(violations, "question-id-reused", "final-tutor", turnIndex, result.questionId);
}

function sampleTemplate(
  options: TutorQualityEvaluationOptions,
  scenario: TutorQualityEvaluationScenario,
  runId: string,
  evaluationIdentity: string,
  sampleIndex: number,
): TutorQualityTranscript {
  return {
    schemaVersion: "tutor-quality-transcript-v1",
    runId,
    evaluationIdentity,
    metadata: metadata(options, scenario, sampleIndex),
    scenario: {
      id: scenario.id,
      corpusId: scenario.corpusId,
      corpusVersion: scenario.corpusVersion,
      sketchRef: scenario.sketchRef,
      sketch: redact(scenario.sketch, options.credential),
      syntheticTurns: scenario.turns.map((turn) => safeTurn(turn, options.credential)),
    },
    ...(scenario.courseContent?.progressionState ? { stateBefore: clone(scenario.courseContent.progressionState) } : {}),
    turns: [],
    deterministicChecks: [],
    executionStatus: "completed",
    invariantViolations: [],
  };
}

async function runSample(
  options: TutorQualityEvaluationOptions,
  provider: CountingProvider,
  scenario: TutorQualityEvaluationScenario,
  runId: string,
  evaluationIdentity: string,
  sampleIndex: number,
): Promise<TutorQualityTranscript> {
  const sampleStartedAt = (options.now ?? (() => new Date()))();
  const callsBeforeSample = provider.counts;
  const content = scenario.courseContent ? clone(scenario.courseContent) : undefined;
  const stateBefore = content?.progressionState ? clone(content.progressionState) : undefined;
  const violations: TutorQualityInvariantViolation[] = [];
  const turns: TutorQualityTranscriptTurn[] = [];
  const returnedModels: string[] = [];
  const finalQuestions = new Map<number, string>();
  let executionStatus: TutorQualityExecutionStatus = "completed";
  let invalidReason: string | undefined;
  let terminalError: TutorQualityTechnicalError | undefined;
  const service = new TutorService(provider, content ? new CurriculumTutorAdapter() : undefined);

  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const turnStartedAt = (options.now ?? (() => new Date()))();
    const callsBeforeTurn = provider.counts;
    const turnChecks: TutorQualityDeterministicCheck[] = [];
    const beforeGenerationCount = provider.generationCaptures.length;
    let finalResult: TutorContentResult | undefined;
    let error: TutorQualityTechnicalError | undefined;
    try {
      if (turn.kind === "initial") {
        const response = await service.generateQuestion(scenario.sketch, options.credential, options.requestedModel, turn.difficulty ?? 30, content);
        finalResult = response.result;
      } else {
        if (turn.bindsToQuestion !== turn.question) {
          executionStatus = "invalid";
          invalidReason = "unbound-question-context";
          addViolation(violations, "unbound-question-context", "scenario", turnIndex);
          break;
        }
        if (turn.continuationOf !== undefined) {
          const precedingQuestion = finalQuestions.get(turn.continuationOf);
          if (precedingQuestion === undefined || precedingQuestion !== turn.bindsToQuestion) {
            executionStatus = "invalid";
            invalidReason = "preceding-question-mismatch";
            addViolation(violations, "preceding-question-mismatch", "scenario", turnIndex);
            break;
          }
        }
        const response = await service.generateDialogResponse(
          scenario.sketch,
          historyFromSource(turn.history),
          turn.question,
          turn.answer,
          options.credential,
          options.requestedModel,
          turn.difficulty ?? 30,
          content,
        );
        finalResult = response.result;
      }
    } catch (caught) {
      error = technicalError(caught);
      executionStatus = "technical-failure";
      terminalError = error;
    }

    const capture = provider.generationCaptures.length > beforeGenerationCount
      ? provider.generationCaptures.at(-1)
      : undefined;
    if (capture?.response) {
      const returnedModel = capture.response.model;
      if (typeof returnedModel !== "string" || returnedModel.length === 0) {
        executionStatus = "invalid";
        invalidReason = "returned-model-missing";
        addCheck(turnChecks, "returned-model-matches-request", false, "missing");
      } else if (returnedModel !== options.requestedModel) {
        executionStatus = "invalid";
        invalidReason = "returned-model-mismatch";
        addCheck(turnChecks, "returned-model-matches-request", false, returnedModel);
      } else {
        addCheck(turnChecks, "returned-model-matches-request", true);
      }
      if (typeof returnedModel === "string" && returnedModel.length > 0) returnedModels.push(returnedModel);
      deterministicRawChecks(capture.response.result, turn, turnIndex, turnChecks, violations);
    }
    if (finalResult) {
      finalQuestions.set(turnIndex, finalResult.question);
      addCheck(turnChecks, "final-tutor-response-present", true);
      expectedChecks(scenario, finalResult, turn, stateBefore, content?.progressionState, turnChecks, violations, turnIndex);
      applicationMetadataChecks(finalResult, content, content?.progressionState, turnChecks, violations, turnIndex);
      questionIdReuseCheck(finalResult, turn, content, turnChecks, violations, turnIndex);
    } else if (error) {
      addCheck(turnChecks, "final-tutor-response-present", false, error.kind);
    }
    const captureRequest = capture?.request;
    const turnFinishedAt = (options.now ?? (() => new Date()))();
    turns.push({
      index: turnIndex,
      input: safeTurn(turn, options.credential),
      startedAt: turnStartedAt.toISOString(),
      durationMs: Math.max(0, turnFinishedAt.getTime() - turnStartedAt.getTime()),
      providerCalls: subtractCounts(provider.counts, callsBeforeTurn),
      ...(captureRequest ? { providerRequest: requestArtifact(captureRequest, options.credential) } : {}),
      ...(capture?.response ? { rawProviderResult: safeResult(capture.response.result, options.credential), returnedModel: redact(capture.response.model, options.credential) } : {}),
      ...(finalResult ? { finalTutorResult: safeResult(finalResult, options.credential) } : {}),
      deterministicChecks: turnChecks,
      ...(error ? { technicalError: error } : {}),
    });
    if (error) break;
  }

  const stateAfter = content?.progressionState ? clone(content.progressionState) : undefined;
  if (terminalError && stateBefore && stateAfter) {
    const unchanged = stableJson(stateBefore) === stableJson(stateAfter);
    const stateChecks = turns.at(-1)?.deterministicChecks;
    if (stateChecks) {
      (stateChecks as TutorQualityDeterministicCheck[]).push({ name: "state-unchanged-after-failure", passed: unchanged });
    }
    if (!unchanged) addViolation(violations, "state-mutated-after-failure", "state", undefined);
  }
  const sample = sampleTemplate(options, scenario, runId, evaluationIdentity, sampleIndex);
  const sampleFinishedAt = (options.now ?? (() => new Date()))();
  const sampleCalls = subtractCounts(provider.counts, callsBeforeSample);
  return {
    ...sample,
    metadata: metadata(
      options,
      scenario,
      sampleIndex,
      returnedModels,
      sampleStartedAt.toISOString(),
      Math.max(0, sampleFinishedAt.getTime() - sampleStartedAt.getTime()),
      sampleCalls,
    ),
    ...(stateBefore ? { stateBefore } : {}),
    ...(stateAfter ? { stateAfter } : {}),
    turns,
    deterministicChecks: turns.flatMap(({ deterministicChecks }) => deterministicChecks),
    executionStatus,
    ...(invalidReason ? { invalidReason } : {}),
    ...(terminalError ? { technicalError: terminalError } : {}),
    invariantViolations: violations,
  };
}

function emptyAggregate(samples: number): TutorQualityScenarioAggregate {
  return {
    samplesRequested: samples,
    samplesObserved: 0,
    completed: 0,
    invalid: 0,
    technicalFailures: 0,
    notRun: 0,
    invariantViolationSamples: 0,
    budgetExhausted: 0,
    providerCalls: { total: 0, modelListCalls: 0, generationCalls: 0 },
    technicalErrorKinds: {},
    rates: ratesFor(0, 0, 0, 0, 0, 0),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function ratesFor(
  completed: number,
  invalid: number,
  technicalFailures: number,
  notRun: number,
  invariantViolations: number,
  observed: number,
): TutorQualityRates {
  return {
    completedOfObserved: ratio(completed, observed),
    invalidOfObserved: ratio(invalid, observed),
    technicalFailureOfObserved: ratio(technicalFailures, observed),
    notRunOfObserved: ratio(notRun, observed),
    invariantViolationOfObserved: ratio(invariantViolations, observed),
  };
}

function addCounts(left: TutorQualityProviderCallCounts, right: TutorQualityProviderCallCounts): TutorQualityProviderCallCounts {
  return {
    total: left.total + right.total,
    modelListCalls: left.modelListCalls + right.modelListCalls,
    generationCalls: left.generationCalls + right.generationCalls,
  };
}

function subtractCounts(
  current: TutorQualityProviderCallCounts,
  previous: TutorQualityProviderCallCounts,
): TutorQualityProviderCallCounts {
  return {
    total: current.total - previous.total,
    modelListCalls: current.modelListCalls - previous.modelListCalls,
    generationCalls: current.generationCalls - previous.generationCalls,
  };
}

function addTranscriptToAggregate(
  aggregate: TutorQualityScenarioAggregate,
  transcript: TutorQualityTranscript,
  calls: TutorQualityProviderCallCounts,
): TutorQualityScenarioAggregate {
  const samplesObserved = aggregate.samplesObserved + 1;
  const completed = aggregate.completed + Number(transcript.executionStatus === "completed");
  const invalid = aggregate.invalid + Number(transcript.executionStatus === "invalid");
  const technicalFailures = aggregate.technicalFailures + Number(transcript.executionStatus === "technical-failure");
  const notRun = aggregate.notRun + Number(transcript.executionStatus === "not-run");
  const invariantViolationSamples = aggregate.invariantViolationSamples + Number(transcript.invariantViolations.length > 0);
  const budgetExhausted = aggregate.budgetExhausted + Number(transcript.technicalError?.kind === "call-budget-exhausted");
  const technicalErrorKinds = transcript.technicalError
    ? { ...aggregate.technicalErrorKinds, [transcript.technicalError.kind]: (aggregate.technicalErrorKinds[transcript.technicalError.kind] ?? 0) + 1 }
    : aggregate.technicalErrorKinds;
  return {
    ...aggregate,
    samplesObserved,
    completed,
    invalid,
    technicalFailures,
    notRun,
    invariantViolationSamples,
    budgetExhausted,
    providerCalls: addCounts(aggregate.providerCalls, calls),
    technicalErrorKinds,
    rates: ratesFor(completed, invalid, technicalFailures, notRun, invariantViolationSamples, samplesObserved),
  };
}

function baseReport(
  options: TutorQualityEvaluationOptions,
  runId: string,
  evaluationIdentity: string,
  runStatus: TutorQualityExecutionStatus,
  reason: string | undefined,
  calls: TutorQualityProviderCallCounts,
  byScenario: Readonly<Record<string, TutorQualityScenarioAggregate>>,
  samplesObserved = 0,
): TutorQualityEvaluationReport {
  const aggregates = Object.values(byScenario);
  const completed = aggregates.reduce((sum, item) => sum + item.completed, 0);
  const invalid = aggregates.reduce((sum, item) => sum + item.invalid, 0);
  const technicalFailures = aggregates.reduce((sum, item) => sum + item.technicalFailures, 0);
  const notRun = aggregates.reduce((sum, item) => sum + item.notRun, 0);
  const invariantViolationSamples = aggregates.reduce((sum, item) => sum + item.invariantViolationSamples, 0);
  const budgetExhausted = aggregates.reduce((sum, item) => sum + item.budgetExhausted, 0);
  const sampleTechnicalErrorKinds = Object.fromEntries(
    aggregates.flatMap((item) => Object.entries(item.technicalErrorKinds)).reduce((entries, [kind, count]) => {
      const current = entries.get(kind) ?? 0;
      entries.set(kind, current + count);
      return entries;
    }, new Map<string, number>()),
  );
  const preflightTechnicalFailure = runStatus === "technical-failure" ? 1 : 0;
  const technicalErrorKinds = reason && preflightTechnicalFailure > 0
    ? { ...sampleTechnicalErrorKinds, [reason]: (sampleTechnicalErrorKinds[reason] ?? 0) + 1 }
    : sampleTechnicalErrorKinds;
  return {
    schemaVersion: "tutor-quality-report-v1",
    runId,
    evaluationIdentity,
    runStatus,
    ...(reason ? { reason } : {}),
    providerId: options.providerId,
    requestedModel: options.requestedModel,
    credentialPresent: Boolean(options.credential),
    samplesRequested: options.scenarios.length * options.samples,
    samplesObserved,
    completed,
    invalid,
    technicalFailures: technicalFailures + preflightTechnicalFailure,
    notRun,
    invariantViolationSamples,
    budgetExhausted,
    providerCalls: calls,
    technicalErrorKinds,
    byScenario,
    rates: ratesFor(completed, invalid, technicalFailures + preflightTechnicalFailure, notRun, invariantViolationSamples, samplesObserved),
    monetaryCost: "unavailable",
  };
}

async function writeArtifactsToDirectory(
  outputDir: string | undefined,
  report: TutorQualityEvaluationReport,
  transcripts: readonly TutorQualityTranscript[],
): Promise<void> {
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await Promise.all(transcripts.map((transcript) => {
    const safeId = transcript.scenario.id.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    const index = transcript.metadata.sampleIndex;
    return writeFile(`${outputDir}/transcript-${safeId}-${index}.json`, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  }));
}

async function writeArtifacts(
  options: TutorQualityEvaluationOptions,
  report: TutorQualityEvaluationReport,
  transcripts: readonly TutorQualityTranscript[],
): Promise<void> {
  if (options.artifactWriter) {
    await options.artifactWriter(report, transcripts);
    return;
  }
  await writeArtifactsToDirectory(options.outputDir, report, transcripts);
}

function invalidPreflightReason(options: TutorQualityEvaluationOptions): string | undefined {
  if (!options.requestedModel || options.requestedModel === "auto") return "fixed-model-required";
  if (!options.git.sha) return "git-sha-missing";
  if (!options.git.trackedClean || !options.git.relevantUntrackedClean) return "dirty-relevant-worktree";
  if (!Number.isInteger(options.samples) || options.samples < 1) return "invalid-sample-count";
  if (options.samples > MAX_TUTOR_QUALITY_SAMPLES) return "sample-count-exceeds-limit";
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 0) return "invalid-call-budget";
  if (options.maxCalls > MAX_TUTOR_QUALITY_CALLS) return "call-budget-exceeds-limit";
  if (options.scenarios.length === 0) return "empty-corpus";
  const first = options.scenarios[0];
  if (options.scenarios.some((scenario) => scenario.corpusId !== first?.corpusId || scenario.corpusVersion !== first?.corpusVersion)) {
    return "mixed-corpus-versions";
  }
  for (const scenario of options.scenarios) {
    for (const turn of scenario.turns) {
      if (turn.kind === "dialog" && turn.bindsToQuestion !== turn.question) return "unbound-question-context";
    }
  }
  return undefined;
}

export async function runTutorQualityEvaluation(options: TutorQualityEvaluationOptions): Promise<TutorQualityEvaluationResult> {
  const runId = makeRunId(options);
  const evaluationIdentity = makeEvaluationIdentity(options);
  const invalidReason = invalidPreflightReason(options);
  const emptyByScenario = Object.fromEntries(options.scenarios.map((scenario) => [scenario.id, emptyAggregate(options.samples)]));

  if (invalidReason) {
    const report = baseReport(options, runId, evaluationIdentity, "invalid", invalidReason, { total: 0, modelListCalls: 0, generationCalls: 0 }, emptyByScenario);
    await writeArtifacts(options, report, []);
    return { report, transcripts: [] };
  }
  if (!options.credential) {
    const report = baseReport(options, runId, evaluationIdentity, "not-run", "missing-credential", { total: 0, modelListCalls: 0, generationCalls: 0 }, emptyByScenario);
    await writeArtifacts(options, report, []);
    return { report, transcripts: [] };
  }
  if (options.maxCalls === 0) {
    const report = baseReport(options, runId, evaluationIdentity, "not-run", "call-budget-zero", { total: 0, modelListCalls: 0, generationCalls: 0 }, emptyByScenario);
    await writeArtifacts(options, report, []);
    return { report, transcripts: [] };
  }

  const provider = new CountingProvider(options.provider, options.maxCalls);
  let availableModels: readonly string[];
  try {
    availableModels = await provider.listModels(options.credential);
  } catch (error) {
    const report = baseReport(options, runId, evaluationIdentity, "technical-failure", technicalError(error).kind, provider.counts, emptyByScenario);
    await writeArtifacts(options, report, []);
    return { report, transcripts: [] };
  }
  if (!availableModels.includes(options.requestedModel)) {
    const report = baseReport(options, runId, evaluationIdentity, "invalid", "model-unavailable", provider.counts, emptyByScenario);
    await writeArtifacts(options, report, []);
    return { report, transcripts: [] };
  }

  const transcripts: TutorQualityTranscript[] = [];
  const byScenario: Record<string, TutorQualityScenarioAggregate> = Object.fromEntries(
    options.scenarios.map((scenario) => [scenario.id, emptyAggregate(options.samples)]),
  );
  for (const scenario of options.scenarios) {
    for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
      const callsBeforeSample = provider.counts;
      const transcript = await runSample(options, provider, scenario, runId, evaluationIdentity, sampleIndex);
      transcripts.push(transcript);
      byScenario[scenario.id] = addTranscriptToAggregate(byScenario[scenario.id]!, transcript, subtractCounts(provider.counts, callsBeforeSample));
      if (transcript.executionStatus === "invalid" && transcript.invalidReason === "returned-model-mismatch") {
        // The mismatch belongs to this sample; subsequent samples remain observable.
      }
    }
  }
  const report = baseReport(options, runId, evaluationIdentity, "completed", undefined, provider.counts, byScenario, transcripts.length);
  await writeArtifacts(options, report, transcripts);
  return { report, transcripts };
}

export { EvaluationBudgetExceeded };
