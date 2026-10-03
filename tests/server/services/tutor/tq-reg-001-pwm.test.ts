import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { curriculumTopicSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "1".repeat(40);
const pwmSketch = fixture("TQ-REG-001-pwm.ino");
const variablesTopic = validateCurriculumTopic(
  curriculumTopicSchema.parse(parseYaml(fixture("TQ-REG-001-variables-and-serial.yaml"))),
);

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/tutor-quality/${name}`, import.meta.url)), "utf8");
}

const repeatedQuestion = "Welchen Wert verwendet der Sketch an der betrachteten Integer-Variablen?";

// Minimal test Topic for the PWM sketch. The fact extractor yields only `type-used: int` for it, so
// the Topic activates on that fact. Its single question is mastered by one strong answer, so the
// real planner ends the turn in a LEARN -> DEEPEN transition (TutorQuality SSOT §5).
const pwmTopic = validateCurriculumTopic(curriculumTopicSchema.parse({
  schemaVersion: 1,
  id: "pwm-output",
  title: "PWM-Ausgabe",
  locale: "de-DE",
  activation: { any: [{ fact: "type-used", values: ["int"] }] },
  concepts: [{
    id: "pwm-duty-value",
    title: "Tastgrad-Wert",
    objective: "Den Integerwert erklären, der den PWM-Tastgrad bestimmt.",
    prerequisites: [],
    difficulty: { entry: [1, 60], transfer: [20, 80] },
    misconceptions: [],
    indicators: [{ id: "relates-value-to-duty", description: "Ordnet den Integerwert dem Tastgrad zu." }],
    mastery: {
      minimumSuccessfulProbes: 1,
      successRatingAtLeast: 3,
      requiredIndicators: ["relates-value-to-duty"],
      minimumDistinctQuestionKinds: 1,
      recentWeakAnswersAllowed: 0,
    },
  }],
  questions: [{
    id: "pwm-duty-value-question",
    concept: "pwm-duty-value",
    indicator: "relates-value-to-duty",
    kind: "concept",
    difficulty: [1, 60],
    requires: [{ fact: "type-used", values: ["int"] }],
    text: repeatedQuestion,
  }],
  scaffolds: [],
  progression: {
    entryConcepts: ["pwm-duty-value"],
    preferredOrder: ["pwm-duty-value"],
    onRating: {
      "1-2": "remediate",
      "3": "clarify-same-indicator",
      "4": "probe-missing-indicator",
      "5": "evaluate-mastery-and-advance",
    },
  },
}));

function courseContent(topics = [variablesTopic]) {
  return {
    revision,
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics,
      strategies: [],
    },
    progressionState: createTutorProgressionState(revision),
  };
}

describe("TQ-REG-001 PWM question quality regression", () => {
  it("does not activate the narrowed variables-and-serial Topic for the PWM sketch", async () => {
    const content = courseContent();
    const trace = await runTutorQualityScenario({
      id: "TQ-REG-001/activation",
      code: pwmSketch,
      action: { kind: "initial" },
      provider: { kind: "result", result: { question: "Wie verändert brightness den PWM-Ausgang an ledPin?" } },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result).not.toHaveProperty("topicId", "variables-and-serial");
    expect(trace.result).not.toHaveProperty("activeTopicId", "variables-and-serial");
    expect(trace.stateAfter).toEqual(trace.stateBefore);
  });

  it("repairs repetition after a strong answer and commits coherent transition metadata", async () => {
    const content = courseContent([variablesTopic, pwmTopic]);
    const trace = await runTutorQualityScenario({
      id: "TQ-REG-001/progression",
      code: pwmSketch,
      action: {
        kind: "dialog",
        question: repeatedQuestion,
        answer: "brightness läuft in Fünferschritten zwischen 0 und 255 und bestimmt den PWM-Tastgrad.",
      },
      provider: {
        kind: "result",
        result: {
          answerRating: 5,
          question: "Welchen Wert hat die betrachtete Integer-Variable im Sketch?",
          topicId: "variables-and-serial",
          learningPhase: "LEARN",
        },
      },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result?.question).not.toContain("betrachtete Integer-Variable");
    // R-PH-1/R-PH-2: the answer is served under LEARN; the transition is committed to state.
    expect(trace.result).toMatchObject({
      answerRating: 5,
      contentRevision: revision,
      learningPhase: "LEARN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
    });
    expect(trace.result).not.toHaveProperty("topicId", "variables-and-serial");
    expect(trace.stateAfter).toMatchObject({
      revision,
      phase: "DEEPEN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
      retainedPhases: { "pwm-output": "DEEPEN" },
    });
  });
});
