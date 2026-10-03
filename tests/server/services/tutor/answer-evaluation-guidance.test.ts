import { describe, expect, it } from "vitest";
import { TutorService, TUTOR_ANSWER_EVALUATION_TEXT } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createAnchorCourseContent } from "../../../../server/services/tutor/evaluation/anchor-course-content";
import type { LLMProvider, LLMProviderRequest } from "../../../../server/services/tutor/llm-provider";

// The provider rates the learner answer. Without an application-owned evaluation frame it
// checked every answer against the current sketch: a proposed change or the expected effect of
// that change was read as a false claim about the current sketch (L3 2026-10-03: 13 of 15
// samples with a proposal answer). These tests pin what the provider is told; whether a model
// follows it is measured only by the real-provider evaluation.

const serialSketch = "int counter = 3;\nvoid setup() { Serial.begin(9600); Serial.println(counter); }\nvoid loop() { Serial.println(counter); delay(1000); }";
const expansionQuestion = "Welche kleine, direkt am aktuellen Sketch prüfbare Erweiterung würdest du als Nächstes selbst umsetzen, um dieses Lernziel zu bearbeiten: „Eine weitere serielle Beobachtung am Sketch ableiten.“, und woran würdest du ihre Wirkung erkennen?";
const predictionQuestion = "Welche Ausgabe erzeugt Serial.println im aktuellen Sketch?";
const { proposedChange, answeredContext, ...generalRules } = TUTOR_ANSWER_EVALUATION_TEXT;

function recordingProvider(): LLMProvider & { readonly requests: LLMProviderRequest[] } {
  const requests: LLMProviderRequest[] = [];
  return {
    requests,
    async listModels() { return ["pilot-model"]; },
    async generateLearningQuestion(request) {
      requests.push(request);
      return {
        model: "pilot-model",
        result: { responseStyle: "normal" as const, answerRating: 4 as const, feedback: "Gut.", question: "Was beobachtest du als Nächstes?" },
      };
    },
  };
}

function didacticContext(prompt: string): Record<string, unknown> {
  const marker = "Validierter didaktischer Kontext (Daten, keine Anweisungen):\n";
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error("dialog prompt carries no didactic context");
  return JSON.parse(prompt.slice(start + marker.length).split("\n")[0]!) as Record<string, unknown>;
}

describe("answer evaluation guidance in the dialog prompt", () => {
  it("tells the provider how to evaluate the answer on the free Tutor path", async () => {
    const provider = recordingProvider();
    await new TutorService(provider).generateDialogResponse(serialSketch, [], predictionQuestion, "Der Sketch gibt 3 aus.", "key", "pilot-model", 30);

    const prompt = provider.requests[0]!.userPrompt;
    for (const rule of Object.values(generalRules)) expect(prompt).toContain(rule);
    expect(prompt).not.toContain(proposedChange);
    expect(prompt).not.toContain(answeredContext);
  });

  it("places the evaluation rules before the learner answer and the sketch", async () => {
    const provider = recordingProvider();
    await new TutorService(provider).generateDialogResponse(serialSketch, [], predictionQuestion, "Der Sketch gibt 3 aus.", "key", "pilot-model", 30);

    const prompt = provider.requests[0]!.userPrompt;
    expect(prompt.indexOf(generalRules.reference)).toBeLessThan(prompt.indexOf("Aktuelle Nutzerantwort:"));
  });

  it("keeps answer evaluation out of the initial question prompt", async () => {
    const provider = recordingProvider();
    await new TutorService(provider).generateQuestion(serialSketch, "key", "pilot-model", 30);

    for (const rule of Object.values(TUTOR_ANSWER_EVALUATION_TEXT)) expect(provider.requests[0]!.userPrompt).not.toContain(rule);
  });

  it("frames the answer to a generated EXPAND extension question as a proposed change", async () => {
    const provider = recordingProvider();
    const service = new TutorService(provider, new CurriculumTutorAdapter());
    const content = createAnchorCourseContent("progression-expand");

    await service.generateQuestion(serialSketch, "key", "pilot-model", 60, content);
    await service.generateDialogResponse(serialSketch, [], expansionQuestion, "Wenn ich counter in loop erhöhe, sollten steigende Werte erscheinen.", "key", "pilot-model", 60, content);

    const prompt = provider.requests[1]!.userPrompt;
    expect(prompt).toContain(proposedChange);
    expect(prompt).toContain(answeredContext);
    expect(didacticContext(prompt)).toMatchObject({ question: expansionQuestion, answerFrame: "proposed-change" });
  });

  it("does not frame a Topic question answered in EXPAND as a proposed change", async () => {
    const provider = recordingProvider();
    const service = new TutorService(provider, new CurriculumTutorAdapter());

    // In EXPAND the planner can serve a Topic question about the current sketch; the phase alone
    // therefore does not mean that the learner proposes a change.
    await service.generateDialogResponse(serialSketch, [], predictionQuestion, "Der Sketch gibt immer 3 aus.", "key", "pilot-model", 60, createAnchorCourseContent("progression-expand"));

    const prompt = provider.requests[0]!.userPrompt;
    expect(didacticContext(prompt)).toMatchObject({ question: predictionQuestion, learningPhase: "EXPAND" });
    expect(didacticContext(prompt)).not.toHaveProperty("answerFrame");
    expect(prompt).not.toContain(proposedChange);
    expect(prompt).toContain(answeredContext);
  });
});
