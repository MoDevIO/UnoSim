import { describe, expect, it, vi } from "vitest";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import type { TutorPlan, TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";

const plan: TutorPlan = {
  topicId: "pilot-topic",
  topicTitle: "Pilot",
  conceptId: "concept-one",
  conceptTitle: "Concept one",
  objective: "Understand the concept",
  questionId: "question-one",
  questionKind: "concept",
  indicatorId: "indicator-one",
  indicator: "Can explain it",
  question: "Welche Beobachtung machst du?",
  misconceptions: [],
  contentRevision: "0123456789abcdef0123456789abcdef01234567",
};

const provider = {
  listModels: vi.fn().mockResolvedValue(["pilot-model"]),
  generateLearningQuestion: vi.fn().mockResolvedValue({
    model: "pilot-model",
    result: { answerRating: 4, question: "Providerfrage" },
  }),
};

describe("TutorPlanningExtension port", () => {
  it("lets TutorService operate without an extension", async () => {
    const service = new TutorService(provider, "user-key");
    const result = await service.generateQuestion("void setup(){} void loop(){}", "key", undefined, 30);
    expect(result.result.question).toBe("Providerfrage");
  });

  it("accepts a neutral plan and falls back when the extension returns null", async () => {
    const extension: TutorPlanningExtension = {
      planInitial: vi.fn().mockResolvedValue(plan),
      planFollowup: vi.fn().mockResolvedValue(null),
    };
    const service = new TutorService(provider, "user-key", extension);
    const initial = await service.generateQuestion("void setup(){} void loop(){}", "key", undefined, 30);
    expect(initial.result.questionId).toBe("question-one");
    const followup = await service.generateDialogResponse("void setup(){} void loop(){}", [], plan.question, "Antwort", "key", undefined, 30);
    expect(followup.result.question).toBe("Providerfrage");
  });
});
