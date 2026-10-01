import { randomUUID } from "node:crypto";
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
  type ProviderStructuredResult,
  type StructuredLLMProvider,
  type StructuredLLMProviderRequest,
} from "../llm-provider";
import { CurriculumTutorAdapter } from "../curriculum-tutor-adapter";
import type { TutorPlanningContentContext } from "../tutor-planning";
import type { TutorProgressionState } from "../curriculum/progression-state";
import { canonicalDigest, canonicalJson, sha256 } from "./canonical";
import { TUTOR_TEMPERATURE } from "../kiconnect-provider";
import {
  buildJudgeInput,
  callJudge,
  parseJudgeResult,
  JudgeProviderCallError,
  type TutorQualityJudgePrompt,
  type TutorQualitySemanticEvaluation,
} from "./judge";
import { createTutorQualityRunManifest, writeRunArtifacts } from "./report";

export type TutorQualityExecutionStatus = "completed" | "invalid" | "technical-failure" | "not-run";

export const MAX_TUTOR_QUALITY_SAMPLES = 20;
export const MAX_TUTOR_QUALITY_CALLS = 500;
const EMPTY_STAGE_A_PROVIDER_CALLS: TutorQualityStageAProviderCallCounts = {
  total: 0,
  modelListCalls: 0,
  generationCalls: 0,
};
const EMPTY_PROVIDER_CALLS: TutorQualityProviderCallCounts = {
  ...EMPTY_STAGE_A_PROVIDER_CALLS,
  judgeCalls: 0,
};

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
  readonly sketchDigest?: string;
  readonly corpusFileDigest?: string;
  readonly judge?: {
    readonly facts: readonly string[];
    readonly criteria: readonly { readonly id: string; readonly text: string }[];
  };
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
  readonly judgeModel?: string;
  readonly judgeCredential?: string;
  readonly samples: number;
  readonly maxCalls: number;
  readonly timeoutMs?: number;
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
  readonly systemPromptDigest: string;
  readonly userPrompt: string;
  readonly userPromptDigest: string;
}

export interface TutorQualityTranscriptTurn {
  readonly index: number;
  readonly input: TutorQualityTurn;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly providerCalls: TutorQualityStageAProviderCallCounts;
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
  readonly providerCalls: TutorQualityStageAProviderCallCounts;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  readonly maxCalls: number;
}

export interface TutorQualityStageAProviderCallCounts {
  readonly total: number;
  readonly modelListCalls: number;
  readonly generationCalls: number;
}

export interface TutorQualityProviderCallCounts extends TutorQualityStageAProviderCallCounts {
  readonly judgeCalls: number;
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
  readonly semanticEvaluations?: readonly TutorQualitySemanticEvaluationRecord[];
}

export interface TutorQualitySemanticEvaluationRecord {
  readonly scenarioId: string;
  readonly sampleIndex: number;
  readonly learningPhase?: string;
  readonly evaluation: TutorQualitySemanticEvaluation;
}

export interface TutorQualityEvaluationResult {
  readonly report: TutorQualityEvaluationReport;
  readonly transcripts: readonly TutorQualityTranscript[];
  readonly semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[];
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

export class CountingProvider implements LLMProvider, StructuredLLMProvider {
  private totalCalls = 0;
  private modelListCalls = 0;
  private generationCalls = 0;
  private judgeCalls = 0;
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
      judgeCalls: this.judgeCalls,
    };
  }

  get stageACounts(): TutorQualityStageAProviderCallCounts {
    return {
      total: this.modelListCalls + this.generationCalls,
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

  async generateStructuredResponse(
    request: StructuredLLMProviderRequest,
    credential: string,
  ): Promise<ProviderStructuredResult> {
    const provider = this.provider as LLMProvider & Partial<StructuredLLMProvider>;
    if (!provider.generateStructuredResponse) throw new TutorProviderError("provider-unavailable");
    this.reserveCall();
    this.judgeCalls += 1;
    return provider.generateStructuredResponse(request, credential);
  }

  private reserveCall(): void {
    if (this.totalCalls >= this.maxCalls) throw new EvaluationBudgetExceeded();
    this.totalCalls += 1;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function courseRevision(scenario: TutorQualityEvaluationScenario): string {
  return scenario.courseContent?.revision ?? "free-tutor";
}

function makeEvaluationIdentity(options: TutorQualityEvaluationOptions): string {
  const first = options.scenarios[0];
  return canonicalDigest({
    unosimGitSha: options.git.sha,
    courseContentRevisions: [...new Set(options.scenarios.map(courseRevision))].sort((left, right) => left.localeCompare(right)),
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
      temperature: TUTOR_TEMPERATURE,
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
  providerCalls: TutorQualityStageAProviderCallCounts = EMPTY_STAGE_A_PROVIDER_CALLS,
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
    temperature: TUTOR_TEMPERATURE,
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
    systemPromptDigest: sha256(request.systemPrompt),
    userPrompt: redact(request.userPrompt, credential),
    userPromptDigest: sha256(request.userPrompt),
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

interface ExpectedCheckContext {
  readonly scenario: TutorQualityEvaluationScenario;
  readonly result: TutorContentResult;
  readonly turn: TutorQualityTurn;
  readonly stateBefore: TutorProgressionState | undefined;
  readonly stateAfter: TutorProgressionState | undefined;
  readonly checks: TutorQualityDeterministicCheck[];
  readonly violations: TutorQualityInvariantViolation[];
  readonly turnIndex: number;
}

function expectedTopicCheck(context: ExpectedCheckContext): void {
  const expectedTopic = context.scenario.expected?.topicId;
  if (expectedTopic === undefined) return;
  const passed = context.result.topicId === expectedTopic;
  addCheck(context.checks, "expected-topic", passed, expectedTopic);
  if (!passed) addViolation(context.violations, "topic-mismatch", "final-tutor", context.turnIndex, expectedTopic);
}

function expectedTopicAbsentCheck(context: ExpectedCheckContext): void {
  const forbiddenTopic = context.scenario.expected?.topicIdAbsent;
  if (forbiddenTopic === undefined) return;
  const passed = context.result.topicId !== forbiddenTopic && context.result.activeTopicId !== forbiddenTopic;
  addCheck(context.checks, "expected-topic-absent", passed, forbiddenTopic);
  if (!passed) addViolation(context.violations, "forbidden-topic-activation", "final-tutor", context.turnIndex, forbiddenTopic);
}

function expectedPhaseCheck(context: ExpectedCheckContext): void {
  const expectedPhase = context.scenario.expected?.learningPhase;
  if (expectedPhase === undefined) return;
  const passed = context.result.learningPhase === expectedPhase || context.stateAfter?.phase === expectedPhase;
  addCheck(context.checks, "expected-learning-phase", passed, expectedPhase);
  if (!passed) addViolation(context.violations, "phase-mismatch", "final-tutor", context.turnIndex, expectedPhase);
}

function expectedStateCheck(context: ExpectedCheckContext): void {
  if (!context.scenario.expected?.stateUnchanged || !context.stateBefore || !context.stateAfter) return;
  const passed = canonicalJson(context.stateBefore) === canonicalJson(context.stateAfter);
  addCheck(context.checks, "expected-state-unchanged", passed);
  if (!passed) addViolation(context.violations, "state-changed-unexpectedly", "state", context.turnIndex);
}

function expectedQuestionCheck(context: ExpectedCheckContext): void {
  if (context.scenario.expected?.questionNotRepeat !== "exact-or-heuristic" || context.turn.kind !== "dialog") return;
  const previousQuestions = [context.turn.question, ...(context.turn.history ?? []).map(({ question }) => question)];
  const passed = !isSemanticallyRepeatedQuestion(context.result.question, previousQuestions);
  addCheck(context.checks, "final-question-not-repeated", passed);
  if (!passed) addViolation(context.violations, "question-repeat", "final-tutor", context.turnIndex, "stage1-heuristic");
}

function expectedChecks(context: ExpectedCheckContext): void {
  if (!context.scenario.expected) return;
  expectedTopicCheck(context);
  expectedTopicAbsentCheck(context);
  expectedPhaseCheck(context);
  expectedStateCheck(context);
  expectedQuestionCheck(context);
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

interface SampleTurnContext {
  readonly options: TutorQualityEvaluationOptions;
  readonly provider: CountingProvider;
  readonly service: TutorService;
  readonly scenario: TutorQualityEvaluationScenario;
  readonly content: TutorPlanningContentContext | undefined;
  readonly stateBefore: TutorProgressionState | undefined;
  readonly finalQuestions: Map<number, string>;
  readonly violations: TutorQualityInvariantViolation[];
  readonly turn: TutorQualityTurn;
  readonly turnIndex: number;
}

interface InvokedTutorTurn {
  readonly finalResult?: TutorContentResult;
  readonly error?: TutorQualityTechnicalError;
  readonly invalidReason?: string;
}

interface ProcessedCapture {
  readonly returnedModel?: string;
  readonly invalidReason?: string;
}

interface SampleTurnOutcome {
  readonly transcriptTurn?: TutorQualityTranscriptTurn;
  readonly returnedModel?: string;
  readonly executionStatus?: Extract<TutorQualityExecutionStatus, "invalid" | "technical-failure">;
  readonly invalidReason?: string;
  readonly terminalError?: TutorQualityTechnicalError;
  readonly stop: boolean;
}

function invalidTurnContext(context: SampleTurnContext): string | undefined {
  const { turn, turnIndex, finalQuestions, violations } = context;
  if (turn.kind === "initial") return undefined;
  if (turn.bindsToQuestion !== turn.question) {
    addViolation(violations, "unbound-question-context", "scenario", turnIndex);
    return "unbound-question-context";
  }
  if (turn.continuationOf !== undefined) {
    const precedingQuestion = finalQuestions.get(turn.continuationOf);
    if (precedingQuestion === undefined || precedingQuestion !== turn.bindsToQuestion) {
      addViolation(violations, "preceding-question-mismatch", "scenario", turnIndex);
      return "preceding-question-mismatch";
    }
  }
  return undefined;
}

async function invokeTutorTurn(context: SampleTurnContext): Promise<InvokedTutorTurn> {
  const { options, service, scenario, content, turn } = context;
  const invalidReason = invalidTurnContext(context);
  if (invalidReason) return { invalidReason };
  try {
    if (turn.kind === "initial") {
      const response = await service.generateQuestion(scenario.sketch, options.credential, options.requestedModel, turn.difficulty ?? 30, content);
      return { finalResult: response.result };
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
    return { finalResult: response.result };
  } catch (error_) {
    return { error: technicalError(error_) };
  }
}

function latestCapture(provider: CountingProvider, beforeGenerationCount: number): ProviderCapture | undefined {
  return provider.generationCaptures.length > beforeGenerationCount
    ? provider.generationCaptures.at(-1)
    : undefined;
}

function processCapture(
  capture: ProviderCapture | undefined,
  context: SampleTurnContext,
  checks: TutorQualityDeterministicCheck[],
): ProcessedCapture {
  if (!capture?.response) return {};
  const returnedModel = capture.response.model;
  if (typeof returnedModel === "string" && returnedModel.length > 0) {
    if (returnedModel !== context.options.requestedModel) {
      addCheck(checks, "returned-model-matches-request", false, returnedModel);
      deterministicRawChecks(capture.response.result, context.turn, context.turnIndex, checks, context.violations);
      return { returnedModel, invalidReason: "returned-model-mismatch" };
    }
    addCheck(checks, "returned-model-matches-request", true);
    deterministicRawChecks(capture.response.result, context.turn, context.turnIndex, checks, context.violations);
    return { returnedModel };
  }
  addCheck(checks, "returned-model-matches-request", false, "missing");
  deterministicRawChecks(capture.response.result, context.turn, context.turnIndex, checks, context.violations);
  return { invalidReason: "returned-model-missing" };
}

function processFinalResult(
  context: SampleTurnContext,
  invocation: InvokedTutorTurn,
  checks: TutorQualityDeterministicCheck[],
): void {
  const { finalResult, error } = invocation;
  if (!finalResult) {
    if (error) addCheck(checks, "final-tutor-response-present", false, error.kind);
    return;
  }
  context.finalQuestions.set(context.turnIndex, finalResult.question);
  addCheck(checks, "final-tutor-response-present", true);
  expectedChecks({
    scenario: context.scenario,
    result: finalResult,
    turn: context.turn,
    stateBefore: context.stateBefore,
    stateAfter: context.content?.progressionState,
    checks,
    violations: context.violations,
    turnIndex: context.turnIndex,
  });
  applicationMetadataChecks(finalResult, context.content, context.content?.progressionState, checks, context.violations, context.turnIndex);
  questionIdReuseCheck(finalResult, context.turn, context.content, checks, context.violations, context.turnIndex);
}

function buildTranscriptTurn(
  context: SampleTurnContext,
  startedAt: Date,
  callsBefore: TutorQualityStageAProviderCallCounts,
  finishedAt: Date,
  capture: ProviderCapture | undefined,
  invocation: InvokedTutorTurn,
  checks: readonly TutorQualityDeterministicCheck[],
): TutorQualityTranscriptTurn {
  const { options, provider, turn, turnIndex } = context;
  return {
    index: turnIndex,
    input: safeTurn(turn, options.credential),
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    providerCalls: subtractStageACounts(provider.stageACounts, callsBefore),
    ...(capture?.request ? { providerRequest: requestArtifact(capture.request, options.credential) } : {}),
    ...(capture?.response ? {
      rawProviderResult: safeResult(capture.response.result, options.credential),
      ...(typeof capture.response.model === "string" ? { returnedModel: redact(capture.response.model, options.credential) } : {}),
    } : {}),
    ...(invocation.finalResult ? { finalTutorResult: safeResult(invocation.finalResult, options.credential) } : {}),
    deterministicChecks: checks,
    ...(invocation.error ? { technicalError: invocation.error } : {}),
  };
}

async function executeSampleTurn(context: SampleTurnContext): Promise<SampleTurnOutcome> {
  const startedAt = (context.options.now ?? (() => new Date()))();
  const callsBefore = context.provider.stageACounts;
  const checks: TutorQualityDeterministicCheck[] = [];
  const beforeGenerationCount = context.provider.generationCaptures.length;
  const invocation = await invokeTutorTurn(context);
  if (invocation.invalidReason) return { invalidReason: invocation.invalidReason, executionStatus: "invalid", stop: true };
  const capture = latestCapture(context.provider, beforeGenerationCount);
  const captureResult = processCapture(capture, context, checks);
  processFinalResult(context, invocation, checks);
  const finishedAt = (context.options.now ?? (() => new Date()))();
  return {
    transcriptTurn: buildTranscriptTurn(context, startedAt, callsBefore, finishedAt, capture, invocation, checks),
    returnedModel: captureResult.returnedModel,
    ...(invocation.error ? { executionStatus: "technical-failure" as const, terminalError: invocation.error } : {}),
    ...(captureResult.invalidReason ? { executionStatus: "invalid" as const, invalidReason: captureResult.invalidReason } : {}),
    stop: invocation.error !== undefined,
  };
}

interface SampleExecutionState {
  readonly violations: TutorQualityInvariantViolation[];
  readonly turns: TutorQualityTranscriptTurn[];
  readonly returnedModels: string[];
  readonly finalQuestions: Map<number, string>;
  executionStatus: TutorQualityExecutionStatus;
  invalidReason: string | undefined;
  terminalError: TutorQualityTechnicalError | undefined;
}

function applySampleTurnOutcome(state: SampleExecutionState, outcome: SampleTurnOutcome): void {
  if (outcome.executionStatus === "technical-failure") state.executionStatus = "technical-failure";
  if (outcome.executionStatus === "invalid") state.executionStatus = "invalid";
  if (outcome.invalidReason) state.invalidReason = state.invalidReason ?? outcome.invalidReason;
  if (outcome.terminalError) state.terminalError = outcome.terminalError;
  if (outcome.returnedModel) state.returnedModels.push(outcome.returnedModel);
  if (outcome.transcriptTurn) state.turns.push(outcome.transcriptTurn);
}

interface SampleTurnsContext {
  readonly options: TutorQualityEvaluationOptions;
  readonly provider: CountingProvider;
  readonly service: TutorService;
  readonly scenario: TutorQualityEvaluationScenario;
  readonly content: TutorPlanningContentContext | undefined;
  readonly stateBefore: TutorProgressionState | undefined;
  readonly execution: SampleExecutionState;
}

async function executeSampleTurns(context: SampleTurnsContext): Promise<void> {
  const { options, provider, service, scenario, content, stateBefore, execution } = context;
  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const outcome = await executeSampleTurn({
      options,
      provider,
      service,
      scenario,
      content,
      stateBefore,
      finalQuestions: execution.finalQuestions,
      violations: execution.violations,
      turn,
      turnIndex,
    });
    applySampleTurnOutcome(execution, outcome);
    if (outcome.stop) break;
  }
}

function recordFailureStateCheck(
  terminalError: TutorQualityTechnicalError | undefined,
  stateBefore: TutorProgressionState | undefined,
  stateAfter: TutorProgressionState | undefined,
  turns: TutorQualityTranscriptTurn[],
  violations: TutorQualityInvariantViolation[],
): void {
  if (!terminalError || !stateBefore || !stateAfter) return;
  const unchanged = canonicalJson(stateBefore) === canonicalJson(stateAfter);
  const stateChecks = turns.at(-1)?.deterministicChecks;
  if (stateChecks) {
    (stateChecks as TutorQualityDeterministicCheck[]).push({ name: "state-unchanged-after-failure", passed: unchanged });
  }
  if (!unchanged) addViolation(violations, "state-mutated-after-failure", "state", undefined);
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
  const callsBeforeSample = provider.stageACounts;
  const content = scenario.courseContent ? clone(scenario.courseContent) : undefined;
  const stateBefore = content?.progressionState ? clone(content.progressionState) : undefined;
  const service = new TutorService(provider, content ? new CurriculumTutorAdapter() : undefined);
  const execution: SampleExecutionState = {
    violations: [],
    turns: [],
    returnedModels: [],
    finalQuestions: new Map<number, string>(),
    executionStatus: "completed",
    invalidReason: undefined,
    terminalError: undefined,
  };
  await executeSampleTurns({ options, provider, service, scenario, content, stateBefore, execution });

  const stateAfter = content?.progressionState ? clone(content.progressionState) : undefined;
  recordFailureStateCheck(execution.terminalError, stateBefore, stateAfter, execution.turns, execution.violations);
  const sample = sampleTemplate(options, scenario, runId, evaluationIdentity, sampleIndex);
  const sampleFinishedAt = (options.now ?? (() => new Date()))();
  const sampleCalls = subtractStageACounts(provider.stageACounts, callsBeforeSample);
  return {
    ...sample,
    metadata: metadata(
      options,
      scenario,
      sampleIndex,
      execution.returnedModels,
      sampleStartedAt.toISOString(),
      Math.max(0, sampleFinishedAt.getTime() - sampleStartedAt.getTime()),
      sampleCalls,
    ),
    ...(stateBefore ? { stateBefore } : {}),
    ...(stateAfter ? { stateAfter } : {}),
    turns: execution.turns,
    deterministicChecks: execution.turns.flatMap(({ deterministicChecks }) => deterministicChecks),
    executionStatus: execution.executionStatus,
    ...(execution.invalidReason ? { invalidReason: execution.invalidReason } : {}),
    ...(execution.terminalError ? { technicalError: execution.terminalError } : {}),
    invariantViolations: execution.violations,
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
    providerCalls: { ...EMPTY_PROVIDER_CALLS },
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
    judgeCalls: left.judgeCalls + right.judgeCalls,
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
    judgeCalls: current.judgeCalls - previous.judgeCalls,
  };
}

function subtractStageACounts(
  current: TutorQualityStageAProviderCallCounts,
  previous: TutorQualityStageAProviderCallCounts,
): TutorQualityStageAProviderCallCounts {
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

interface BaseReportContext {
  readonly options: TutorQualityEvaluationOptions;
  readonly runId: string;
  readonly evaluationIdentity: string;
  readonly runStatus: TutorQualityExecutionStatus;
  readonly reason?: string;
  readonly calls: TutorQualityProviderCallCounts;
  readonly byScenario: Readonly<Record<string, TutorQualityScenarioAggregate>>;
  readonly samplesObserved?: number;
}

function baseReport(context: BaseReportContext): TutorQualityEvaluationReport {
  const { options, runId, evaluationIdentity, runStatus, reason, calls, byScenario, samplesObserved = 0 } = context;
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

async function writeArtifacts(
  options: TutorQualityEvaluationOptions,
  report: TutorQualityEvaluationReport,
  transcripts: readonly TutorQualityTranscript[],
): Promise<void> {
  if (options.artifactWriter) {
    await options.artifactWriter(report, transcripts);
    return;
  }
  const manifest = createTutorQualityRunManifest(options, transcripts, report.semanticEvaluations ?? []);
  await writeRunArtifacts(options.outputDir, report, manifest, transcripts);
}

function invalidBasicPreflightReason(options: TutorQualityEvaluationOptions): string | undefined {
  if (!options.requestedModel || options.requestedModel === "auto") return "fixed-model-required";
  if (options.judgeModel === "auto" || (options.judgeModel !== undefined && !options.judgeModel)) return "fixed-judge-model-required";
  if (!options.git.sha) return "git-sha-missing";
  if (!options.git.trackedClean || !options.git.relevantUntrackedClean) return "dirty-relevant-worktree";
  if (!Number.isInteger(options.samples) || options.samples < 1) return "invalid-sample-count";
  if (options.samples > MAX_TUTOR_QUALITY_SAMPLES) return "sample-count-exceeds-limit";
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 0) return "invalid-call-budget";
  if (options.maxCalls > MAX_TUTOR_QUALITY_CALLS) return "call-budget-exceeds-limit";
  return undefined;
}

function invalidCorpusPreflightReason(options: TutorQualityEvaluationOptions): string | undefined {
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

function invalidPreflightReason(options: TutorQualityEvaluationOptions): string | undefined {
  return invalidBasicPreflightReason(options) ?? invalidCorpusPreflightReason(options);
}

export async function runTutorQualityEvaluation(options: TutorQualityEvaluationOptions): Promise<TutorQualityEvaluationResult> {
  const runId = makeRunId(options);
  const evaluationIdentity = makeEvaluationIdentity(options);
  const emptyByScenario = Object.fromEntries(options.scenarios.map((scenario) => [scenario.id, emptyAggregate(options.samples)]));
  const earlyResult = await createEarlyResult(options, runId, evaluationIdentity, emptyByScenario);
  if (earlyResult) return earlyResult;
  if (!options.credential) throw new Error("Tutor credential preflight did not reject missing credentials");

  const provider = new CountingProvider(options.provider, options.maxCalls);
  let availableModels: readonly string[];
  try {
    availableModels = await provider.listModels(options.credential);
  } catch (error) {
    const report = baseReport({ options, runId, evaluationIdentity, runStatus: "technical-failure", reason: technicalError(error).kind, calls: provider.counts, byScenario: emptyByScenario });
    await writeArtifacts(options, report, []);
    return { report, transcripts: [], semanticEvaluations: [] };
  }
  if (!availableModels.includes(options.requestedModel)) {
    const report = baseReport({ options, runId, evaluationIdentity, runStatus: "invalid", reason: "model-unavailable", calls: provider.counts, byScenario: emptyByScenario });
    await writeArtifacts(options, report, []);
    return { report, transcripts: [], semanticEvaluations: [] };
  }

  const { transcripts, semanticEvaluations, byScenario } = await evaluateSamples(options, provider, runId, evaluationIdentity);
  const report: TutorQualityEvaluationReport = {
    ...baseReport({ options, runId, evaluationIdentity, runStatus: "completed", calls: provider.counts, byScenario, samplesObserved: transcripts.length }),
    ...(semanticEvaluations.length ? { semanticEvaluations } : {}),
  };
  await writeArtifacts(options, report, transcripts);
  return { report, transcripts, semanticEvaluations };
}

async function createEarlyResult(
  options: TutorQualityEvaluationOptions,
  runId: string,
  evaluationIdentity: string,
  byScenario: Record<string, TutorQualityScenarioAggregate>,
  status?: TutorQualityEvaluationReport["runStatus"],
  reason?: string,
  calls: TutorQualityProviderCallCounts = EMPTY_PROVIDER_CALLS,
): Promise<TutorQualityEvaluationResult | undefined> {
  const invalidReason = invalidPreflightReason(options);
  if (invalidReason) {
    status = "invalid";
    reason = invalidReason;
    calls = EMPTY_PROVIDER_CALLS;
  } else if (!options.credential) {
    status = "not-run";
    reason = "missing-credential";
    calls = EMPTY_PROVIDER_CALLS;
  } else if (options.maxCalls === 0) {
    status = "not-run";
    reason = "call-budget-zero";
    calls = EMPTY_PROVIDER_CALLS;
  }
  if (!status || !reason) return undefined;
  const report = baseReport({ options, runId, evaluationIdentity, runStatus: status, reason, calls, byScenario });
  await writeArtifacts(options, report, []);
  return { report, transcripts: [], semanticEvaluations: [] };
}

async function evaluateSamples(
  options: TutorQualityEvaluationOptions,
  provider: CountingProvider,
  runId: string,
  evaluationIdentity: string,
): Promise<{
  readonly transcripts: TutorQualityTranscript[];
  readonly semanticEvaluations: TutorQualitySemanticEvaluationRecord[];
  readonly byScenario: Record<string, TutorQualityScenarioAggregate>;
}> {
  const transcripts: TutorQualityTranscript[] = [];
  const semanticEvaluations: TutorQualitySemanticEvaluationRecord[] = [];
  const byScenario: Record<string, TutorQualityScenarioAggregate> = Object.fromEntries(
    options.scenarios.map((scenario) => [scenario.id, emptyAggregate(options.samples)]),
  );
  for (const scenario of options.scenarios) {
    for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
      const callsBeforeSample = provider.counts;
      const transcript = await runSample(options, provider, scenario, runId, evaluationIdentity, sampleIndex);
      transcripts.push(transcript);
      if (scenario.judge && options.judgeModel) {
        const evaluation = redactSemanticEvaluation(
          await evaluateSemanticSample(provider, options, scenario, transcript),
          [options.credential, options.judgeCredential],
        );
        const phase = transcript.turns.at(-1)?.finalTutorResult?.learningPhase;
        semanticEvaluations.push({
          scenarioId: scenario.id,
          sampleIndex,
          ...(typeof phase === "string" ? { learningPhase: phase } : {}),
          evaluation,
        });
      }
      const aggregate = byScenario[scenario.id];
      if (!aggregate) throw new Error(`Missing scenario aggregate for ${scenario.id}`);
      byScenario[scenario.id] = addTranscriptToAggregate(aggregate, transcript, subtractCounts(provider.counts, callsBeforeSample));
    }
  }
  return { transcripts, semanticEvaluations, byScenario };
}

function redactSemanticEvaluation(
  evaluation: TutorQualitySemanticEvaluation,
  credentials: readonly (string | undefined)[],
): TutorQualitySemanticEvaluation {
  const redactValue = (value: string): string => credentials.reduce<string>((safe, credential) => redact(safe, credential), value);
  return {
    ...evaluation,
    ...(evaluation.reason ? { reason: redactValue(evaluation.reason) } : {}),
    ...(evaluation.model ? { model: redactValue(evaluation.model) } : {}),
    ...(evaluation.criteria ? {
      criteria: evaluation.criteria.map((criterion) => ({
        ...criterion,
        reason: redactValue(criterion.reason),
        ...(criterion.quote ? { quote: redactValue(criterion.quote) } : {}),
      })),
    } : {}),
    ...(evaluation.criticalIssues ? {
      criticalIssues: evaluation.criticalIssues.map((issue) => ({
        ...issue,
        reason: redactValue(issue.reason),
        quote: redactValue(issue.quote),
      })),
    } : {}),
  };
}

async function evaluateSemanticSample(
  provider: CountingProvider,
  options: TutorQualityEvaluationOptions,
  scenario: TutorQualityEvaluationScenario,
  transcript: TutorQualityTranscript,
): Promise<TutorQualitySemanticEvaluation> {
  if (transcript.executionStatus !== "completed") return { status: "not-evaluated", reason: "tutor-turn-not-completed" };
  if (!options.judgeCredential) return { status: "judge-error", reason: "missing-credential" };
  const input = buildJudgeInput(scenario, transcript);
  if (!input) return { status: "not-evaluated", reason: "judge-evidence-unavailable" };
  const startedAt = Date.now();
  try {
    return await evaluateJudgeResponse(provider, options, input, startedAt);
  } catch (error) {
    return classifyJudgeError(error, startedAt);
  }
}

function judgePromptMetadata(prompt: TutorQualityJudgePrompt, durationMs: number) {
  return {
    durationMs,
    promptRevision: prompt.revision,
    promptDigest: prompt.digest,
    systemPromptDigest: prompt.systemDigest,
    userPromptDigest: prompt.userDigest,
  };
}

async function evaluateJudgeResponse(
  provider: CountingProvider,
  options: TutorQualityEvaluationOptions,
  input: NonNullable<ReturnType<typeof buildJudgeInput>>,
  startedAt: number,
): Promise<TutorQualitySemanticEvaluation> {
  const { result, prompt } = await callJudge(provider, options.judgeModel!, options.judgeCredential!, input);
  const metadata = judgePromptMetadata(prompt, Date.now() - startedAt);
  if (result.model !== options.judgeModel) {
    return {
      status: "judge-invalid",
      reason: result.model ? "returned-model-mismatch" : "returned-model-missing",
      model: result.model,
      ...metadata,
    };
  }
  return { ...parseJudgeResult(result.result, input), model: result.model, ...metadata };
}

function classifyJudgeError(error: unknown, startedAt: number): TutorQualitySemanticEvaluation {
  const providerError = error instanceof JudgeProviderCallError ? error.providerError : error;
  const prompt = error instanceof JudgeProviderCallError ? error.prompt : undefined;
  const metadata = prompt ? judgePromptMetadata(prompt, Date.now() - startedAt) : {};
  if (providerError instanceof EvaluationBudgetExceeded) return { status: "budget-exhausted", reason: "call-budget-exhausted" };
  if (providerError instanceof TutorProviderError && providerError.kind === "invalid-response") {
    return { status: "judge-invalid", reason: "provider-invalid-response", ...metadata };
  }
  if (providerError instanceof TutorProviderError) return { status: "judge-error", reason: providerError.kind, ...metadata };
  return { status: "judge-error", reason: "provider-error", ...metadata };
}

export { EvaluationBudgetExceeded };
