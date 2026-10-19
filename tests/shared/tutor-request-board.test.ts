import { describe, expect, it } from "vitest";
import { tutorDialogRequestSchema, tutorQuestionRequestSchema } from "../../shared/tutor";

describe("Tutor requests: board (plan P2.7)", () => {
  const question = { code: "void setup(){} void loop(){}" };
  const dialog = { ...question, history: [], question: "Frage?", answer: "Antwort" };

  it("accepts a catalog board and works without one", () => {
    expect(tutorQuestionRequestSchema.safeParse({ ...question, board: "mega2560" }).success).toBe(true);
    expect(tutorDialogRequestSchema.safeParse({ ...dialog, board: "nano" }).success).toBe(true);
    expect(tutorQuestionRequestSchema.safeParse(question).success).toBe(true);
    expect(tutorDialogRequestSchema.safeParse(dialog).success).toBe(true);
  });

  it("rejects a board outside the catalog", () => {
    expect(tutorQuestionRequestSchema.safeParse({ ...question, board: "esp32" }).success).toBe(false);
    expect(tutorDialogRequestSchema.safeParse({ ...dialog, board: "" }).success).toBe(false);
  });
});
