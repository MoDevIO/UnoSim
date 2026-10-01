import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import {
  classifyTopic,
  type Observation,
} from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import { createTutorProgressionState, hasMetDeepeningCriteria, markTopicMastered } from "../../../../server/services/tutor/curriculum/progression-state";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import type { TutorDialogTurn } from "../../../../shared/tutor";

async function topic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

const revision = "a".repeat(40);

function singleProbeTopic(source: Awaited<ReturnType<typeof topic>>, id: string, activation = source.activation) {
  const concept = {
    ...source.concepts[0]!,
    mastery: {
      ...source.concepts[0]!.mastery,
      minimumSuccessfulProbes: 1,
      minimumDistinctQuestionKinds: 1,
      requiredIndicators: [source.questions[0]!.indicator],
    },
  };
  const questions = source.questions.slice(0, 2).map((question, index) => ({
    ...question,
    id: `${id}-question-${index + 1}`,
    concept: concept.id,
    indicator: source.questions[0]!.indicator,
  }));
  return {
    ...source,
    id,
    activation,
    concepts: [concept],
    questions,
    scaffolds: [],
    progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
  };
}

describe("mastery progression domain classification", () => {
  it("distinguishes a probeable Topic from an unresolved exhausted Topic", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const probeable = classifyTopic(value, facts, [], new Set(), 30);
    expect(probeable.status).toBe("probeable");

    const exhausted = value.questions.map((question) => ({
      questionId: question.id,
      conceptId: question.concept,
      indicatorId: question.indicator,
      kind: question.kind,
      rating: 3 as const,
    })) satisfies Observation[];
    expect(classifyTopic(value, facts, exhausted, new Set(exhausted.map(({ questionId }) => questionId)), 30).status).toBe("unresolved");
  });

  it("does not treat a Topic with an empty mastery domain as mastered or blocked", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("void setup() {} void loop() {}");
    expect(classifyTopic(value, facts, [], new Set(), 30)).toMatchObject({ status: "inapplicable" });
  });

  it("uses the configured criteria for Topic mastery and keeps evidence separate from difficulty", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const observations: Observation[] = value.questions.slice(0, 2).map((question) => ({
      questionId: question.id,
      conceptId: question.concept,
      indicatorId: question.indicator,
      kind: question.kind,
      rating: 4,
    }));
    const result = classifyTopic(value, facts, observations, new Set(), 30);
    expect(result.status).toMatch(/probeable|unresolved|mastered/);
    expect(revision).toHaveLength(40);
  });

  it("requires post-mastery transfer evidence before EXPAND", async () => {
    const value = await topic();
    const state = createTutorProgressionState(revision);
    markTopicMastered(state, value.id);
    const transfer = value.questions.find(({ kind }) => kind === "transfer") ?? value.questions[0]!;
    const observation: Observation = {
      questionId: transfer.id,
      conceptId: transfer.concept,
      indicatorId: transfer.indicator,
      kind: transfer.kind,
      rating: 4,
    };
    expect(hasMetDeepeningCriteria(value, [observation])).toBe(false);
    expect(hasMetDeepeningCriteria(value, [observation, observation])).toBe(true);
    expect(state.masteredTopicIds).toEqual([value.id]);
  });

  it("moves a mastered active Topic into DEEPEN without declaring it mastered from null", async () => {
    const source = await topic();
    const concept = {
      ...source.concepts[0]!,
      mastery: {
        ...source.concepts[0]!.mastery,
        minimumSuccessfulProbes: 1,
        minimumDistinctQuestionKinds: 1,
        requiredIndicators: [source.questions[0]!.indicator],
      },
    };
    const questions = source.questions.slice(0, 2).map((question, index) => ({
      ...question,
      id: `mastery-question-${index + 1}`,
      concept: concept.id,
      indicator: index === 0 ? source.questions[0]!.indicator : source.questions[1]!.indicator,
    }));
    const masteryTopic = {
      ...source,
      id: "mastery-topic",
      concepts: [concept],
      questions,
      scaffolds: [],
      progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
    };
    const state = createTutorProgressionState(revision);
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
            topics: [masteryTopic],
            strategies: [],
          },
        }),
      },
    });
    const first = await adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(first).toMatchObject({ learningPhase: "LEARN" });
    if (!first || "kind" in first) return;
    const second = await adapter.planFollowup({
      code: "int values[] = {1, 2};",
      history: [],
      currentQuestion: first.question,
      rating: 4,
      difficulty: 30,
    });
    expect(second).toMatchObject({ learningPhase: "LEARN", activeTopicId: "mastery-topic", masteredTopicIds: ["mastery-topic"] });
    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ learningPhase: "DEEPEN", activeTopicId: "mastery-topic", masteredTopicIds: ["mastery-topic"] });
  });

  it("latches the answered Topic before switching to the next applicable Topic", async () => {
    const source = await topic();
    const primary = singleProbeTopic(source, "primary-topic");
    const secondary = singleProbeTopic(source, "secondary-topic", {
      any: [{ fact: "array-declared", elementTypes: ["int"] }],
    });
    const state = createTutorProgressionState(revision);
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
            topics: [primary, secondary],
            strategies: [],
          },
          exampleId: "example",
          exampleTutorAnnotation: {
            schemaVersion: 1 as const,
            topics: [primary.id, secondary.id],
            primaryTopic: primary.id,
          },
        }),
      },
    });

    const first = await adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, exampleId: "example" });
    expect(first).toMatchObject({ topicId: primary.id, learningPhase: "LEARN" });
    if (!first || "kind" in first) return;

    const switched = await adapter.planFollowup({
      code: "int values[] = {1, 2};",
      history: [],
      currentQuestion: first.question,
      rating: 4,
      difficulty: 30,
      exampleId: "example",
    });
    expect(switched).toMatchObject({
      topicId: secondary.id,
      learningPhase: "LEARN",
      activeTopicId: secondary.id,
      masteredTopicIds: [primary.id],
    });

    const resumed = await adapter.planInitial({
      code: "int value = 1;",
      history: [],
      difficulty: 30,
      exampleId: "example",
    });
    expect(resumed).toMatchObject({
      topicId: primary.id,
      learningPhase: "DEEPEN",
      activeTopicId: primary.id,
      masteredTopicIds: [primary.id],
    });
  });

  it("moves from DEEPEN to EXPAND only after the configured post-mastery evidence", async () => {
    const source = await topic();
    const concept = {
      ...source.concepts[0]!,
      mastery: { ...source.concepts[0]!.mastery, minimumSuccessfulProbes: 1, minimumDistinctQuestionKinds: 1, requiredIndicators: [source.questions[0]!.indicator] },
    };
    const kinds = ["concept", "transfer", "transfer", "application"] as const;
    const questions = source.questions.slice(0, 4).map((question, index) => ({
      ...question,
      id: `phase-question-${index + 1}`,
      concept: concept.id,
      kind: kinds[index]!,
      indicator: source.questions[0]!.indicator,
    }));
    const phaseTopic = {
      ...source,
      schemaVersion: 2 as const,
      id: "phase-topic",
      concepts: [concept],
      questions,
      scaffolds: [],
      progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
      deepening: { minimumSuccessfulProbes: 2, successRatingAtLeast: 4, requiredQuestionKinds: ["transfer" as const], recentWeakAnswersAllowed: 0 },
    };
    const state = createTutorProgressionState(revision);
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [phaseTopic], strategies: [] },
        }),
      },
    });
    const first = await adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(first).toMatchObject({ learningPhase: "LEARN" });
    if (!first || "kind" in first) return;
    const completedLearnTurn = await adapter.planFollowup({ code: "int values[] = {1, 2};", history: [], currentQuestion: first.question, rating: 4, difficulty: 30 });
    expect(completedLearnTurn).toMatchObject({ learningPhase: "LEARN" });
    const deepen = await adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(deepen).toMatchObject({ learningPhase: "DEEPEN" });
    if (!deepen || "kind" in deepen) return;
    const deepenAgain = await adapter.planFollowup({ code: "int values[] = {1, 2};", history: [], currentQuestion: deepen.question, rating: 4, difficulty: 30 });
    expect(deepenAgain).toMatchObject({ learningPhase: "DEEPEN" });
    if (!deepenAgain || "kind" in deepenAgain) return;
    const completedDeepenTurn = await adapter.planFollowup({ code: "int values[] = {1, 2};", history: [], currentQuestion: deepenAgain.question, rating: 4, difficulty: 30 });
    expect(completedDeepenTurn).toMatchObject({ learningPhase: "DEEPEN", masteredTopicIds: ["phase-topic"] });
    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ learningPhase: "EXPAND", masteredTopicIds: ["phase-topic"] });
  });

  it("retains mastery across temporary fact-inapplicability and resumes the retained phase", async () => {
    const source = await topic();
    const state = createTutorProgressionState(revision);
    state.activeTopicId = source.id;
    state.phase = "DEEPEN";
    state.retainedPhases[source.id] = "DEEPEN";
    markTopicMastered(state, source.id);
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [source], strategies: [] },
        }),
      },
    });
    await expect(adapter.planInitial({ code: "void setup() {} void loop() {}", history: [], difficulty: 30 })).resolves.toBeNull();
    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ learningPhase: "DEEPEN", activeTopicId: source.id });
  });

  it("returns a controlled DEEPEN exhaustion result instead of free Tutor fallback", async () => {
    const source = await topic();
    const state = createTutorProgressionState(revision);
    state.activeTopicId = source.id;
    state.phase = "DEEPEN";
    state.retainedPhases[source.id] = "DEEPEN";
    markTopicMastered(state, source.id);
    const history: TutorDialogTurn[] = source.questions.map((question) => ({
      question: question.text ?? question.id,
      questionId: question.id,
      answer: "Antwort",
      responseStyle: "normal",
      answerRating: 4,
    }));
    const result = await new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [source], strategies: [] },
        }),
      },
    }).planInitial({ code: "int values[] = {1, 2};", history, difficulty: 30 });
    expect(result).toMatchObject({ kind: "blocked", learningPhase: "DEEPEN", activeTopicId: source.id, progressionBlockedReason: "content-exhausted" });
    expect(state.phase).toBe("DEEPEN");
  });

  it("returns a controlled EXPAND exhaustion result when no extension is available", async () => {
    const source = await topic();
    const expandTopic = { ...source, schemaVersion: 2 as const, id: "expand-topic" };
    const state = createTutorProgressionState(revision);
    state.activeTopicId = expandTopic.id;
    state.phase = "EXPAND";
    state.retainedPhases[expandTopic.id] = "EXPAND";
    markTopicMastered(state, expandTopic.id);
    const history: TutorDialogTurn[] = expandTopic.questions.map((question) => ({
      question: question.text ?? question.id,
      questionId: question.id,
      answer: "Antwort",
      responseStyle: "normal",
      answerRating: 4,
    }));
    const result = await new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: { status: "valid" as const, manifest: { schemaVersion: 2 as const, topics: [], strategies: [] }, topics: [expandTopic], strategies: [] },
        }),
      },
    }).planInitial({ code: "int values[] = {1, 2};", history, difficulty: 30 });
    expect(result).toMatchObject({ kind: "blocked", learningPhase: "EXPAND", activeTopicId: expandTopic.id, progressionBlockedReason: "content-exhausted" });
    expect(state.phase).toBe("EXPAND");
  });

  it("does not reuse progression state for another Course revision", async () => {
    const source = await topic();
    const state = createTutorProgressionState(revision);
    state.activeTopicId = source.id;
    state.phase = "DEEPEN";
    markTopicMastered(state, source.id);
    const nextRevision = "b".repeat(40);
    const result = await new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision: nextRevision,
          progressionState: state,
          tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [source], strategies: [] },
        }),
      },
    }).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(result).toMatchObject({ learningPhase: "LEARN", masteredTopicIds: [] });
  });
});
