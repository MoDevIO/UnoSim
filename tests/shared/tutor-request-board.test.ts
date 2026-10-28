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

describe("Tutor requests: project files (LearningQuestions SSOT)", () => {
  const question = { code: '#include "a.h"\nvoid setup(){} void loop(){}' };
  const headers = [{ name: "a.h", content: "const int LED = 9;" }];

  it("accepts the headers and entry file of the project as POST /api/compile does", () => {
    expect(tutorQuestionRequestSchema.safeParse({ ...question, headers, entryFile: "main.ino" }).success).toBe(true);
    expect(tutorDialogRequestSchema.safeParse({ ...question, headers, history: [], question: "Frage?", answer: "Antwort" }).success).toBe(true);
  });

  it("rejects unsafe or colliding file names", () => {
    expect(tutorQuestionRequestSchema.safeParse({ ...question, headers: [{ name: "../x.h", content: "" }] }).success).toBe(false);
    expect(tutorQuestionRequestSchema.safeParse({ ...question, headers: [{ name: "main.ino", content: "" }], entryFile: "main.ino" }).success).toBe(false);
    expect(tutorQuestionRequestSchema.safeParse({ ...question, headers: [...headers, { name: "A.h", content: "" }] }).success).toBe(false);
  });
});
