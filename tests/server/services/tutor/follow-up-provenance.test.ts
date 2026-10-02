import { describe, expect, it, vi } from "vitest";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import type { LLMProvider } from "../../../../server/services/tutor/llm-provider";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createAnchorCourseContent } from "../../../../server/services/tutor/evaluation/anchor-course-content";

// R-FUP-1..4: the follow-up source is recorded where the application decides which question is used.

const sketch = "int counter = 3;\nvoid setup() { Serial.begin(9600); Serial.println(counter); }\nvoid loop() {}";
const answeredQuestion = "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?";

function providerReturning(result: Record<string, unknown>): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result }),
  };
}

describe("follow-up provenance (R-FUP)", () => {
  it("reports `provider` for an accepted provider question without course content", async () => {
    const service = new TutorService(providerReturning({ responseStyle: "normal", question: "Welche Zustandsänderung erwartest du?" }));

    await expect(service.generateQuestion(sketch, "key", "pilot-model")).resolves.toMatchObject({ followUpSource: "provider" });
    const dialog = providerReturning({ responseStyle: "normal", answerRating: 4, feedback: "Gut.", question: "Was passiert in loop?" });
    await expect(new TutorService(dialog).generateDialogResponse(sketch, [], answeredQuestion, "int speichert counter.", "key", "pilot-model"))
      .resolves.toMatchObject({ followUpSource: "provider" });
  });

  it("does not infer the source from a questionId that the provider returned", async () => {
    const service = new TutorService(providerReturning({
      responseStyle: "normal",
      question: "Welche Zustandsänderung erwartest du?",
      questionId: "variable-value-recall",
    }));

    const response = await service.generateQuestion(sketch, "key", "pilot-model");

    expect(response.result).not.toHaveProperty("questionId");
    expect(response.followUpSource).toBe("provider");
  });

  it("reports `planner` when an application-owned TutorPlan supplies the question", async () => {
    const service = new TutorService(
      providerReturning({ responseStyle: "normal", answerRating: 4, feedback: "Gut.", question: "Eine Frage des Providers?" }),
      new CurriculumTutorAdapter(),
    );
    const initial = await service.generateQuestion(sketch, "key", "pilot-model", 30, createAnchorCourseContent("progression-learn"));
    expect(initial).toMatchObject({ followUpSource: "planner" });
    expect(initial.result.question).not.toBe("Eine Frage des Providers?");

    const dialog = await service.generateDialogResponse(
      sketch, [], answeredQuestion, "int speichert den Wert von counter.", "key", "pilot-model", 30, createAnchorCourseContent("progression-learn"),
    );
    expect(dialog).toMatchObject({ followUpSource: "planner" });
  });

  it("reports `application-fallback` when a repeated provider question is replaced", async () => {
    const service = new TutorService(providerReturning({
      responseStyle: "normal",
      answerRating: 2,
      feedback: "Noch nicht ganz.",
      question: answeredQuestion,
    }));

    const response = await service.generateDialogResponse(sketch, [], answeredQuestion, "Keine Ahnung.", "key", "pilot-model");

    expect(response.result.question).not.toBe(answeredQuestion);
    expect(response.followUpSource).toBe("application-fallback");
  });

  it("reports `application-fallback` for the philosophical off-topic fallback without a provider call", async () => {
    const provider = providerReturning({ responseStyle: "normal", question: "unused?" });
    const response = await new TutorService(provider).generateDialogResponse(sketch, [], answeredQuestion, "asdf", "key", "pilot-model");

    expect(provider.generateLearningQuestion).not.toHaveBeenCalled();
    expect(response).toMatchObject({ followUpSource: "application-fallback", result: { responseStyle: "philosophical" } });
  });
});
