import { describe, expect, it } from "vitest";
import {
  inspectLearningQuestion,
  validateLearningQuestion,
} from "../../../../../server/services/tutor/tutor-service";

describe("shared Tutor learning-question diagnostics", () => {
  it("reports granular deterministic violations", () => {
    expect(inspectLearningQuestion({ question: "Welche? Zweite?" }).violations.map(({ code }) => code))
      .toContain("multiple-primary-questions");
    expect(inspectLearningQuestion({ question: "void setup() {} void loop() {}" }).violations.map(({ code }) => code))
      .toContain("complete-solution");
    expect(inspectLearningQuestion({ responseStyle: "normal", question: "Welche?", answerRating: 4 }).violations).toHaveLength(0);
    expect(inspectLearningQuestion({ responseStyle: "philosophical", question: "Welche?", answerRating: 4 }).violations.map(({ code }) => code))
      .toContain("philosophical-answer-rating");
    expect(inspectLearningQuestion({ responseStyle: "normal", answerRating: "4" }).violations.map(({ code }) => code))
      .toContain("schema-invalid");
  });

  it("keeps the existing validation throw behavior backed by the same records", () => {
    const invalid = { question: "void setup() {} void loop() {}" };
    expect(() => validateLearningQuestion(invalid as never)).toThrowError(expect.objectContaining({ kind: "invalid-response" }));
    expect(inspectLearningQuestion(invalid).violations.map(({ code }) => code)).toContain("complete-solution");
  });
});
