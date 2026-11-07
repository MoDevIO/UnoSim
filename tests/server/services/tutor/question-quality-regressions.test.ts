import { describe, expect, it, vi } from "vitest";
import { buildTutorContext, buildUserPrompt, TutorService } from "../../../../server/services/tutor/tutor-service";
import type { LLMProvider } from "../../../../server/services/tutor/llm-provider";
import type { TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";

const revision = "a".repeat(40);

function providerReturning(question: string): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn().mockResolvedValue({
      model: "pilot-model",
      result: {
        answerRating: 5,
        question,
      },
    }),
  };
}

function transitionPlanning(): TutorPlanningExtension {
  return {
    planInitial: vi.fn().mockResolvedValue(null),
    planFollowup: vi.fn().mockResolvedValue({
      kind: "transition",
      contentRevision: revision,
      learningPhase: "DEEPEN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
      strategyId: "built-in-default",
      strategySource: "built-in",
    }),
  };
}

describe("Tutor question quality regressions", () => {
  it("keeps the distinct question after applying transition metadata", async () => {
    const repeatedQuestion = "Welchen Wert verwendet der Sketch an der betrachteten Integer-Variablen?";
    const result = await new TutorService(
      providerReturning(repeatedQuestion),
      transitionPlanning(),
    ).generateDialogResponse(
      `const int ledPin = 9;
void setup() { pinMode(ledPin, OUTPUT); }
void loop() { analogWrite(ledPin, 128); }`,
      [],
      repeatedQuestion,
      "Der Wert ist 128.",
      "key",
      undefined,
      30,
    );

    expect(result.result).toMatchObject({
      answerRating: 5,
      learningPhase: "DEEPEN",
      strategyId: "built-in-default",
    });
    expect(result.result.question).not.toBe(repeatedQuestion);
    expect(result.result.question).toBe("Welches andere im Sketch sichtbare Konzept möchtest du als Nächstes mit diesem verstandenen Teilkonzept verknüpfen?");
  });

  it("guides the provider to identify concrete variables and local code context", () => {
    const code = `const int ledPin = 9;
void setup() { pinMode(ledPin, OUTPUT); }
void loop() {
  for (int brightness = 0; brightness <= 255; brightness += 5) {
    analogWrite(ledPin, brightness);
  }
}`;
    const prompt = buildUserPrompt(code, buildTutorContext(code));

    expect(prompt).toContain("konkreten Bezeichner");
    expect(prompt).toContain("lokale Code-Stelle");
    expect(prompt).toContain("ledPin");
    expect(prompt).toContain("brightness");
  });
});

describe("IT06.4 grading regression (LearningQuestions R-SUP-8)", () => {
  /** The observed failure: the model checked the answer against `a = 37` from the sketch and called 1 wrong. */
  function ratingProvider(rating: 1 | 2 | 3 | 4 | 5, feedback: string): LLMProvider {
    return {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: { responseStyle: "normal", feedback, answerRating: rating, question: "Was gibt der zweite Durchlauf aus?" },
      }),
    };
  }

  it.each([
    ["1", 2, "Falsch: Bei a = 37 ist Bit 7 nicht gesetzt, es wird 0 ausgegeben.", 5],
    ["200 = 1", 1, "Falsch, die erste Ziffer ist 0.", 5],
    ["0", 5, "Richtig.", 2],
  ] as const)("rates %j as %i whatever the model says, with the reviewed reference", async (answer, modelRating, modelFeedback, expected) => {
    const { IT064_PREDICTION_QUESTION, IT064_REFERENCE, IT064_SKETCH } = await import("./fixtures/it06-4");
    const result = (await new TutorService(ratingProvider(modelRating, modelFeedback)).generateDialogResponse(
      IT064_SKETCH, [], IT064_PREDICTION_QUESTION, answer, "key", undefined, 30, undefined, undefined, undefined,
      { reference: IT064_REFERENCE, assisted: false },
    )).result;

    expect(result.answerRating).toBe(expected);
    if (expected === 5) expect(result.feedback).not.toMatch(/falsch|0 ausgegeben|ist 0/i);
    // A weak answer keeps the question open; a correct one moves on (R-SUP-3).
    expect(result.question === IT064_PREDICTION_QUESTION).toBe(expected <= 2);
  });

  it("keeps the MVP grading without a support binding: no reference is applied", async () => {
    const { IT064_PREDICTION_QUESTION, IT064_SKETCH } = await import("./fixtures/it06-4");
    const result = (await new TutorService(ratingProvider(2, "Falsch.")).generateDialogResponse(
      IT064_SKETCH, [], IT064_PREDICTION_QUESTION, "1", "key", undefined, 30,
    )).result;
    expect(result.answerRating).toBe(2);
  });
});
