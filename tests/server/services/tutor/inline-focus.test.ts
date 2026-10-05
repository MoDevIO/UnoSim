import { describe, expect, it } from "vitest";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { plannerWithCourseContent } from "./support/course-content-planner";
import { embeddedTutorAnnotationSchema, type ExampleTutorAnnotation } from "../../../../server/services/course-content/embedded-tutor-annotation";

const revision = "2".repeat(40);
const arraySketch = "byte werte[3] = {1, 2, 3};\nvoid setup() {}\nvoid loop() {}\n";

const annotation: ExampleTutorAnnotation = {
  schemaVersion: 2,
  focus: [
    { id: "indizierung", title: "Indizierung", objective: "Elemente über den Index ansprechen.", questions: [
      { kind: "concept", text: "Welcher Index gehört zum dritten Element von `werte`?" },
      { kind: "prediction", text: "Was passiert bei `werte[3]`?" },
    ] },
    { id: "datentyp", title: "Datentyp", objective: "Den Elementtyp begründen.", questions: [
      { kind: "concept", text: "Warum genügt `byte` für die Elemente?" },
    ] },
  ],
};

function planner(overrides: Partial<ExampleTutorAnnotation> = {}) {
  return plannerWithCourseContent(async () => ({
    revision,
    progressionState: createTutorProgressionState(revision),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleId: "it07-05-array",
    exampleTutorAnnotation: { ...annotation, ...overrides },
  }));
}

describe("inline focus annotation", () => {
  it("plans the teacher's first focus question without any matching Topic", async () => {
    const plan = await planner().planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
    expect(plan).toMatchObject({ topicId: "inline-it07-05-array", question: "Welcher Index gehört zum dritten Element von `werte`?" });
  });

  it("moves to the next focus area after the first one is mastered", async () => {
    const adapter = planner();
    const first = await adapter.planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
    if (!first || "kind" in first) throw new Error("no plan");
    const next = await adapter.planFollowup({
      code: arraySketch, history: [], currentQuestion: first.question, rating: 5, difficulty: 30, exampleId: "it07-05-array",
    });
    expect(next).toMatchObject({ topicId: "inline-it07-05-array", question: "Warum genügt `byte` für die Elemente?" });
  });

  it("rejects focus in a version 1 annotation and exclusive without focus", () => {
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 1, focus: annotation.focus }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, exclusive: true }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: annotation.focus, exclusive: true }).success).toBe(true);
  });

  it("rejects duplicate focus ids, empty questions and URLs", () => {
    const area = annotation.focus![0]!;
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [area, area] }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [{ ...area, questions: [] }] }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [{ ...area, questions: [{ kind: "concept", text: "Siehe https://x.example" }] }] }).success).toBe(false);
  });
});
