import { describe, expect, it, vi } from "vitest";
import { createTutorService } from "../../../../server/services/tutor/tutor-service-factory";
import { createAnchorCourseContent } from "../../../../server/services/tutor/evaluation/anchor-course-content";
import type { LLMProviderRequest } from "../../../../server/services/tutor/llm-provider";
import { TutorProviderError } from "../../../../server/services/tutor/llm-provider";

/**
 * The learning-support cycle for a Topic question and for the free Tutor (TutorQualityGates 8): the real
 * service and planner, only the provider is scripted. The teacher's focus is covered over HTTP in
 * tests/server/routes/tutor-learning-support.routes.test.ts.
 */

const SERIAL_SKETCH = "int counter = 3;\nvoid setup() { Serial.begin(9600); Serial.print(counter); }\nvoid loop() {}";

function provider(rating: 1 | 2 | 3 | 4 | 5, questions: string[] = []) {
  const generateLearningQuestion = vi.fn(async ({ userPrompt }: LLMProviderRequest) => {
    if (userPrompt.startsWith("Führe den sokratischen Lerndialog")) {
      return { model: "m", result: { responseStyle: "normal" as const, feedback: "Rückmeldung.", answerRating: rating, question: questions.shift() ?? "Wie ändert sich die Ausgabe, wenn counter 4 ist?" } };
    }
    return { model: "m", result: { responseStyle: "normal" as const, question: questions.shift() ?? "Welche Rolle spielt Serial.begin?" } };
  });
  return { listModels: vi.fn().mockResolvedValue(["m"]), generateLearningQuestion };
}

describe("learning support for a Topic question", () => {
  it("keeps a Topic question after a weak answer and records the attempt as evidence, not as mastery", async () => {
    const content = createAnchorCourseContent("variables");
    const service = createTutorService(provider(2));
    const asked = (await service.generateQuestion(SERIAL_SKETCH, "key", undefined, 30, content)).result;
    expect(asked.topicId).toBe("variables-and-serial");

    const weak = await service.generateDialogResponse(SERIAL_SKETCH, [], asked.question, "Keine Ahnung von Zahlen", "key", undefined, 30, content, undefined, undefined, { assisted: false });
    expect(weak.retained).toBe(true);
    expect(weak.result.question).toBe(asked.question);
    expect(weak.result.questionId).toBe(asked.questionId);
    expect(content.progressionState?.masteryEvidence["variables-and-serial"]?.map(({ rating }) => rating)).toEqual([2]);
    expect(content.progressionState?.masteredTopicIds).toEqual([]);
  });

  it("adds no evidence when the question is left after the reference answer or by skipping, and does not ask it again right away", async () => {
    const content = createAnchorCourseContent("variables");
    const service = createTutorService(provider(5));
    const asked = (await service.generateQuestion(SERIAL_SKETCH, "key", undefined, 30, content)).result;

    const after = await service.generateDialogResponse(SERIAL_SKETCH, [], asked.question, "3", "key", undefined, 30, content, undefined, undefined, { assisted: true });
    expect(after.retained).toBe(false);
    expect(content.progressionState?.masteryEvidence["variables-and-serial"] ?? []).toEqual([]);
    expect(content.progressionState?.leftQuestionIds["variables-and-serial"]).toEqual([asked.questionId]);
    expect(after.result.questionId).not.toBe(asked.questionId);

    const skipped = await service.generateNextQuestion({
      code: SERIAL_SKETCH, credential: "key", requestedModel: undefined, difficulty: 30, courseContent: content,
      options: { leave: { question: after.result.question, history: [] }, avoidQuestions: [asked.question, after.result.question] },
    });
    expect(content.progressionState?.masteryEvidence["variables-and-serial"] ?? []).toEqual([]);
    if (!skipped.completed) expect([asked.questionId, after.result.questionId]).not.toContain(skipped.result.questionId);
  });
});

describe("learning support for the free Tutor", () => {
  it("keeps the free question after a weak answer and moves on after a good one", async () => {
    const service = createTutorService(provider(1, ["Warum wird counter ausgegeben?"]));
    const weak = await service.generateDialogResponse(SERIAL_SKETCH, [], "Was gibt Serial.print aus?", "7", "key", undefined, 30, undefined, undefined, undefined, { assisted: false });
    expect(weak).toMatchObject({ retained: true, result: { question: "Was gibt Serial.print aus?", answerRating: 1 } });

    const good = await createTutorService(provider(4)).generateDialogResponse(SERIAL_SKETCH, [], "Was gibt Serial.print aus?", "3", "key", undefined, 30, undefined, undefined, undefined, { assisted: false });
    expect(good.retained).toBe(false);
    expect(good.result.question).not.toBe("Was gibt Serial.print aus?");
  });

  it("does not ask a skipped free question again, also not in other words", async () => {
    const service = createTutorService(provider(5, ["Welche Rolle spielt Serial.begin im Sketch?"]));
    await expect(service.generateNextQuestion({
      code: SERIAL_SKETCH, credential: "key", requestedModel: undefined, difficulty: 30,
      options: { leave: { question: "Welche Rolle spielt Serial.begin im Sketch?", history: [] }, avoidQuestions: ["Welche Rolle spielt Serial.begin im Sketch?"] },
    })).rejects.toBeInstanceOf(TutorProviderError);

    const fresh = await createTutorService(provider(5, ["Welchen Wert hat counter beim Start?"])).generateNextQuestion({
      code: SERIAL_SKETCH, credential: "key", requestedModel: undefined, difficulty: 30,
      options: { leave: { question: "Welche Rolle spielt Serial.begin im Sketch?", history: [] }, avoidQuestions: ["Welche Rolle spielt Serial.begin im Sketch?"] },
    });
    expect(fresh.completed).toBeUndefined();
    if (!fresh.completed) expect(fresh.result.question).toBe("Welchen Wert hat counter beim Start?");
  });

  it("tells the provider which questions were skipped", async () => {
    const scripted = provider(5, ["Welchen Wert hat counter beim Start?"]);
    await createTutorService(scripted).generateNextQuestion({
      code: SERIAL_SKETCH, credential: "key", requestedModel: undefined, difficulty: 30,
      options: { avoidQuestions: ["Welche Rolle spielt Serial.begin im Sketch?"] },
    });
    expect(scripted.generateLearningQuestion.mock.calls[0]?.[0].userPrompt).toContain("Diese Fragen wurden übersprungen");
  });
});

describe("skipping without a further Course Content question (R-SUP-4)", () => {
  it("ends with an open completion instead of inventing a question, and asks the provider nothing", async () => {
    const { TutorService } = await import("../../../../server/services/tutor/tutor-service");
    const scripted = provider(5);
    const blocked = {
      kind: "blocked" as const, progressionBlockedReason: "content-exhausted" as const, contentRevision: "2".repeat(40), learningPhase: "LEARN" as const,
      masteredTopicIds: [], strategyId: "built-in-default", strategySource: "built-in" as const,
    };
    const leaveQuestion = vi.fn().mockResolvedValue(undefined);
    const planning = {
      planInitial: vi.fn().mockResolvedValue(blocked),
      planFollowup: vi.fn(),
      leaveQuestion,
      focusProgress: () => ({ progress: { state: "open" as const, understoodAreas: 0, totalAreas: 1, openAreas: ["Ein Bit prüfen"] }, openObjectives: ["Bits prüfen."] }),
    };
    const content = createAnchorCourseContent("variables");
    const next = await new TutorService(scripted, planning).generateNextQuestion({
      code: SERIAL_SKETCH, credential: "key", requestedModel: undefined, difficulty: 30, courseContent: content,
      options: { leave: { question: "Letzte Frage?", history: [] } },
    });
    expect(next).toEqual({ completed: true, model: "auto", focusProgress: { state: "open", understoodAreas: 0, totalAreas: 1, openAreas: ["Ein Bit prüfen"] } });
    expect(leaveQuestion).toHaveBeenCalledOnce();
    expect(scripted.generateLearningQuestion).not.toHaveBeenCalled();
  });
});
