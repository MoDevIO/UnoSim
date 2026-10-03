import { describe, expect, it } from "vitest";
import { TutorProviderError } from "../../../../server/services/tutor/llm-provider";
import { BUILT_IN_TUTOR_STRATEGY } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import type { CurriculumQuestion, CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "a".repeat(40);
const nextRevision = "b".repeat(40);
const sketch = "int value = 3; void setup() { Serial.println(value); } void loop() {}";

const FIRST_QUESTION: CurriculumQuestion = {
  id: "first-question",
  concept: "variable-values",
  indicator: "value-use",
  kind: "concept",
  difficulty: [1, 50],
  requires: [{ fact: "serial-call", values: ["print"] }],
  text: "Welche Rolle hat value im Sketch?",
};

const SECOND_QUESTION: CurriculumQuestion = {
  id: "second-question",
  concept: "variable-values",
  indicator: "value-use",
  kind: "application",
  difficulty: [1, 50],
  requires: [{ fact: "serial-call", values: ["print"] }],
  text: "Wie wird value bei der seriellen Ausgabe verwendet?",
};

function topic(questions: readonly CurriculumQuestion[] = [FIRST_QUESTION, SECOND_QUESTION]): CurriculumTopic {
  return {
    schemaVersion: 1,
    id: "variables-and-serial",
    title: "Variablen",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "variable-values",
      title: "Variablenwerte",
      objective: "Werte erklären",
      prerequisites: [],
      difficulty: { entry: [1, 50], transfer: [20, 80] },
      misconceptions: [],
      indicators: [{ id: "value-use", description: "Wert und Verwendung" }],
      mastery: {
        minimumSuccessfulProbes: 1,
        successRatingAtLeast: 3,
        requiredIndicators: ["value-use"],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    }],
    questions: questions.map((question) => ({ ...question })),
    scaffolds: [],
    progression: {
      entryConcepts: ["variable-values"],
      preferredOrder: ["variable-values"],
      onRating: {
        "1-2": "remediate",
        "3": "clarify-same-indicator",
        "4": "probe-missing-indicator",
        "5": "evaluate-mastery-and-advance",
      },
    },
  };
}

function courseContent(contentRevision = revision, questions?: readonly CurriculumQuestion[]) {
  return {
    revision: contentRevision,
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics: [topic(questions)],
      strategies: [],
    },
    progressionState: createTutorProgressionState(contentRevision),
  };
}

// The Topic is mastered through FIRST_QUESTION; SECOND_QUESTION is its only post-mastery question.
function deepenContent() {
  const content = courseContent();
  content.progressionState = {
    ...createTutorProgressionState(revision),
    activeTopicId: "variables-and-serial",
    phase: "DEEPEN",
    masteredTopicIds: ["variables-and-serial"],
    masteryEvidence: {
      "variables-and-serial": [{ questionId: FIRST_QUESTION.id, conceptId: "variable-values", indicatorId: "value-use", kind: "concept", rating: 5 }],
    },
    retainedPhases: { "variables-and-serial": "DEEPEN" },
  };
  return content;
}

describe("Tutor Quality deterministic scenarios", () => {
  // §3 items 5 and 6 with real planning outcomes (§5): a strong answer that completes LEARN mastery
  // ends in a transition (the Topic has no further LEARN question), and a DEEPEN answer with no
  // further post-mastery question ends blocked. Neither outcome carries a question, so the repaired
  // provider question must survive.
  it.each([
    ["transition", "exact", FIRST_QUESTION.text!],
    ["transition", "near", "Welche Rolle spielt value in diesem Sketch?"],
    ["blocked", "exact", SECOND_QUESTION.text!],
    ["blocked", "near", "Wie wird value in der seriellen Ausgabe verwendet?"],
  ] as const)("retains a repaired %s/%s duplicate question", async (kind, _similarity, candidate) => {
    const content = kind === "transition" ? courseContent(revision, [FIRST_QUESTION]) : deepenContent();
    const currentQuestion = kind === "transition" ? FIRST_QUESTION.text! : SECOND_QUESTION.text!;
    const trace = await runTutorQualityScenario({
      id: `TQ-ADV-repeat-${kind}`,
      code: sketch,
      action: { kind: "dialog", question: currentQuestion, answer: "value hat den Wert 3 und wird ausgegeben." },
      provider: { kind: "result", result: { answerRating: 5, question: candidate } },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result?.question).not.toBe(candidate);
    expect(trace.result?.question).not.toBe(currentQuestion);
    expect(trace.result).not.toHaveProperty("questionId");
    expect(trace.result).toMatchObject({
      contentRevision: revision,
      activeTopicId: "variables-and-serial",
      masteredTopicIds: ["variables-and-serial"],
      ...(kind === "transition"
        ? { learningPhase: "LEARN" }
        : { learningPhase: "DEEPEN", progressionBlockedReason: "content-exhausted" }),
    });
    expect(trace.stateAfter).toMatchObject({ activeTopicId: "variables-and-serial", phase: "DEEPEN" });
  });

  it("lets an application-owned TutorPlan replace provider question and metadata", async () => {
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-plan-authority",
      code: sketch,
      action: { kind: "initial" },
      provider: {
        kind: "result",
        result: {
          question: "Providerfrage?",
          topicId: "forged-topic",
          questionId: "forged-question",
          learningPhase: "EXPAND",
        },
      },
      courseContent: courseContent(revision, [FIRST_QUESTION]),
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result).toMatchObject({
      question: FIRST_QUESTION.text,
      topicId: "variables-and-serial",
      questionId: FIRST_QUESTION.id,
      learningPhase: "LEARN",
    });
  });

  it("drops provider-owned planning metadata when there is no TutorPlan", async () => {
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-untrusted-metadata",
      code: sketch,
      action: { kind: "initial" },
      provider: {
        kind: "result",
        result: {
          question: "Welche Rolle hat value im Sketch?",
          topicId: "forged-topic",
          conceptId: "forged-concept",
          questionId: "forged-question",
          learningPhase: "EXPAND",
          contentRevision: "f".repeat(40),
          strategyId: "forged-strategy",
          strategySource: "repository",
        },
      },
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result).toMatchObject({
      strategyId: BUILT_IN_TUTOR_STRATEGY.id,
      strategySource: "built-in",
    });
    expect(trace.result).not.toHaveProperty("topicId");
    expect(trace.result).not.toHaveProperty("conceptId");
    expect(trace.result).not.toHaveProperty("questionId");
    expect(trace.result).not.toHaveProperty("learningPhase");
    expect(trace.result).not.toHaveProperty("contentRevision");
  });

  it.each([
    ["invalid output", { feedback: "Keine Frage vorhanden." }],
    ["complete solution", { question: "```cpp\nvoid setup() {}\nvoid loop() {}\n```" }],
    ["multiple primary questions", { question: "Was tut setup()? Was tut loop()?" }],
  ])("rejects %s before committing progression state", async (_label, result) => {
    const content = courseContent();
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-invalid-provider-output",
      code: sketch,
      action: { kind: "initial" },
      provider: { kind: "result", result },
      courseContent: content,
    });

    expect(trace.error).toBeInstanceOf(TutorProviderError);
    expect(trace.stateAfter).toEqual(trace.stateBefore);
  });

  it("does not commit state when the provider fails", async () => {
    const content = courseContent();
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-provider-error",
      code: sketch,
      action: { kind: "initial" },
      provider: { kind: "error", error: new TutorProviderError("provider-unavailable") },
      courseContent: content,
    });

    expect(trace.error).toMatchObject({ kind: "provider-unavailable" });
    expect(trace.stateAfter).toEqual(trace.stateBefore);
  });

  it("does not reuse a forbidden Question ID in strict progression", async () => {
    const content = courseContent();
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-question-id-deduplication",
      code: sketch,
      action: {
        kind: "dialog",
        history: [{
          question: "Welche Rolle hat value im Sketch?",
          questionId: "first-question",
          answer: "value wird ausgegeben.",
          answerRating: 4,
          responseStyle: "normal",
        }],
        question: "Welche Rolle hat value im Sketch?",
        answer: "value wird ausgegeben.",
      },
      provider: { kind: "result", result: { answerRating: 4, question: "Welche Rolle hat value im Sketch?" } },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result?.questionId).toBe("second-question");
    expect(trace.result?.questionId).not.toBe("first-question");
  });

  it("commits a reset when Course Content revision changes", async () => {
    const content = courseContent(nextRevision);
    content.progressionState = {
      ...createTutorProgressionState(revision),
      activeTopicId: "old-topic",
      phase: "EXPAND",
      masteredTopicIds: ["old-topic"],
      retainedPhases: { "old-topic": "EXPAND" },
    };
    const trace = await runTutorQualityScenario({
      id: "TQ-ADV-revision-boundary",
      code: sketch,
      action: { kind: "initial" },
      provider: { kind: "result", result: { question: "Welche Rolle hat value im Sketch?" } },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.stateAfter).toMatchObject({
      revision: nextRevision,
      activeTopicId: "variables-and-serial",
      phase: "LEARN",
      masteredTopicIds: [],
    });
    expect(trace.stateAfter?.retainedPhases).toEqual({});
  });
});
