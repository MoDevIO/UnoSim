import { describe, expect, it } from "vitest";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { curriculumTopicSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
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

const repositoryTopic = validateCurriculumTopic(curriculumTopicSchema.parse({
  schemaVersion: 1,
  id: "byte-basics",
  title: "Bytes",
  locale: "de-DE",
  activation: { any: [{ fact: "type-used", values: ["byte"] }] },
  concepts: [{
    id: "byte-role", title: "Rolle von byte", objective: "Den Datentyp byte einordnen.", prerequisites: [],
    difficulty: { entry: [1, 100], transfer: [1, 100] }, misconceptions: [],
    indicators: [{ id: "names-byte-role", description: "Nennt die Rolle von byte." }],
    mastery: { minimumSuccessfulProbes: 1, successRatingAtLeast: 3, requiredIndicators: ["names-byte-role"], minimumDistinctQuestionKinds: 1, recentWeakAnswersAllowed: 0 },
  }],
  questions: [{ id: "byte-role-q", concept: "byte-role", indicator: "names-byte-role", kind: "concept", difficulty: [1, 100], requires: [{ fact: "type-used", values: ["byte"] }], text: "Welche Rolle spielt byte hier?" }],
  scaffolds: [],
  progression: { entryConcepts: ["byte-role"], preferredOrder: ["byte-role"], onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" } },
}));

function planner(overrides: Partial<ExampleTutorAnnotation> = {}) {
  return plannerWithCourseContent(async () => ({
    revision,
    progressionState: createTutorProgressionState(revision),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [repositoryTopic], strategies: [] },
    exampleId: "it07-05-array",
    exampleTutorAnnotation: { ...annotation, ...overrides },
  }));
}


type Plan = { question: string; questionId: string; topicId: string; conceptId: string; indicatorId: string; questionKind: "concept" };

function turn(plan: Plan, rating: 1 | 2 | 3 | 4 | 5 = 5) {
  return {
    question: plan.question, questionId: plan.questionId, topicId: plan.topicId, conceptId: plan.conceptId,
    indicatorId: plan.indicatorId, questionKind: plan.questionKind, answer: "gute Antwort", answerRating: rating, responseStyle: "normal" as const,
  };
}

/** Answers every planned question with rating 5, like the client history does, until the plan ends. */
async function runStrongSession(adapter: ReturnType<typeof planner>, maxTurns = 8, rating: 1 | 5 = 5) {
  const first = await adapter.planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
  const history: ReturnType<typeof turn>[] = [];
  const questions: string[] = [];
  let plan: unknown = first;
  while (plan && !("kind" in (plan as object)) && questions.length < maxTurns) {
    const current = plan as Plan;
    questions.push(current.question);
    history.push(turn(current, rating));
    plan = await adapter.planFollowup({
      code: arraySketch, history: history.slice(0, -1), currentQuestion: current.question, rating, difficulty: 30, exampleId: "it07-05-array",
    });
  }
  return { questions, last: plan };
}

describe("inline focus annotation", () => {
  it("plans the teacher's first focus question without any matching Topic", async () => {
    const plan = await planner().planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
    expect(plan).toMatchObject({ topicId: "inline-it07-05-array", question: "Welcher Index gehört zum dritten Element von `werte`?" });
  });

  it("asks the next authored question of the area after a strong answer", async () => {
    const adapter = planner();
    const first = await adapter.planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
    if (!first || "kind" in first) throw new Error("no plan");
    const next = await adapter.planFollowup({
      code: arraySketch, history: [], currentQuestion: first.question, rating: 5, difficulty: 30, exampleId: "it07-05-array",
    });
    expect(next).toMatchObject({ topicId: "inline-it07-05-array", question: "Was passiert bei `werte[3]`?" });
  });

  it("hands over to the free Tutor once the whole focus is mastered", async () => {
    const { questions, last } = await runStrongSession(planner());
    expect(questions).toEqual([
      "Welcher Index gehört zum dritten Element von `werte`?",
      "Was passiert bei `werte[3]`?",
      "Warum genügt `byte` für die Elemente?",
    ]);
    expect(last).toBeNull();
  });

  it("moves on to the next focus area after a weak answer to the last question of an area", async () => {
    const adapter = plannerWithCourseContent(async () => ({
      revision,
      progressionState: createTutorProgressionState(revision),
      tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [], strategies: [] },
      exampleId: "it07-05-array",
      exampleTutorAnnotation: {
        schemaVersion: 2 as const,
        focus: [
          { id: "erster", title: "Erster", objective: "o", questions: [{ kind: "concept" as const, text: "Erste Frage?" }] },
          { id: "zweiter", title: "Zweiter", objective: "o", questions: [{ kind: "concept" as const, text: "Zweite Frage?" }] },
        ],
      },
    }));
    const first = await adapter.planInitial({ code: arraySketch, history: [], difficulty: 30, exampleId: "it07-05-array" });
    if (!first || "kind" in first) throw new Error("no plan");
    const next = await adapter.planFollowup({
      code: arraySketch, history: [], currentQuestion: first.question, rating: 1, difficulty: 30, exampleId: "it07-05-array",
    });
    expect(next).toMatchObject({ topicId: "inline-it07-05-array", question: "Zweite Frage?" });
  });

  it("also hands over to the free Tutor when weak answers use up the focus questions", async () => {
    const { questions, last } = await runStrongSession(planner(), 12, 1);
    expect(questions.length).toBeLessThan(12);
    expect(last).toBeNull();
  });

  it("continues with repository Topics after the focus when afterFocus is topics", async () => {
    const { questions } = await runStrongSession(planner({ afterFocus: "topics" }));
    expect(questions).toContain("Welche Rolle spielt byte hier?");
  });

  it("rejects focus in a version 1 annotation and afterFocus without focus", () => {
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 1, focus: annotation.focus }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, afterFocus: "free" }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: annotation.focus, afterFocus: "topics" }).success).toBe(true);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: annotation.focus, afterFocus: "never" }).success).toBe(false);
  });

  it("rejects duplicate focus ids, empty questions and URLs", () => {
    const area = annotation.focus![0]!;
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [area, area] }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [{ ...area, questions: [] }] }).success).toBe(false);
    expect(embeddedTutorAnnotationSchema.safeParse({ schemaVersion: 2, focus: [{ ...area, questions: [{ kind: "concept", text: "Siehe https://x.example" }] }] }).success).toBe(false);
  });
});
