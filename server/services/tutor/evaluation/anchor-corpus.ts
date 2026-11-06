import {
  DIDACTIC_PHASES,
  PROGRESSION_BLOCKED_REASONS,
  type DidacticPhase,
  type ProgressionBlockedReason,
} from "../curriculum/progression-state";
import {
  tutorLearnerInputSchema,
  tutorQuestionOutcomeSchema,
  tutorSupportActionSchema,
  type TutorLearnerInput,
  type TutorQuestionOutcome,
  type TutorSupportAction,
} from "@shared/tutor";
import { canonicalDigest } from "./canonical";
import { isValidRevealLiteral, normalizeRevealLiteral } from "./reveal-check";

export interface TutorQualityHistoryEntrySource {
  readonly question: string;
  readonly answer?: string;
  readonly responseStyle?: "normal" | "philosophical";
  readonly answerRating?: 1 | 2 | 3 | 4 | 5;
  readonly questionId?: string;
}

export type TutorQualityTurnSource =
  | {
    readonly kind: "initial";
    readonly difficulty?: number;
  }
  | {
    readonly kind: "dialog";
    readonly question: string;
    readonly answer: string;
    readonly continuationOf?: number;
    readonly difficulty?: number;
    readonly history?: readonly TutorQualityHistoryEntrySource[];
  }
  /** A learning-support action on the current question (R-SUP-E4); only in an `http` scenario. */
  | {
    readonly kind: "support";
    readonly action: TutorSupportAction;
    readonly difficulty?: number;
  };

/**
 * `service` (default) calls TutorService directly. `http` replays the scenario over the production Tutor
 * routes with learning support, carrying forward the returned question, Course and support sessions and
 * history like the browser (R-SUP-E1, isolated route evidence).
 */
export type TutorQualityTransport = "service" | "http";

/** The support state the final turn must return (R-SUP-E2); each listed field is compared exactly. */
export interface TutorQualitySupportExpectation {
  readonly answerAttempts?: number;
  readonly clarifications?: number;
  readonly canSkip?: boolean;
  readonly canRevealReference?: boolean;
  readonly referenceAvailable?: boolean;
  readonly referenceShown?: boolean;
  readonly outcome?: TutorQuestionOutcome;
}

export interface TutorQualityScenarioSource {
  readonly id: string;
  readonly sketch: string;
  readonly courseContent: string;
  readonly transport?: TutorQualityTransport;
  /** Where the factual reference of the expectations comes from; independent of the Tutor model. */
  readonly referenceProvenance?: string;
  readonly model?: string;
  readonly judge?: TutorQualityJudgeSource;
  readonly turns: readonly TutorQualityTurnSource[];
  readonly expected?: TutorQualityExpectation;
}

export type TutorQualityAnswerRatingBand = readonly [min: number, max: number];

export interface TutorQualityExpectation {
  readonly topicId?: string;
  readonly topicIdAbsent?: string;
  readonly learningPhase?: DidacticPhase;
  readonly phaseAfter?: DidacticPhase;
  readonly answerRating?: TutorQualityAnswerRatingBand;
  readonly progressionBlockedReason?: ProgressionBlockedReason;
  readonly stateUnchanged?: boolean;
  readonly questionNotRepeat?: "exact-or-heuristic";
  readonly mustNotReveal?: readonly string[];
  /** http only: how the application classified the final typed input. */
  readonly learnerInput?: TutorLearnerInput;
  /** http only: the support state after the final turn. */
  readonly supportAfter?: TutorQualitySupportExpectation;
  /** http only: the final turn is an authorized `reveal` that shows exactly this reference answer. */
  readonly referenceAnswer?: string;
  /** http only: the final support action is refused with this code (an early reveal or skip). */
  readonly actionRejected?: "SUPPORT_LOCKED";
}

export interface TutorQualityJudgeSource {
  readonly facts: readonly string[];
  readonly criteria: readonly {
    readonly id: string;
    readonly text: string;
  }[];
}

export interface TutorQualityCorpusSource {
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly scenarios: readonly TutorQualityScenarioSource[];
}

export interface TutorQualityCorpusReferences {
  readonly sketches: ReadonlySet<string>;
  readonly courseContentFixtures: ReadonlySet<string>;
}

export interface TutorQualityCorpus extends TutorQualityCorpusSource {
  readonly digest: string;
}

function fail(message: string): never {
  throw new Error(`Invalid Tutor Quality corpus: ${message}`);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    fail(`${label} must be an integer from 1 to 100`);
  }
  return value;
}

function hasPhilosophicalAnswerRating(entry: Record<string, unknown>): boolean {
  return entry.responseStyle === "philosophical" && entry.answerRating !== undefined;
}

function parseHistory(value: unknown, label: string): readonly TutorQualityHistoryEntrySource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${label}.history must be an array`);
  for (const [index, entry] of value.entries()) {
    const historyLabel = `${label}.history[${index}]`;
    assertObject(entry, historyLabel);
    assertNonEmptyString(entry.question, `${historyLabel}.question`);
    if (entry.answer !== undefined) assertNonEmptyString(entry.answer, `${historyLabel}.answer`);
    if (entry.responseStyle !== undefined && entry.responseStyle !== "normal" && entry.responseStyle !== "philosophical") {
      fail(`${historyLabel}.responseStyle is invalid`);
    }
    if (entry.answerRating !== undefined && ![1, 2, 3, 4, 5].includes(entry.answerRating as 1 | 2 | 3 | 4 | 5)) {
      fail(`${historyLabel}.answerRating is invalid`);
    }
    // Keep corpus history aligned with the existing TutorDialogTurn contract in
    // ssot/ssot_function_definition_LearningQuestions.md (philosophical fallback).
    if (hasPhilosophicalAnswerRating(entry)) {
      fail(`${historyLabel}.answerRating is not allowed for philosophical responses`);
    }
    if (entry.questionId !== undefined) assertNonEmptyString(entry.questionId, `${historyLabel}.questionId`);
  }
  return value as readonly TutorQualityHistoryEntrySource[];
}

function parseInitialTurn(value: Record<string, unknown>, label: string): TutorQualityTurnSource | undefined {
  if (value.kind !== "initial") return undefined;
  const difficulty = optionalInteger(value.difficulty, `${label}.difficulty`);
  return { kind: "initial", ...(difficulty === undefined ? {} : { difficulty }) };
}

function parseDialogTurn(value: Record<string, unknown>, label: string): TutorQualityTurnSource {
  if (value.kind !== "dialog") fail(`${label}.kind must be initial, dialog or support`);
  assertNonEmptyString(value.question, `${label}.question`);
  assertNonEmptyString(value.answer, `${label}.answer`);
  const continuationOf = value.continuationOf;
  if (continuationOf !== undefined && (typeof continuationOf !== "number" || !Number.isInteger(continuationOf) || continuationOf < 0)) {
    fail(`${label}.continuationOf must reference a preceding turn`);
  }
  const difficulty = optionalInteger(value.difficulty, `${label}.difficulty`);
  const history = parseHistory(value.history, label);
  return {
    kind: "dialog",
    question: value.question,
    answer: value.answer,
    ...(continuationOf === undefined ? {} : { continuationOf }),
    ...(difficulty === undefined ? {} : { difficulty }),
    ...(history === undefined ? {} : { history }),
  };
}

function parseSupportTurn(value: Record<string, unknown>, label: string): TutorQualityTurnSource | undefined {
  if (value.kind !== "support") return undefined;
  for (const key of Object.keys(value)) {
    if (!["kind", "action", "difficulty"].includes(key)) fail(`${label}.${key} is unknown`);
  }
  const action = tutorSupportActionSchema.safeParse(value.action);
  if (!action.success) fail(`${label}.action must be clarify, hint, reveal or skip`);
  const difficulty = optionalInteger(value.difficulty, `${label}.difficulty`);
  return { kind: "support", action: action.data, ...(difficulty === undefined ? {} : { difficulty }) };
}

function parseTurn(value: unknown, label: string): TutorQualityTurnSource {
  assertObject(value, label);
  return parseInitialTurn(value, label) ?? parseSupportTurn(value, label) ?? parseDialogTurn(value, label);
}

function normalizedCorpusSource(source: TutorQualityCorpusSource): TutorQualityCorpusSource {
  return {
    corpusId: source.corpusId,
    corpusVersion: source.corpusVersion,
    scenarios: source.scenarios.map((scenario) => ({
      ...scenario,
      turns: scenario.turns.map((turn) => ({ ...turn })),
    })),
  };
}

export function tutorQualityCorpusDigest(source: TutorQualityCorpusSource): string {
  return canonicalDigest(normalizedCorpusSource(source));
}

function parseAnswerRatingBand(value: unknown, label: string): TutorQualityAnswerRatingBand {
  const valid = Array.isArray(value)
    && value.length === 2
    && value.every((rating) => typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)
    && (value[0] as number) <= (value[1] as number);
  if (!valid) fail(`${label}.expected.answerRating must be [min, max] with 1 <= min <= max <= 5`);
  return [value[0] as number, value[1] as number];
}

const EXPECTED_KEYS = new Set([
  "topicId", "topicIdAbsent", "learningPhase", "phaseAfter", "answerRating", "progressionBlockedReason", "stateUnchanged",
  "questionNotRepeat", "mustNotReveal", "learnerInput", "supportAfter", "referenceAnswer", "actionRejected",
]);
const HTTP_ONLY_EXPECTED_KEYS = ["learnerInput", "supportAfter", "referenceAnswer", "actionRejected"] as const;
const SUPPORT_COUNT_KEYS = ["answerAttempts", "clarifications"] as const;
const SUPPORT_FLAG_KEYS = ["canSkip", "canRevealReference", "referenceAvailable", "referenceShown"] as const;
const MAX_REFERENCE_ANSWER_LENGTH = 300;

function optionalEnumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(`${label} is invalid`);
  return value as T;
}

function parseProgressionExpectation(
  value: Record<string, unknown>,
  label: string,
  turns: readonly TutorQualityTurnSource[],
): Pick<TutorQualityExpectation, "learningPhase" | "phaseAfter" | "answerRating"> {
  const learningPhase = optionalEnumValue(value.learningPhase, DIDACTIC_PHASES, `${label}.expected.learningPhase`);
  const phaseAfter = optionalEnumValue(value.phaseAfter, DIDACTIC_PHASES, `${label}.expected.phaseAfter`);
  const answerRating = value.answerRating === undefined ? undefined : parseAnswerRatingBand(value.answerRating, label);
  if (answerRating !== undefined && turns.at(-1)?.kind !== "dialog") {
    fail(`${label}.expected.answerRating requires the final turn to be a dialog turn`);
  }
  if (phaseAfter !== undefined) {
    if (learningPhase === undefined) fail(`${label}.expected.phaseAfter requires expected.learningPhase`);
    // Progression out of LEARN and DEEPEN always depends on ratings.
    if (learningPhase !== "EXPAND" && answerRating === undefined) {
      fail(`${label}.expected.phaseAfter after a ${learningPhase} turn requires expected.answerRating`);
    }
  }
  return {
    ...(learningPhase === undefined ? {} : { learningPhase }),
    ...(phaseAfter === undefined ? {} : { phaseAfter }),
    ...(answerRating === undefined ? {} : { answerRating }),
  };
}

const MAX_REVEAL_LITERALS = 5;

function parseMustNotReveal(
  value: unknown,
  label: string,
  turns: readonly TutorQualityTurnSource[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const field = `${label}.expected.mustNotReveal`;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REVEAL_LITERALS) {
    fail(`${field} must be a list of 1 to ${MAX_REVEAL_LITERALS} literals`);
  }
  if (!turns.some((turn) => turn.kind === "dialog" || turn.kind === "support")) fail(`${field} requires a dialog or support turn`);
  const seen = new Set<string>();
  for (const literal of value) {
    if (typeof literal !== "string" || !isValidRevealLiteral(literal)) {
      fail(`${field} literals must be specific strings (at least 3 characters with a letter)`);
    }
    const normalized = normalizeRevealLiteral(literal);
    if (seen.has(normalized)) fail(`${field} contains a duplicate literal`);
    seen.add(normalized);
  }
  return value as readonly string[];
}

function parseTopicExpectations(
  value: Record<string, unknown>,
  label: string,
): Pick<TutorQualityExpectation, "topicId" | "topicIdAbsent"> {
  if (value.topicId !== undefined) assertNonEmptyString(value.topicId, `${label}.expected.topicId`);
  if (value.topicIdAbsent !== undefined) assertNonEmptyString(value.topicIdAbsent, `${label}.expected.topicIdAbsent`);
  return {
    ...(typeof value.topicId === "string" ? { topicId: value.topicId } : {}),
    ...(typeof value.topicIdAbsent === "string" ? { topicIdAbsent: value.topicIdAbsent } : {}),
  };
}

function parseExpected(
  value: unknown,
  label: string,
  turns: readonly TutorQualityTurnSource[],
): TutorQualityExpectation | undefined {
  if (value === undefined) return undefined;
  assertObject(value, `${label}.expected`);
  for (const key of Object.keys(value)) {
    if (!EXPECTED_KEYS.has(key)) fail(`${label}.expected.${key} is unknown`);
  }
  const topicExpectations = parseTopicExpectations(value, label);
  const progressionBlockedReason = optionalEnumValue(value.progressionBlockedReason, PROGRESSION_BLOCKED_REASONS, `${label}.expected.progressionBlockedReason`);
  if (value.stateUnchanged !== undefined && typeof value.stateUnchanged !== "boolean") fail(`${label}.expected.stateUnchanged is invalid`);
  if (value.questionNotRepeat !== undefined && value.questionNotRepeat !== "exact-or-heuristic") {
    fail(`${label}.expected.questionNotRepeat is invalid`);
  }
  const mustNotReveal = parseMustNotReveal(value.mustNotReveal, label, turns);
  return {
    ...parseSupportExpectations(value, label, turns),
    ...topicExpectations,
    ...parseProgressionExpectation(value, label, turns),
    ...(progressionBlockedReason === undefined ? {} : { progressionBlockedReason }),
    ...(typeof value.stateUnchanged === "boolean" ? { stateUnchanged: value.stateUnchanged } : {}),
    ...(value.questionNotRepeat === "exact-or-heuristic" ? { questionNotRepeat: value.questionNotRepeat } : {}),
    ...(mustNotReveal === undefined ? {} : { mustNotReveal }),
  };
}

function parseSupportAfter(value: unknown, label: string): TutorQualitySupportExpectation {
  const field = `${label}.expected.supportAfter`;
  assertObject(value, field);
  const known = new Set<string>([...SUPPORT_COUNT_KEYS, ...SUPPORT_FLAG_KEYS, "outcome"]);
  if (Object.keys(value).length === 0) fail(`${field} must name at least one field`);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) fail(`${field}.${key} is unknown`);
  }
  for (const key of SUPPORT_COUNT_KEYS) {
    const count = value[key];
    if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 3)) fail(`${field}.${key} must be an integer from 0 to 3`);
  }
  for (const key of SUPPORT_FLAG_KEYS) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") fail(`${field}.${key} must be a boolean`);
  }
  if (value.outcome !== undefined && !tutorQuestionOutcomeSchema.safeParse(value.outcome).success) fail(`${field}.outcome is invalid`);
  return value as TutorQualitySupportExpectation;
}

/** The learning-support expectations (R-SUP-E4): http scenarios only, each bound to the kind of the final turn. */
function parseSupportExpectations(
  value: Record<string, unknown>,
  label: string,
  turns: readonly TutorQualityTurnSource[],
): Pick<TutorQualityExpectation, "learnerInput" | "supportAfter" | "referenceAnswer" | "actionRejected"> {
  const final = turns.at(-1);
  let learnerInput: TutorLearnerInput | undefined;
  if (value.learnerInput !== undefined) {
    const parsed = tutorLearnerInputSchema.safeParse(value.learnerInput);
    if (!parsed.success) fail(`${label}.expected.learnerInput is invalid`);
    if (final?.kind !== "dialog") fail(`${label}.expected.learnerInput requires the final turn to be a dialog turn`);
    learnerInput = parsed.data;
  }
  if (value.referenceAnswer !== undefined) {
    assertNonEmptyString(value.referenceAnswer, `${label}.expected.referenceAnswer`);
    if ([...value.referenceAnswer].length > MAX_REFERENCE_ANSWER_LENGTH) fail(`${label}.expected.referenceAnswer is too long`);
    if (final?.kind !== "support" || final.action !== "reveal") fail(`${label}.expected.referenceAnswer requires a final reveal turn`);
  }
  if (value.actionRejected !== undefined) {
    if (value.actionRejected !== "SUPPORT_LOCKED") fail(`${label}.expected.actionRejected is invalid`);
    if (final?.kind !== "support") fail(`${label}.expected.actionRejected requires a final support turn`);
  }
  const supportAfter = value.supportAfter === undefined ? undefined : parseSupportAfter(value.supportAfter, label);
  return {
    ...(learnerInput === undefined ? {} : { learnerInput }),
    ...(supportAfter === undefined ? {} : { supportAfter }),
    ...(typeof value.referenceAnswer === "string" ? { referenceAnswer: value.referenceAnswer } : {}),
    ...(value.actionRejected === "SUPPORT_LOCKED" ? { actionRejected: "SUPPORT_LOCKED" as const } : {}),
  };
}

/**
 * The transport rules (R-SUP-E1, R-SUP-E4). An http scenario starts with an initial turn and carries its own
 * history, so a dialog turn has neither `history` nor `continuationOf`: the executor answers the question the
 * application actually asked, and a different one is a binding problem. Support turns and the learning-support
 * expectations exist only there; an expected reference answer names its provenance.
 */
function checkTransport(
  transport: TutorQualityTransport,
  turns: readonly TutorQualityTurnSource[],
  expected: TutorQualityExpectation | undefined,
  referenceProvenance: string | undefined,
  label: string,
): void {
  if (transport === "service") {
    if (turns.some((turn) => turn.kind === "support")) fail(`${label}: support turns require transport http`);
    for (const key of HTTP_ONLY_EXPECTED_KEYS) {
      if (expected?.[key] !== undefined) fail(`${label}.expected.${key} requires transport http`);
    }
    return;
  }
  if (turns[0]?.kind !== "initial") fail(`${label}: an http scenario starts with an initial turn`);
  turns.forEach((turn, index) => {
    if (index > 0 && turn.kind === "initial") fail(`${label}.turns[${index}]: an http scenario has one initial turn`);
    if (turn.kind === "dialog" && (turn.history !== undefined || turn.continuationOf !== undefined)) {
      fail(`${label}.turns[${index}]: an http dialog turn carries no history or continuationOf`);
    }
  });
  if (expected?.learningPhase !== undefined || expected?.phaseAfter !== undefined) fail(`${label}: phase expectations require transport service`);
  // R-SUP-7: in the learning-support cycle a weak answer keeps the question on purpose.
  if (expected?.questionNotRepeat !== undefined) fail(`${label}.expected.questionNotRepeat requires transport service`);
  if (expected?.referenceAnswer !== undefined && referenceProvenance === undefined) fail(`${label}.referenceProvenance is required for expected.referenceAnswer`);
}

function parseJudge(value: unknown, label: string): TutorQualityJudgeSource | undefined {
  if (value === undefined) return undefined;
  assertObject(value, `${label}.judge`);
  if (!Array.isArray(value.facts) || value.facts.length === 0) {
    fail(`${label}.judge.facts must contain at least one fact`);
  }
  value.facts.forEach((fact, index) => assertNonEmptyString(fact, `${label}.judge.facts[${index}]`));
  if (!Array.isArray(value.criteria) || value.criteria.length < 1 || value.criteria.length > 6) {
    fail(`${label}.judge.criteria must contain 1 to 6 criteria`);
  }
  const ids = new Set<string>();
  const criteria = value.criteria.map((criterion, index) => {
    const criterionLabel = `${label}.judge.criteria[${index}]`;
    assertObject(criterion, criterionLabel);
    assertNonEmptyString(criterion.id, `${criterionLabel}.id`);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(criterion.id)) fail(`${criterionLabel}.id is invalid`);
    if (ids.has(criterion.id)) fail(`${label}.judge.criteria has duplicate id ${criterion.id}`);
    ids.add(criterion.id);
    assertNonEmptyString(criterion.text, `${criterionLabel}.text`);
    return { id: criterion.id, text: criterion.text };
  });
  return { facts: value.facts as string[], criteria };
}

function parseTurns(value: unknown, label: string): readonly TutorQualityTurnSource[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${label}.turns must be a non-empty array`);
  const turns = value.map((turn, turnIndex) => parseTurn(turn, `${label}.turns[${turnIndex}]`));
  turns.forEach((turn, turnIndex) => {
    if (turn.kind === "dialog" && turn.continuationOf !== undefined && turn.continuationOf >= turnIndex) {
      fail(`${label}.turns[${turnIndex}].continuationOf must reference a preceding turn`);
    }
  });
  return turns;
}

// R-TURN-3: in a Strategy case (one that declares expected.learningPhase) the planner, not the
// corpus author, must choose the answered question, so every dialog turn is bound via continuationOf.
function requireBoundStrategyTurns(
  turns: readonly TutorQualityTurnSource[],
  expected: TutorQualityExpectation | undefined,
  label: string,
): void {
  if (expected?.learningPhase === undefined) return;
  turns.forEach((turn, turnIndex) => {
    if (turn.kind === "dialog" && turn.continuationOf === undefined) {
      fail(`${label}.turns[${turnIndex}] must declare continuationOf because the case declares expected.learningPhase (R-TURN-3)`);
    }
  });
}

function parseScenario(
  rawScenario: unknown,
  index: number,
  references: TutorQualityCorpusReferences,
  ids: Set<string>,
): TutorQualityScenarioSource {
  const label = `scenarios[${index}]`;
  assertObject(rawScenario, label);
  assertNonEmptyString(rawScenario.id, `${label}.id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(rawScenario.id)) fail(`${label}.id is not stable-safe`);
  if (ids.has(rawScenario.id)) fail(`duplicate scenario id ${rawScenario.id}`);
  ids.add(rawScenario.id);
  assertNonEmptyString(rawScenario.sketch, `${label}.sketch`);
  if (!references.sketches.has(rawScenario.sketch)) fail(`${label}.sketch is not a registered fixture`);
  assertNonEmptyString(rawScenario.courseContent, `${label}.courseContent`);
  if (rawScenario.courseContent !== "free" && !references.courseContentFixtures.has(rawScenario.courseContent)) {
    fail(`${label}.courseContent is not a registered fixture`);
  }
  if (rawScenario.model !== undefined) {
    assertNonEmptyString(rawScenario.model, `${label}.model`);
    if (rawScenario.model === "auto") fail(`${label}.model must be a fixed model id`);
  }
  const transport = rawScenario.transport ?? "service";
  if (transport !== "service" && transport !== "http") fail(`${label}.transport must be service or http`);
  if (rawScenario.referenceProvenance !== undefined) assertNonEmptyString(rawScenario.referenceProvenance, `${label}.referenceProvenance`);
  const referenceProvenance = rawScenario.referenceProvenance as string | undefined;
  const turns = parseTurns(rawScenario.turns, label);
  const expected = parseExpected(rawScenario.expected, label, turns);
  checkTransport(transport, turns, expected, referenceProvenance, label);
  requireBoundStrategyTurns(turns, expected, label);
  const judge = parseJudge(rawScenario.judge, label);
  return {
    id: rawScenario.id,
    sketch: rawScenario.sketch,
    courseContent: rawScenario.courseContent,
    ...(transport === "http" ? { transport } : {}),
    ...(referenceProvenance === undefined ? {} : { referenceProvenance }),
    ...(rawScenario.model === undefined ? {} : { model: rawScenario.model }),
    ...(judge === undefined ? {} : { judge }),
    turns,
    ...(expected === undefined ? {} : { expected }),
  } satisfies TutorQualityScenarioSource;
}

export function parseTutorQualityCorpus(
  source: unknown,
  references: TutorQualityCorpusReferences,
): TutorQualityCorpus {
  assertObject(source, "corpus");
  assertNonEmptyString(source.corpusId, "corpusId");
  if (typeof source.corpusVersion !== "number" || !Number.isInteger(source.corpusVersion) || source.corpusVersion < 1) {
    fail("corpusVersion must be a positive integer");
  }
  if (!Array.isArray(source.scenarios) || source.scenarios.length === 0) fail("scenarios must be a non-empty array");

  const ids = new Set<string>();
  const scenarios = source.scenarios.map((rawScenario, index) => parseScenario(rawScenario, index, references, ids));

  const normalized = { corpusId: source.corpusId, corpusVersion: source.corpusVersion, scenarios } satisfies TutorQualityCorpusSource;
  return { ...normalized, digest: tutorQualityCorpusDigest(normalized) };
}
