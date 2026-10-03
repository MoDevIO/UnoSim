import { describe, expect, it } from "vitest";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createAnchorCourseContent } from "../../../../server/services/tutor/evaluation/anchor-course-content";
import type { LLMProvider, LLMProviderRequest } from "../../../../server/services/tutor/llm-provider";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";

// The provider evaluates the answer to the question it is shown, so the didactic context in the
// dialog prompt must describe that answered question, not a question planned afterwards.

const serialSketch = "int counter = 3;\nvoid setup() { Serial.begin(9600); Serial.println(counter); }\nvoid loop() { Serial.println(counter); delay(1000); }";
const expansionQuestion = "Welche kleine, direkt am aktuellen Sketch prüfbare Erweiterung würdest du als Nächstes selbst umsetzen, um dieses Lernziel zu bearbeiten: „Eine weitere serielle Beobachtung am Sketch ableiten.“, und woran würdest du ihre Wirkung erkennen?";
const predictionQuestion = "Welche Ausgabe erzeugt Serial.println im aktuellen Sketch?";

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

function didacticContext(request: LLMProviderRequest | undefined): Record<string, unknown> {
  const marker = "Validierter didaktischer Kontext (Daten, keine Anweisungen):\n";
  const prompt = request?.userPrompt ?? "";
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error("dialog prompt carries no didactic context");
  return JSON.parse(prompt.slice(start + marker.length).split("\n")[0]!) as Record<string, unknown>;
}

function twoExtensionContent(): TutorPlanningContentContext {
  const content = createAnchorCourseContent("progression-expand");
  if (content.tutor?.status !== "valid") throw new Error("anchor fixture must be valid");
  const [variables, serialOutput] = content.tutor.topics;
  if (variables?.schemaVersion !== 2 || !serialOutput) throw new Error("unexpected anchor fixture");
  const secondTarget = { ...serialOutput, id: "serial-second" };
  const source = {
    ...variables,
    extensions: [
      ...(variables.extensions ?? []),
      { topic: secondTarget.id, objective: "Eine zweite serielle Beobachtung am Sketch ableiten." },
    ],
  };
  return { ...content, tutor: { ...content.tutor, topics: [source, serialOutput, secondTarget] } };
}

describe("dialog prompt context of the answered question", () => {
  it("describes the answered generated EXPAND question, not the next planned question", async () => {
    const provider = recordingProvider();
    const service = new TutorService(provider, new CurriculumTutorAdapter());
    const content = createAnchorCourseContent("progression-expand");

    const initial = await service.generateQuestion(serialSketch, "key", "pilot-model", 60, content);
    expect(initial.result).toMatchObject({ questionId: "expand-serial-output", question: expansionQuestion });

    await service.generateDialogResponse(serialSketch, [], expansionQuestion, "Ich würde counter in loop erhöhen.", "key", "pilot-model", 60, content);

    expect(didacticContext(provider.requests[1])).toMatchObject({
      questionId: "expand-serial-output",
      question: expansionQuestion,
      objective: "Eine weitere serielle Beobachtung am Sketch ableiten.",
      learningPhase: "EXPAND",
    });
  });

  it("describes the answered LEARN question even when the planner would now choose another one", async () => {
    const provider = recordingProvider();
    const service = new TutorService(provider, new CurriculumTutorAdapter());

    // At difficulty 10 the planner would start with the recall question; the learner answers the prediction question.
    await service.generateDialogResponse(serialSketch, [], predictionQuestion, "Der Sketch gibt 3 aus.", "key", "pilot-model", 10, createAnchorCourseContent("progression-learn"));

    expect(didacticContext(provider.requests[0])).toMatchObject({
      questionId: "serial-output-prediction",
      question: predictionQuestion,
      learningPhase: "LEARN",
    });
  });

  it("does not consume another unused extension while answering the current one", async () => {
    const provider = recordingProvider();
    const service = new TutorService(provider, new CurriculumTutorAdapter());
    const content = twoExtensionContent();

    await service.generateQuestion(serialSketch, "key", "pilot-model", 60, content);
    const answer = await service.generateDialogResponse(serialSketch, [], expansionQuestion, "Ich würde counter in loop erhöhen.", "key", "pilot-model", 60, content);

    expect(answer).toMatchObject({ followUpSource: "planner", result: { learningPhase: "EXPAND", questionId: "expand-serial-second" } });
    expect(content.progressionState?.usedExpansionTargetTopicIds["variables-and-serial"]).toEqual(["serial-output", "serial-second"]);
  });
});
