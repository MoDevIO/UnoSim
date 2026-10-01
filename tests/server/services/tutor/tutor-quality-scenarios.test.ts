import { describe, expect, it, vi } from "vitest";
import { TutorProviderError } from "../../../../server/services/tutor/llm-provider";
import type { TutorPlan, TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";
import { BUILT_IN_TUTOR_STRATEGY } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import type { CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "a".repeat(40);
const nextRevision = "b".repeat(40);
const sketch = "int value = 3; void setup() { Serial.println(value); } void loop() {}";

function metadataOutcome(kind: "transition" | "blocked"): Awaited<ReturnType<TutorPlanningExtension["planFollowup"]>> {
  const metadata = {
    contentRevision: revision,
    learningPhase: "DEEPEN",
    activeTopicId: "variables-and-serial",
    masteredTopicIds: ["variables-and-serial"],
    strategyId: "built-in-default",
    strategySource: "built-in",
  } as const;
  return kind === "blocked"
    ? { kind, progressionBlockedReason: "content-exhausted", ...metadata, masteredTopicIds: [...metadata.masteredTopicIds] }
    : { kind, ...metadata, masteredTopicIds: [...metadata.masteredTopicIds] };
}

function planningWithFollowup(kind: "transition" | "blocked"): TutorPlanningExtension {
  return {
    planInitial: vi.fn().mockResolvedValue(null),
    planFollowup: vi.fn().mockResolvedValue(metadataOutcome(kind)),
  };
}

function tutorPlan(): TutorPlan {
  return {
    topicId: "variables-and-serial",
    topicTitle: "Variablen",
    conceptId: "variable-values",
    conceptTitle: "Variablenwerte",
    objective: "Werte erklären",
    questionId: "planned-question",
    questionKind: "application",
    indicatorId: "value-use",
    indicator: "Ordnet Wert und Verwendung zu",
    question: "Wie wird value im Serial.println-Aufruf des Sketches verwendet?",
    misconceptions: [],
    contentRevision: revision,
    strategyId: BUILT_IN_TUTOR_STRATEGY.id,
    strategySource: "built-in",
    effectiveStrategy: BUILT_IN_TUTOR_STRATEGY,
    learningPhase: "LEARN",
    activeTopicId: "variables-and-serial",
    masteredTopicIds: [],
  };
}

function topic(): CurriculumTopic {
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
    questions: [
      {
        id: "first-question",
        concept: "variable-values",
        indicator: "value-use",
        kind: "concept",
        difficulty: [1, 50],
        requires: [{ fact: "serial-call", values: ["print"] }],
        text: "Welche Rolle hat value im Sketch?",
      },
      {
        id: "second-question",
        concept: "variable-values",
        indicator: "value-use",
        kind: "application",
        difficulty: [1, 50],
        requires: [{ fact: "serial-call", values: ["print"] }],
        text: "Wie wird value bei der seriellen Ausgabe verwendet?",
      },
    ],
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

function courseContent(contentRevision = revision) {
  return {
    revision: contentRevision,
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics: [topic()],
      strategies: [],
    },
    progressionState: createTutorProgressionState(contentRevision),
  };
}

describe("Tutor Quality deterministic scenarios", () => {
  it.each([
    ["transition", "exact", "Welche Rolle spielt der Wert der Variable value im aktuellen Sketch?"],
    ["transition", "near", "Welche Rolle hat die Variable value und ihr Wert in diesem Sketch?"],
    ["blocked", "exact", "Welche Rolle spielt der Wert der Variable value im aktuellen Sketch?"],
    ["blocked", "near", "Welche Rolle hat die Variable value und ihr Wert in diesem Sketch?"],
  ] as const)("retains a repaired %s/%s duplicate question", async (kind, _similarity, candidate) => {
    const currentQuestion = "Welche Rolle spielt der Wert der Variable value im aktuellen Sketch?";
    const trace = await runTutorQualityScenario({
      id: `TQ-ADV-repeat-${kind}`,
      code: sketch,
      action: { kind: "dialog", question: currentQuestion, answer: "value hat den Wert 3 und wird ausgegeben." },
      provider: {
        kind: "result",
        result: {
          answerRating: 5,
          question: candidate,
        },
      },
      planning: planningWithFollowup(kind),
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result).toMatchObject({
      learningPhase: "DEEPEN",
      contentRevision: revision,
      activeTopicId: "variables-and-serial",
    });
    expect(trace.result?.question).not.toBe(candidate);
  });

  it("lets an application-owned TutorPlan replace provider question and metadata", async () => {
    const plan = tutorPlan();
    const planning: TutorPlanningExtension = {
      planInitial: vi.fn().mockResolvedValue(plan),
      planFollowup: vi.fn().mockResolvedValue(null),
    };
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
      planning,
    });

    expect(trace.result).toMatchObject({
      question: plan.question,
      topicId: plan.topicId,
      questionId: plan.questionId,
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
