import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { curriculumTopicSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import type { TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "1".repeat(40);
const pwmSketch = fixture("TQ-REG-001-pwm.ino");
const variablesTopic = validateCurriculumTopic(
  curriculumTopicSchema.parse(parseYaml(fixture("TQ-REG-001-variables-and-serial.yaml"))),
);

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/tutor-quality/${name}`, import.meta.url)), "utf8");
}

function courseContent() {
  return {
    revision,
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics: [variablesTopic],
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
    const content = courseContent();
    const repeatedQuestion = "Welchen Wert verwendet der Sketch an der betrachteten Integer-Variablen?";
    const planning: TutorPlanningExtension = {
      planInitial: vi.fn().mockResolvedValue(null),
      planFollowup: vi.fn(async ({ courseContent: workingContent }) => {
        const state = workingContent?.progressionState;
        if (state) {
          state.activeTopicId = "pwm-output";
          state.phase = "DEEPEN";
          state.masteredTopicIds.push("pwm-output");
          state.retainedPhases["pwm-output"] = "DEEPEN";
        }
        return {
          kind: "transition" as const,
          contentRevision: revision,
          learningPhase: "DEEPEN" as const,
          activeTopicId: "pwm-output",
          masteredTopicIds: ["pwm-output"],
          strategyId: "built-in-default",
          strategySource: "built-in" as const,
        };
      }),
    };
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
      planning,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result?.question).not.toContain("betrachtete Integer-Variable");
    expect(trace.result).toMatchObject({
      answerRating: 5,
      contentRevision: revision,
      learningPhase: "DEEPEN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
    });
    expect(trace.stateAfter).toMatchObject({
      revision,
      phase: "DEEPEN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
      retainedPhases: { "pwm-output": "DEEPEN" },
    });
  });
});
