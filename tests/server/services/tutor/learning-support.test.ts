import { describe, expect, it } from "vitest";
import { embeddedTutorAnnotationSchema } from "../../../../server/services/course-content/embedded-tutor-annotation";
import { curriculumTopicSchema } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import {
  gradeAgainstReference,
  normalizeReferenceAnswer,
  referenceAnswerSchema,
  referenceAppliesTo,
} from "../../../../server/services/tutor/curriculum/reference-answer";
import {
  applyReferenceGrade,
  buildSupportPrompt,
  classifyLearnerInput,
  validateSupportExplanation,
} from "../../../../server/services/tutor/learning-support";
import {
  newSupportQuestion,
  supportStateView,
  TutorSupportStore,
  withAnswerAttempt,
  withClarification,
} from "../../../../server/services/tutor/learning-support-store";
import { resolveQuestionReference } from "../../../../server/services/tutor/question-reference";
import { TUTOR_PROMPT_REVISION, TUTOR_SYSTEM_PROMPT } from "../../../../server/services/tutor/tutor-service";
import {
  IT064_ANNOTATION,
  IT064_PREDICTION_QUESTION,
  IT064_REFERENCE,
  IT064_SKETCH,
  IT064_SKETCH_A200,
  it064Content,
} from "./fixtures/it06-4";

describe("reference answers (CourseContent SSOT 6.4)", () => {
  it("accept the answers listed as correct, contradict a different single number, leave the rest to the Tutor", () => {
    expect(gradeAgainstReference(IT064_REFERENCE, "1")).toBe("accepted");
    expect(gradeAgainstReference(IT064_REFERENCE, " 200=1. ")).toBe("accepted");
    expect(gradeAgainstReference(IT064_REFERENCE, "„1“")).toBe("accepted");
    expect(gradeAgainstReference(IT064_REFERENCE, "0")).toBe("contradicted");
    expect(gradeAgainstReference(IT064_REFERENCE, "200 = 0")).toBe("open");
    expect(gradeAgainstReference(IT064_REFERENCE, "eine Eins, weil Bit 7 gesetzt ist")).toBe("open");
    expect(normalizeReferenceAnswer("200  =  1!")).toBe("200 = 1");
  });

  it("apply only to the reviewed program, where just the value the question assumes may differ", () => {
    const reviewed = { code: IT064_SKETCH, headers: [] };
    const applies = (code: string, headers: { name: string; content: string }[] = []) => referenceAppliesTo(IT064_REFERENCE, { code, headers }, reviewed);
    expect(applies(IT064_SKETCH)).toBe(true);
    expect(applies(IT064_SKETCH_A200)).toBe(true);
    expect(applies(IT064_SKETCH.replace("byte a = 37;", "byte a = 0x0F;"))).toBe(true);
    expect(applies(IT064_SKETCH.replace("a & (1 << i) && 1", "a&(1<<i)&&1"))).toBe(true);
    expect(applies(IT064_SKETCH.replace("// ist Bit i gesetzt?", "/* Bit i? */"))).toBe(true);
    expect(applies(IT064_SKETCH.replace("for (int i = 7; i >= 0; i--) {", "for (int i = 7; i >= 0; i--)\n  {"))).toBe(true);
    // Review R1: the negation keeps every fragment but changes the first print to 0.
    expect(applies(IT064_SKETCH.replace("Serial.print(a & (1 << i) && 1);", "Serial.print(!(a & (1 << i) && 1));"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("a & (1 << i) && 1", "bitRead(a, i)"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("int i = 7", "int i = 6"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("i >= 0", "i > 0"))).toBe(false);
    // The print moved before the loop.
    const moved = IT064_SKETCH.replace("    Serial.print(a & (1 << i) && 1);   // ist Bit i gesetzt?\n", "").replace("  for (int i = 7;", "  Serial.print(a & (1 << i) && 1);\n  for (int i = 7;");
    expect(applies(moved)).toBe(false);
    // A line that is only left in a comment does not count.
    expect(applies(IT064_SKETCH.replace("Serial.print(a & (1 << i) && 1);", "// Serial.print(a & (1 << i) && 1);"))).toBe(false);
    // Review N1: a line inserted between the protected lines makes the first output 0.
    expect(applies(IT064_SKETCH.replace("for (int i = 7; i >= 0; i--) {", "for (int i = 7; i >= 0; i--) {\n    i = 0;"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("Serial.begin(115200);", "Serial.begin(115200);\n  a = 0;"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("void loop() {", "#define print println\nvoid loop() {"))).toBe(false);
    // Only a literal value of the assumed variable may change, not the expression or another variable.
    expect(applies(IT064_SKETCH.replace("byte a = 37;", "byte a = 37 + 1;"))).toBe(false);
    expect(applies(IT064_SKETCH.replace("byte a = 37;", "int a = 200;"))).toBe(false);
    expect(referenceAppliesTo({ ...IT064_REFERENCE, assumptions: undefined }, { code: IT064_SKETCH_A200 }, reviewed)).toBe(false);
    // Project files count as well, and without a reviewed program nothing applies.
    expect(applies(IT064_SKETCH, [{ name: "bits.h", content: "#define print println" }])).toBe(false);
    expect(referenceAppliesTo(IT064_REFERENCE, reviewed, undefined)).toBe(false);
    expect(referenceAppliesTo(IT064_REFERENCE, { code: "int a;" }, { code: "int a;" })).toBe(false);
  });

  it("reject a code block, a replacement sketch, a URL and unknown fields", () => {
    expect(referenceAnswerSchema.safeParse(IT064_REFERENCE).success).toBe(true);
    expect(referenceAnswerSchema.safeParse({ ...IT064_REFERENCE, explanation: "```cpp\nint a;\n```" }).success).toBe(false);
    expect(referenceAnswerSchema.safeParse({ ...IT064_REFERENCE, explanation: "void setup() {} void loop() {}" }).success).toBe(false);
    expect(referenceAnswerSchema.safeParse({ ...IT064_REFERENCE, explanation: "Siehe https://example.org" }).success).toBe(false);
    expect(referenceAnswerSchema.safeParse({ ...IT064_REFERENCE, evaluate: "a & 128" }).success).toBe(false);
  });

  it("are part of annotation schema 3 only; versions 1 and 2 stay closed and remain valid without them", () => {
    expect(embeddedTutorAnnotationSchema.safeParse(IT064_ANNOTATION).success).toBe(true);
    expect(embeddedTutorAnnotationSchema.safeParse({ ...IT064_ANNOTATION, schemaVersion: 2 }).success).toBe(false);
    const withoutReferences = {
      ...IT064_ANNOTATION,
      schemaVersion: 2,
      focus: IT064_ANNOTATION.focus!.map((area) => ({ ...area, questions: area.questions.map(({ kind, text }) => ({ kind, text })) })),
    };
    expect(embeddedTutorAnnotationSchema.safeParse(withoutReferences).success).toBe(true);
    expect(embeddedTutorAnnotationSchema.safeParse({ ...withoutReferences, schemaVersion: 3 }).success).toBe(true);
  });

  it("are part of Topic schema 3 only, and only on a question with a fixed text", () => {
    const topic = {
      schemaVersion: 3,
      id: "bits",
      title: "Bits",
      locale: "de-DE",
      activation: { any: [{ fact: "serial-call", values: ["print"] }] },
      concepts: [{
        id: "shift", title: "Verschieben", objective: "Verschieben verstehen.", prerequisites: [],
        difficulty: { entry: [1, 100], transfer: [1, 100] }, misconceptions: [],
        indicators: [{ id: "shift-value", description: "Wert der Verschiebung." }],
        mastery: { minimumSuccessfulProbes: 1, successRatingAtLeast: 3, requiredIndicators: ["shift-value"], minimumDistinctQuestionKinds: 1, recentWeakAnswersAllowed: 0 },
      }],
      questions: [{
        id: "shift-q1", concept: "shift", indicator: "shift-value", kind: "recall", difficulty: [1, 100],
        requires: [{ fact: "serial-call", values: ["print"] }], text: "Welche Zahl ergibt `1 << 7`?",
        reference: {
          answer: "128", explanation: "1 << 7 verschiebt die 1 um sieben Stellen: 2 hoch 7 = 128.", requiresCode: ["Serial.print(1 << 7);"],
          reviewedCode: "void setup() {\n  Serial.begin(9600);\n  Serial.print(1 << 7);\n}\nvoid loop() {}\n",
        },
      }],
      scaffolds: [],
      progression: { entryConcepts: ["shift"], preferredOrder: ["shift"], onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" } },
    };
    expect(curriculumTopicSchema.safeParse(topic).success).toBe(true);
    expect(curriculumTopicSchema.safeParse({ ...topic, schemaVersion: 2 }).success).toBe(false);
    const templated = { ...topic, questions: [{ ...topic.questions[0], text: undefined, template: "Welche Zahl ergibt {x}?", slots: ["x"] }] };
    expect(curriculumTopicSchema.safeParse(templated).success).toBe(false);
    // Review N1: a Topic reference names its reviewed program, and its code lines are part of it.
    const withReference = (reference: Record<string, unknown>) => ({ ...topic, questions: [{ ...topic.questions[0], reference: { ...topic.questions[0]!.reference, ...reference } }] });
    expect(curriculumTopicSchema.safeParse(withReference({ reviewedCode: undefined })).success).toBe(false);
    expect(curriculumTopicSchema.safeParse(withReference({ requiresCode: ["Serial.print(1 << 6);"] })).success).toBe(false);
    expect(curriculumTopicSchema.safeParse(withReference({ reviewedCode: "void setup() {\u0007}" })).success).toBe(false);
    const annotated = { ...IT064_ANNOTATION, focus: IT064_ANNOTATION.focus!.map((area) => ({ ...area, questions: area.questions.map((question) => question.reference ? { ...question, reference: { ...question.reference, reviewedCode: IT064_SKETCH } } : question) })) };
    expect(embeddedTutorAnnotationSchema.safeParse(annotated).success).toBe(false);
  });

  it("resolve a Topic reference against its reviewed program", () => {
    const reviewedCode = "void setup() {\n  Serial.begin(9600);\n  Serial.print(1 << 7);\n}\nvoid loop() {}\n";
    const question = { id: "shift-q1", text: "Welche Zahl ergibt `1 << 7`?", reference: { answer: "128", explanation: "2 hoch 7.", requiresCode: ["Serial.print(1 << 7);"], reviewedCode } };
    const content = { ...it064Content(), exampleTutorAnnotation: undefined, exampleProgram: undefined, tutor: { status: "valid", topics: [{ schemaVersion: 3, questions: [question] }] } } as unknown as ReturnType<typeof it064Content>;
    expect(resolveQuestionReference(question.text, { code: reviewedCode }, content)).toMatchObject({ status: "available" });
    expect(resolveQuestionReference(question.text, { code: reviewedCode.replace("Serial.print(1 << 7);", "Serial.print(1 << 7);\n  Serial.print(1 << 6);") }, content))
      .toEqual({ status: "unavailable", reason: "not-applicable" });
  });

  it("are resolved for the asked question from the pinned Course Content, never for other questions", () => {
    const content = it064Content();
    const program = (code: string) => ({ code, headers: [] });
    expect(resolveQuestionReference(IT064_PREDICTION_QUESTION, program(IT064_SKETCH), content)).toEqual({ status: "available", reference: IT064_REFERENCE });
    expect(resolveQuestionReference("Eine freie Frage?", program(IT064_SKETCH), content)).toEqual({ status: "unavailable", reason: "no-reference" });
    expect(resolveQuestionReference(IT064_PREDICTION_QUESTION, program(IT064_SKETCH.replace("Serial.print(a & (1 << i) && 1);", "Serial.print(!(a & (1 << i) && 1));")), content))
      .toEqual({ status: "unavailable", reason: "not-applicable" });
    expect(resolveQuestionReference(IT064_PREDICTION_QUESTION, program(IT064_SKETCH))).toEqual({ status: "unavailable", reason: "no-reference" });
    // Without the Example's reviewed program, the focus reference cannot be bound and is not applicable.
    expect(resolveQuestionReference(IT064_PREDICTION_QUESTION, program(IT064_SKETCH), { ...content, exampleProgram: undefined }))
      .toEqual({ status: "unavailable", reason: "not-applicable" });
  });
});

describe("learner inputs (LearningQuestions R-SUP-1)", () => {
  it.each([
    ["1", "answer"],
    ["200 = 1", "answer"],
    ["Ist es 1?", "answer"],
    ["Eine 1, weil Bit 7 gesetzt ist.", "answer"],
    ["0", "answer"],
    ["Ich weiß nicht", "help"],
    ["weiss ich nicht", "help"],
    ["Weiß ich leider nicht.", "help"],
    ["Keine Ahnung.", "help"],
    ["Ich brauche einen Tipp", "help"],
    ["?", "help"],
    ["Was ist mit dem ersten Durchlauf gemeint?", "clarification"],
    ["Ich verstehe die Frage nicht.", "clarification"],
    ["Welchen Ausdruck meinst du?", "clarification"],
    ["Was bedeutet &&?", "clarification"],
    // Review R4: the usual ways to ask what the question means.
    ["Ich verstehe das nicht.", "clarification"],
    ["Verstehe ich nicht", "clarification"],
    ["Kannst du mir die Frage erklären?", "clarification"],
    ["Kannst du das bitte anders erklären?", "clarification"],
    ["Erklär mir die Aufgabe", "clarification"],
    ["Was muss ich hier machen?", "clarification"],
    ["Was soll ich angeben?", "clarification"],
    ["Wie ist das gemeint?", "clarification"],
    ["Worum geht es?", "clarification"],
    ["Ich komme nicht weiter", "help"],
    ["Hilf mir bitte", "help"],
    // Answers that only look similar stay answers.
    ["Es wird 1 ausgegeben, das verstehe ich.", "answer"],
    ["Die Schleife zählt herunter, damit Bit 7 zuerst kommt.", "answer"],
  ] as const)("treats %j as %s", (input, kind) => {
    expect(classifyLearnerInput(input)).toBe(kind);
  });
});

describe("clarification, hint and grading guards (R-SUP-2, R-SUP-7, R-SUP-8)", () => {
  const result = (feedback: string) => ({ responseStyle: "normal" as const, question: IT064_PREDICTION_QUESTION, feedback });

  it("accepts an explanation and rejects code, a recognizable reference answer and a repeated clarification", () => {
    const input = { kind: "clarify" as const, question: IT064_PREDICTION_QUESTION, earlierClarifications: [] };
    expect(validateSupportExplanation(result("Gemeint ist der Durchlauf mit i = 7."), input)).toBe("Gemeint ist der Durchlauf mit i = 7.");
    expect(() => validateSupportExplanation(result("```cpp\nSerial.print(1);\n```"), input)).toThrow();
    const reference = { answer: "128", explanation: "2 hoch 7.", requiresCode: ["Serial.print(1 << 7);"] };
    expect(() => validateSupportExplanation(result("Das Ergebnis ist 128."), { ...input, reference })).toThrow();
    const earlier = "Gemeint ist der allererste Schleifendurchlauf mit dem Startwert sieben.";
    expect(() => validateSupportExplanation(result("Gemeint ist der allererste Schleifendurchlauf mit dem Startwert sieben."), { ...input, earlierClarifications: [earlier] })).toThrow();
    expect(validateSupportExplanation(result("Schau nur auf den Serial.print-Aufruf in der Schleife."), { ...input, earlierClarifications: [earlier] })).toBeTruthy();
  });

  it("corrects a contradicting rating with the reviewed reference and leaves an open answer to the Tutor", () => {
    const rated = (answerRating: 1 | 2 | 3 | 4 | 5, feedback: string) => ({ ...result(feedback), answerRating });
    expect(applyReferenceGrade(rated(2, "Falsch, 0."), "1", IT064_REFERENCE)).toMatchObject({ answerRating: 5, feedback: "Richtig, das ist die gesuchte Antwort." });
    expect(applyReferenceGrade(rated(5, "Richtig."), "0", IT064_REFERENCE)).toMatchObject({ answerRating: 2 });
    expect(applyReferenceGrade(rated(5, "Richtig."), "0", IT064_REFERENCE).feedback).not.toContain("1");
    // Review R3: a rating already in the allowed band does not keep a feedback that contradicts the reference.
    expect(applyReferenceGrade(rated(4, "Falsch, die Ausgabe ist 0."), "1", IT064_REFERENCE)).toMatchObject({ answerRating: 5, feedback: "Richtig, das ist die gesuchte Antwort." });
    const wrongPraised = applyReferenceGrade(rated(1, "Richtig, die Ausgabe ist 0."), "0", IT064_REFERENCE);
    expect(wrongPraised.answerRating).toBe(1);
    expect(wrongPraised.feedback).not.toMatch(/richtig/i);
    expect(applyReferenceGrade(rated(3, "Teilweise."), "Eine Eins", IT064_REFERENCE)).toMatchObject({ answerRating: 3 });
    expect(applyReferenceGrade(rated(2, "Falsch."), "1", undefined)).toMatchObject({ answerRating: 2 });
  });

  it("tells the Tutor that values set by the question come before the sketch's, in grading and in clarification", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain("rechne mit diesen statt mit den Werten im Sketch");
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).toContain("rechne mit diesen statt mit den Werten im Sketch");
    const prompt = buildSupportPrompt({ kind: "clarify", question: IT064_PREDICTION_QUESTION, code: IT064_SKETCH, context: {}, earlierClarifications: [] });
    expect(prompt).toContain("gelten vor den Werten im Sketch");
    expect(prompt).toContain("Nenne weder den gesuchten Wert");
  });
});

describe("learning-support store (R-SUP-1, R-SUP-6)", () => {
  const limits = { ttlMs: 60_000, maxSessions: 10, maxSessionsPerSubject: 2 };

  it("unlocks skipping at two clarifications and the reference answer at three attempts, never earlier", () => {
    let question = newSupportQuestion("Frage?", "ctx");
    const view = () => supportStateView("s", question, true);
    expect(view()).toMatchObject({ canSkip: false, canRevealReference: false });
    question = withClarification(question, "eins");
    expect(view().canSkip).toBe(false);
    question = withClarification(question, "zwei");
    expect(view()).toMatchObject({ canSkip: true, canRevealReference: false });
    question = { ...question, answerAttempts: 2 };
    expect(view().canRevealReference).toBe(false);
    question = { ...question, answerAttempts: 3 };
    expect(view().canRevealReference).toBe(true);
    question = { ...question, answerAttempts: 7, clarifications: 9 };
    expect(view()).toMatchObject({ canSkip: true, canRevealReference: true });
    expect(supportStateView("s", { ...question, outcome: "skipped" }, true)).toMatchObject({ canSkip: false, canRevealReference: false });
  });

  it("applies an action once; a retry gets the stored result, other data a conflict, a failure nothing", async () => {
    const store = new TutorSupportStore(limits);
    const session = store.open("a", newSupportQuestion("Frage?", "ctx"));
    const count = async (actionId: string, fingerprint = "f") => store.run("a", session, actionId, fingerprint, async (view) => {
      const next = withClarification(view.question!, `t${view.question!.clarifications}`);
      return { body: next.clarifications, update: { question: next } };
    });
    expect(await count("x")).toEqual({ status: "ok", body: 1 });
    expect(await count("x")).toEqual({ status: "ok", body: 1 });
    expect(await count("x", "other")).toEqual({ status: "conflict" });
    await expect(store.run("a", session, "y", "f", async () => { throw new Error("provider down"); })).rejects.toThrow("provider down");
    expect(store.view("a", session)?.question?.clarifications).toBe(1);
    expect(await count("y")).toEqual({ status: "ok", body: 2 });
    expect(await store.run("b", session, "z", "f", async () => ({ body: 0, update: {} }))).toEqual({ status: "missing" });
  });

  it("runs actions of one session one after another and joins a duplicate that is still running", async () => {
    const store = new TutorSupportStore(limits);
    const session = store.open("a", newSupportQuestion("Frage?", "ctx"));
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = store.run("a", session, "slow", "f", async (view) => {
      order.push(`slow sees ${view.question!.clarifications}`);
      await gate;
      return { body: "slow", update: { question: withClarification(view.question!, "slow") } };
    });
    const duplicate = store.run("a", session, "slow", "f", async () => ({ body: "never", update: {} }));
    const fast = store.run("a", session, "fast", "f", async (view) => {
      order.push(`fast sees ${view.question!.clarifications}`);
      return { body: "fast", update: {} };
    });
    release();
    expect(await duplicate).toEqual({ status: "ok", body: "slow" });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow sees 0", "fast sees 1"]);
  });

  it("does not run an action again after its stored result was evicted (review R7)", async () => {
    const store = new TutorSupportStore(limits);
    const session = store.open("a", newSupportQuestion("Frage?", "ctx"));
    const clarify = (actionId: string) => store.run("a", session, actionId, "f", async (view) => {
      const next = withClarification(view.question!, `t${actionId}`);
      return { body: next.clarifications, update: { question: next } };
    });
    expect(await clarify("first")).toEqual({ status: "ok", body: 1 });
    for (let hint = 0; hint < 32; hint += 1) {
      await store.run("a", session, `hint-${hint}`, "f", async () => ({ body: "hint", update: {} }));
    }
    expect(await clarify("first")).toEqual({ status: "spent" });
    expect(store.view("a", session)?.question?.clarifications).toBe(1);
  });

  it("saturates the unlock counters at two clarifications and three attempts (R-SUP-1)", () => {
    let question = newSupportQuestion("Frage?", "ctx");
    for (let round = 0; round < 5; round += 1) question = withAnswerAttempt(withClarification(question, `t${round}`));
    expect(question).toMatchObject({ clarifications: 2, answerAttempts: 3 });
  });

  it("binds a session to the Course session it was opened with", () => {
    const store = new TutorSupportStore(limits);
    const course = store.open("a", newSupportQuestion("Frage?", "ctx"), "course-1");
    const free = store.open("a", newSupportQuestion("Frage?", "ctx"));
    expect(store.view("a", course)?.courseSession).toBe("course-1");
    expect(store.view("a", free)?.courseSession).toBeNull();
  });

  it("bounds sessions per subject and expires them", async () => {
    let now = 0;
    const store = new TutorSupportStore(limits, () => now);
    const first = store.open("a", newSupportQuestion("1?", "ctx"));
    store.open("a", newSupportQuestion("2?", "ctx"));
    store.open("a", newSupportQuestion("3?", "ctx"));
    expect(store.view("a", first)).toBeNull();
    expect(store.stats()).toEqual({ sessions: 2, subjects: 1 });
    now = 60_000;
    expect(store.stats()).toEqual({ sessions: 0, subjects: 0 });
  });
});
