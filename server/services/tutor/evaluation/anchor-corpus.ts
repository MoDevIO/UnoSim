import { createHash } from "node:crypto";

export type TutorQualityCourseContentRef = "free" | string;

export interface TutorQualityHistoryEntrySource {
  readonly question: string;
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
    readonly bindsToQuestion: string;
    readonly difficulty?: number;
    readonly history?: readonly TutorQualityHistoryEntrySource[];
  };

export interface TutorQualityScenarioSource {
  readonly id: string;
  readonly sketch: string;
  readonly courseContent: TutorQualityCourseContentRef;
  readonly model?: string;
  readonly turns: readonly TutorQualityTurnSource[];
  readonly expected?: {
    readonly topicId?: string;
    readonly topicIdAbsent?: string;
    readonly learningPhase?: "LEARN" | "DEEPEN" | "EXPAND";
    readonly stateUnchanged?: boolean;
    readonly questionNotRepeat?: "exact-or-heuristic";
  };
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

export interface CorpusEvolutionComparison {
  readonly valid: boolean;
  readonly reason?: "version-not-increased" | "version-changed-without-semantic-change";
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

function assertDifficulty(value: unknown, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100)) {
    fail(`${label} must be an integer from 1 to 100`);
  }
}

function parseTurn(value: unknown, label: string): TutorQualityTurnSource {
  assertObject(value, label);
  if (value.kind === "initial") {
    assertDifficulty(value.difficulty, `${label}.difficulty`);
    return { kind: "initial", ...(value.difficulty === undefined ? {} : { difficulty: value.difficulty as number }) };
  }
  if (value.kind !== "dialog") fail(`${label}.kind must be initial or dialog`);
  assertNonEmptyString(value.question, `${label}.question`);
  assertNonEmptyString(value.answer, `${label}.answer`);
  assertNonEmptyString(value.bindsToQuestion, `${label}.bindsToQuestion`);
  if (value.question !== value.bindsToQuestion) fail(`${label} bindsToQuestion must equal question`);
  assertDifficulty(value.difficulty, `${label}.difficulty`);
  if (value.history !== undefined) {
    if (!Array.isArray(value.history)) fail(`${label}.history must be an array`);
    for (const [index, entry] of value.history.entries()) {
      const historyLabel = `${label}.history[${index}]`;
      assertObject(entry, historyLabel);
      assertNonEmptyString(entry.question, `${historyLabel}.question`);
      if (entry.responseStyle !== undefined && entry.responseStyle !== "normal" && entry.responseStyle !== "philosophical") {
        fail(`${historyLabel}.responseStyle is invalid`);
      }
      if (entry.answerRating !== undefined && ![1, 2, 3, 4, 5].includes(entry.answerRating as 1 | 2 | 3 | 4 | 5)) {
        fail(`${historyLabel}.answerRating is invalid`);
      }
      if (entry.questionId !== undefined) assertNonEmptyString(entry.questionId, `${historyLabel}.questionId`);
    }
  }
  return {
    kind: "dialog",
    question: value.question,
    answer: value.answer,
    bindsToQuestion: value.bindsToQuestion,
    ...(value.difficulty === undefined ? {} : { difficulty: value.difficulty as number }),
    ...(value.history === undefined ? {} : { history: value.history as readonly TutorQualityHistoryEntrySource[] }),
  };
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function tutorQualityCorpusDigest(source: TutorQualityCorpusSource): string {
  return createHash("sha256").update(stableJson(normalizedCorpusSource(source))).digest("hex");
}

export function parseTutorQualityCorpus(
  source: TutorQualityCorpusSource,
  references: TutorQualityCorpusReferences,
): TutorQualityCorpus {
  assertObject(source, "corpus");
  assertNonEmptyString(source.corpusId, "corpusId");
  if (!Number.isInteger(source.corpusVersion) || source.corpusVersion < 1) fail("corpusVersion must be a positive integer");
  if (!Array.isArray(source.scenarios) || source.scenarios.length === 0) fail("scenarios must be a non-empty array");

  const ids = new Set<string>();
  const scenarios = source.scenarios.map((rawScenario, index) => {
    const label = `scenarios[${index}]`;
    assertObject(rawScenario, label);
    assertNonEmptyString(rawScenario.id, `${label}.id`);
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
    if (!Array.isArray(rawScenario.turns) || rawScenario.turns.length === 0) fail(`${label}.turns must be a non-empty array`);
    const turns = rawScenario.turns.map((turn, turnIndex) => parseTurn(turn, `${label}.turns[${turnIndex}]`));
    if (rawScenario.expected !== undefined) {
      assertObject(rawScenario.expected, `${label}.expected`);
      if (rawScenario.expected.learningPhase !== undefined && !["LEARN", "DEEPEN", "EXPAND"].includes(rawScenario.expected.learningPhase as string)) {
        fail(`${label}.expected.learningPhase is invalid`);
      }
      if (rawScenario.expected.questionNotRepeat !== undefined && rawScenario.expected.questionNotRepeat !== "exact-or-heuristic") {
        fail(`${label}.expected.questionNotRepeat is invalid`);
      }
    }
    return {
      id: rawScenario.id,
      sketch: rawScenario.sketch,
      courseContent: rawScenario.courseContent,
      ...(rawScenario.model === undefined ? {} : { model: rawScenario.model }),
      turns,
      ...(rawScenario.expected === undefined ? {} : { expected: rawScenario.expected as TutorQualityScenarioSource["expected"] }),
    } satisfies TutorQualityScenarioSource;
  });

  const normalized = { corpusId: source.corpusId, corpusVersion: source.corpusVersion, scenarios } satisfies TutorQualityCorpusSource;
  return { ...normalized, digest: tutorQualityCorpusDigest(normalized) };
}

export function compareTutorQualityCorpusVersions(
  previous: TutorQualityCorpus,
  current: TutorQualityCorpus,
): CorpusEvolutionComparison {
  const changed = previous.digest !== current.digest;
  if (!changed && previous.corpusVersion !== current.corpusVersion) {
    return { valid: false, reason: "version-changed-without-semantic-change" };
  }
  if (changed && current.corpusVersion <= previous.corpusVersion) {
    return { valid: false, reason: "version-not-increased" };
  }
  return { valid: true };
}
