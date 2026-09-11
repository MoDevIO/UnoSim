import { describe, expect, it } from "vitest";
import {
  calculateNextTutorDifficulty,
  TUTOR_DEFAULT_DIFFICULTY,
  tutorContentResultSchema,
  tutorDialogRequestSchema,
  tutorQuestionRequestSchema,
} from "../../shared/tutor";

describe("Tutor contracts", () => {
  it("defaults difficulty to 30 and accepts only the 1..100 range", () => {
    expect(tutorQuestionRequestSchema.parse({ code: "void setup(){}" }).difficulty)
      .toBe(TUTOR_DEFAULT_DIFFICULTY);
    expect(tutorQuestionRequestSchema.parse({ code: "void setup(){}", difficulty: 1 }).difficulty).toBe(1);
    expect(tutorQuestionRequestSchema.parse({ code: "void setup(){}", difficulty: 100 }).difficulty).toBe(100);
    expect(() => tutorQuestionRequestSchema.parse({ code: "void setup(){}", difficulty: 0 })).toThrow();
    expect(() => tutorQuestionRequestSchema.parse({ code: "void setup(){}", difficulty: 101 })).toThrow();
  });

  it("applies the same difficulty boundary to dialog requests", () => {
    const request = {
      code: "void setup(){}",
      history: [],
      question: "Was passiert?",
      answer: "Eine Ausgabe.",
      difficulty: 100,
    };
    expect(tutorDialogRequestSchema.parse(request).difficulty).toBe(100);
    expect(() => tutorDialogRequestSchema.parse({ ...request, difficulty: 101 })).toThrow();
  });

  it("models explicit response styles for normal and philosophical responses", () => {
    expect(tutorContentResultSchema.parse({ question: "Was passiert?" }).responseStyle).toBe("normal");
    expect(tutorContentResultSchema.parse({
      responseStyle: "philosophical",
      feedback: "Kurzer Seitenblick.",
      question: "Worauf möchtest du zurückkommen?",
    }).responseStyle).toBe("philosophical");
    expect(() => tutorContentResultSchema.parse({
      responseStyle: "philosophical",
      question: "Worauf möchtest du zurückkommen?",
      answerRating: 1,
    })).toThrow();
  });

  it("adapts effective difficulty deterministically with damping and boundaries", () => {
    expect(calculateNextTutorDifficulty(50, [5])).toBe(54);
    expect(calculateNextTutorDifficulty(50, [2])).toBe(47);
    expect(calculateNextTutorDifficulty(50, [1])).toBe(44);
    expect(calculateNextTutorDifficulty(50, [5, 1, 5, 1])).toBe(48);
    expect(calculateNextTutorDifficulty(99, [5])).toBe(100);
    expect(calculateNextTutorDifficulty(2, [1])).toBe(1);
  });

  it("lowers difficulty for a weak streak and raises it only in controlled steps for good answers", () => {
    let weakDifficulty = 50;
    weakDifficulty = calculateNextTutorDifficulty(weakDifficulty, [2]);
    weakDifficulty = calculateNextTutorDifficulty(weakDifficulty, [2]);
    weakDifficulty = calculateNextTutorDifficulty(weakDifficulty, [2]);
    expect(weakDifficulty).toBeLessThan(50);

    let goodDifficulty = 50;
    for (let index = 0; index < 3; index += 1) {
      const nextDifficulty = calculateNextTutorDifficulty(goodDifficulty, [5]);
      expect(nextDifficulty - goodDifficulty).toBeLessThanOrEqual(4);
      goodDifficulty = nextDifficulty;
    }
    expect(goodDifficulty).toBeGreaterThan(50);
  });
});
