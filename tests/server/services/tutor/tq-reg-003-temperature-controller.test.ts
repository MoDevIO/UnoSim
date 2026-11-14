import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import type { TutorDialogTurn } from "@shared/tutor";
import { curriculumTopicSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { hasUnanchoredReference } from "../../../../server/services/tutor/question-concreteness";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "3".repeat(40);
const sketch = fixture("TQ-REG-003-temperature-controller.ino");
// The Topic as it was when the question was observed; the sketch activates it through Serial.println alone.
const observedTopic = validateCurriculumTopic(curriculumTopicSchema.parse(parseYaml(fixture("TQ-REG-003-variables-and-serial.yaml"))));
const observedQuestion = "Welche Rolle spielt der Datentyp der betrachteten Variable im aktuellen Sketch?";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/tutor-quality/${name}`, import.meta.url)), "utf8");
}

function courseContent() {
  return {
    revision,
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [observedTopic], strategies: [] },
    progressionState: createTutorProgressionState(revision),
  };
}

const providerQuestions = [
  "Unter welcher Bedingung schaltet loop() das heaterRelay ein?",
  "Was gibt der Sketch aus, wenn temperature genau TEMP_MIN ist?",
  "Warum endet loop() vorzeitig, wenn raw den Wert 0 hat?",
  "Welcher Zweig läuft, wenn temperature größer als TEMP_MAX ist?",
  "Welche Relais sind im else-Zweig von loop() ausgeschaltet?",
];

describe("TQ-REG-003 temperature controller: no question with a silent reference", () => {
  it("activates the observed Topic, whose first question is the observed one", () => {
    expect(observedTopic.questions.map(({ text }) => text)).toContain(observedQuestion);
    expect(hasUnanchoredReference(observedQuestion, sketch)).toBe(true);
  });

  it("keeps the model's question when the catalog question does not say which variable it means", async () => {
    const content = courseContent();
    const trace = await runTutorQualityScenario({
      id: "TQ-REG-003/initial",
      code: sketch,
      action: { kind: "initial" },
      provider: { kind: "result", result: { question: providerQuestions[0] } },
      courseContent: content,
    });

    expect(trace.error).toBeUndefined();
    expect(trace.result?.question).toBe(providerQuestions[0]);
    // The rejected catalog question was not delivered, so the session records no progress for it.
    expect(trace.stateAfter).toEqual(trace.stateBefore);
  });

  it("delivers no silent reference over five turns with strong answers", async () => {
    const content = courseContent();
    const history: TutorDialogTurn[] = [];
    let question = providerQuestions[0];
    for (const [turn, next] of providerQuestions.slice(1).concat("Wie hängen TEMP_MIN und TEMP_MAX mit den drei Zweigen zusammen?").entries()) {
      const answer = `Antwort ${turn + 1}: temperature wird mit TEMP_MIN und TEMP_MAX verglichen.`;
      const trace = await runTutorQualityScenario({
        id: `TQ-REG-003/turn-${turn + 1}`,
        code: sketch,
        action: { kind: "dialog", history: [...history], question, answer },
        provider: { kind: "result", result: { answerRating: 5, feedback: "Richtig.", question: next } },
        courseContent: content,
      });

      expect(trace.error).toBeUndefined();
      const delivered = trace.result?.question ?? "";
      expect(delivered).not.toBe("");
      expect(hasUnanchoredReference(delivered, sketch), delivered).toBe(false);
      history.push({ responseStyle: "normal", question, answer, answerRating: 5 });
      question = delivered;
    }
  });
});
