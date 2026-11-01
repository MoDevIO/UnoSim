import { describe, expect, it, vi } from "vitest";
import type { TutorDialogTurn } from "@shared/tutor";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { focusQuestionFilter } from "../../../../server/services/tutor/curriculum/focus-applicability";
import { buildInlineFocusTopic } from "../../../../server/services/tutor/curriculum/inline-focus-topic";
import { collectObservations, collectUsedQuestionIds } from "../../../../server/services/tutor/curriculum/learning-planner";
import type { ExampleFocusArea } from "../../../../server/services/course-content/embedded-tutor-annotation";
import { buildTutorContext, inspectLearningQuestion, TutorService } from "../../../../server/services/tutor/tutor-service";

const SKETCH = `const byte PIN_LED = 13;
byte werte[3] = {1, 2, 3};
void setup() { pinMode(PIN_LED, OUTPUT); }
void loop() { digitalWrite(PIN_LED, HIGH); delay(werte[1]); }
`;
const focus: ExampleFocusArea[] = [
  { id: "pin", title: "Der Pin", objective: "Den Pin einrichten.", questions: [
    { kind: "concept", text: "Welche Aufgabe hat `pinMode` für `PIN_LED`?" },
    { kind: "concept", text: "Was bewirkt `digitalWrite` an `PIN_LED`?" },
  ] },
  { id: "werte", title: "Die Werte", objective: "Das Array lesen.", questions: [
    { kind: "concept", text: "Welchen Wert liefert `werte[1]`?" },
  ] },
];

function content(areas: ExampleFocusArea[] = focus) {
  const revision = "2".repeat(40);
  return {
    revision,
    progressionState: createTutorProgressionState(revision),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleId: "beispiel",
    exampleTutorAnnotation: { schemaVersion: 2 as const, focus: areas },
  };
}

function service(rating = 5, question = "Providerfrage?") {
  const provider = {
    listModels: vi.fn().mockResolvedValue(["m"]),
    generateLearningQuestion: vi.fn().mockResolvedValue({
      model: "m",
      result: { question, feedback: "Rückmeldung.", answerRating: rating, responseStyle: "normal" },
    }),
  };
  return { provider, tutor: new TutorService(provider, new CurriculumTutorAdapter()) };
}

/** One step of the browser's dialog: the turn keeps the asked question's identity, as `use-tutor` does. */
function answered(asked: { question: string; questionId?: string }, rating: 1 | 2 | 3 | 4 | 5): TutorDialogTurn {
  return { question: asked.question, ...(asked.questionId ? { questionId: asked.questionId } : {}), answer: "Antwort", answerRating: rating, responseStyle: "normal" };
}

describe("teacher's focus in a Tutor session", () => {
  it("keeps question, rating and progress together over two area changes", async () => {
    const { tutor } = service(5);
    const session = content();
    const history: TutorDialogTurn[] = [];
    let asked = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;
    const seen = [asked.question];
    for (let turn = 0; turn < 2; turn += 1) {
      const next = (await tutor.generateDialogResponse(SKETCH, history, asked.question, "Antwort", "key", undefined, 30, session)).result;
      history.push(answered(asked, 5));
      asked = next;
      seen.push(asked.question);
    }

    expect(seen).toEqual(focus.flatMap(({ questions }) => questions.map(({ text }) => text)));
    expect(asked.focusProgress).toEqual({ state: "active", understoodAreas: 1, totalAreas: 2, openAreas: ["Die Werte"] });
    expect(session.progressionState.masteryEvidence["inline-beispiel"]?.map(({ questionId }) => questionId))
      .toEqual(["pin-q1", "pin-q2"]);
  });

  it("does not move a rating to the question a mismatched ID names", () => {
    const topic = buildInlineFocusTopic("beispiel", focus)!;
    const mismatched = answered({ question: focus[0]!.questions[0]!.text, questionId: "werte-q1" }, 5);

    expect(collectObservations(topic, [mismatched]).map(({ questionId }) => questionId)).toEqual(["pin-q1"]);
    expect([...collectUsedQuestionIds(topic, [mismatched])]).toEqual(["pin-q1"]);
  });

  it("asks once more after a weak answer, with the hint in the feedback, and then moves on and reports the open area", async () => {
    const { tutor, provider } = service(1);
    const session = content([focus[1]!]);
    const asked = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;
    const again = (await tutor.generateDialogResponse(SKETCH, [], asked.question, "falsch", "key", undefined, 30, session)).result;
    expect(again.question).toBe(asked.question);
    expect(again.feedback).toBe("Rückmeldung.");
    expect(provider.generateLearningQuestion.mock.calls.at(-1)?.[0].userPrompt).toContain("noch einmal gestellt");

    const history = [answered(asked, 1)];
    const free = (await tutor.generateDialogResponse(SKETCH, history, asked.question, "falsch", "key", undefined, 30, session)).result;
    expect(free.question).toBe("Providerfrage?");
    expect(free.focusProgress).toEqual({ state: "open", understoodAreas: 0, totalAreas: 1, openAreas: ["Die Werte"] });

    await tutor.generateDialogResponse(SKETCH, [...history, answered(asked, 1)], free.question, "weiter", "key", undefined, 30, session);
    expect(provider.generateLearningQuestion.mock.calls.at(-1)?.[0].userPrompt).toContain("Noch nicht sicher gezeigt: Das Array lesen.");
  });

  it("counts a good second attempt at the last question of an area as understood", async () => {
    const weak = service(1);
    const session = content([focus[1]!]);
    const asked = (await weak.tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;
    await weak.tutor.generateDialogResponse(SKETCH, [], asked.question, "falsch", "key", undefined, 30, session);
    const strong = service(5);
    const done = (await strong.tutor.generateDialogResponse(SKETCH, [answered(asked, 1)], asked.question, "richtig", "key", undefined, 30, session)).result;

    expect(done.focusProgress).toEqual({ state: "completed", understoodAreas: 1, totalAreas: 1, openAreas: [] });
    expect(strong.provider.generateLearningQuestion.mock.calls[0]?.[0].userPrompt).toContain("Welchen Wert liefert");
  });

  it("reports a completed focus only after every area was understood", async () => {
    const { tutor } = service(5);
    const session = content([focus[1]!]);
    const asked = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;
    const done = (await tutor.generateDialogResponse(SKETCH, [], asked.question, "gut", "key", undefined, 30, session)).result;

    expect(done.focusProgress).toEqual({ state: "completed", understoodAreas: 1, totalAreas: 1, openAreas: [] });
  });

  it("skips a question whose code a small experiment removed and keeps the rest of the focus", async () => {
    const { tutor } = service(5);
    const experiment = SKETCH.replace("delay(werte[1]);", "delay(100);");
    const session = content();
    const asked = (await tutor.generateQuestion(experiment, "key", undefined, 30, session)).result;
    const next = (await tutor.generateDialogResponse(experiment, [], asked.question, "gut", "key", undefined, 30, session)).result;

    expect(asked.question).toBe(focus[0]!.questions[0]!.text);
    expect(next.question).toBe(focus[0]!.questions[1]!.text);
    expect(next.focusProgress?.totalAreas).toBe(1);
  });

  it("pauses the focus for another program and answers from the free Tutor", async () => {
    const { tutor } = service(5);
    const result = (await tutor.generateQuestion("void setup() {}\nvoid loop() {}\n", "key", undefined, 30, content())).result;

    expect(result.question).toBe("Providerfrage?");
    expect(result.questionId).toBeUndefined();
    expect(result.focusProgress).toEqual({ state: "paused", understoodAreas: 0, totalAreas: 2, openAreas: [] });
  });

  it("resumes the focus when the code comes back", async () => {
    const { tutor } = service(5);
    const session = content();
    await tutor.generateQuestion("void setup() {}\nvoid loop() {}\n", "key", undefined, 30, session);
    const result = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;

    expect(result.question).toBe(focus[0]!.questions[0]!.text);
    expect(result.focusProgress?.state).toBe("active");
  });

  it("delivers only final results that meet the quality rules and takes no progress from a rejected one", async () => {
    const twoQuestions = "Was tut `pinMode`? Und was tut `digitalWrite`?";
    const { tutor } = service(5, "Einzelne Frage?");
    const session = content([{ ...focus[0]!, questions: [{ kind: "concept", text: twoQuestions }] }]);
    const first = await tutor.generateQuestion(SKETCH, "key", undefined, 30, session);

    expect(inspectLearningQuestion(first.result).violations).toEqual([]);
    expect(first.result.question).toBe("Einzelne Frage?");
    expect(first.followUpSource).toBe("provider");
    expect(session.progressionState.activeTopicId).toBeUndefined();
  });

  it("never reports a focus for a session without one", async () => {
    const { tutor } = service(5);
    const result = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, { ...content(), exampleTutorAnnotation: { schemaVersion: 2 as const } })).result;
    expect(result).not.toHaveProperty("focusProgress");
  });
});

describe("C++ terms", () => {
  it("tells the provider how declaration, definition, initialization and assignment differ", async () => {
    const { provider, tutor } = service(5);
    await tutor.generateQuestion(SKETCH, "key", undefined, 30, content());
    const { systemPrompt } = provider.generateLearningQuestion.mock.calls[0]?.[0] as { systemPrompt: string };

    expect(systemPrompt).toContain("Eine Variablendefinition ist zugleich eine Deklaration");
    expect(systemPrompt).toContain("`int a;` ist eine Definition ohne ausdrücklichen Initialisierer");
    expect(systemPrompt).toContain("gehört zur Initialisierung, nicht zu einer Zuweisung");
    expect(systemPrompt).toContain("eine lokale `static int`-Variable beginnen ohne ausdrücklichen Initialisierer mit null");
    expect(systemPrompt).toContain("eine lokale automatische `int`-Variable, also ohne `static`, hat dann keinen festgelegten Wert");
  });
});

describe("Tutor context", () => {
  it("rates a repeated question without showing the provider the earlier attempt", async () => {
    const { tutor, provider } = service(5);
    const session = content([focus[1]!]);
    const asked = (await tutor.generateQuestion(SKETCH, "key", undefined, 30, session)).result;
    const earlier = { ...answered(asked, 2), answer: "Die alte falsche Antwort" };
    await tutor.generateDialogResponse(SKETCH, [earlier], asked.question, "Die neue Antwort", "key", undefined, 30, session);

    const prompt = provider.generateLearningQuestion.mock.calls.at(-1)?.[0].userPrompt as string;
    expect(prompt).toContain("Die neue Antwort");
    expect(prompt).not.toContain("Die alte falsche Antwort");
  });

  it("states the last index of an array, because a provider that counts it itself accepted a wrong one", () => {
    expect(buildTutorContext("byte werte[] = {23, 42, 7, 3};\nint leer[N];\n").arrays)
      .toEqual([{ name: "werte", elementCount: 4, firstIndex: 0, lastIndex: 3 }]);
    expect(buildTutorContext("void setup() {}\n")).not.toHaveProperty("arrays");
  });

  it("takes the declared size, not the number of initializers", () => {
    expect(buildTutorContext("byte werte[4] = {23, 42};\n").arrays)
      .toEqual([{ name: "werte", elementCount: 4, firstIndex: 0, lastIndex: 3 }]);
  });

  it.each([
    ["a symbolic size", "const byte N = 4; byte werte[N] = {23, 42};\n"],
    ["a size expression", "byte werte[2 * 2] = {1};\n"],
    ["a two-dimensional array", "int feld[][3] = {{1, 2, 3}, {4, 5, 6}};\nint netz[2][3];\n"],
    ["a character with a comma", "char zeichen[] = {'a', ','};\n"],
  ])("states no bounds for %s, which the text alone does not settle", (_name, code) => {
    expect(buildTutorContext(code)).not.toHaveProperty("arrays");
  });
});

describe("focus applicability", () => {
  it("matches identifiers as whole words and ignores comments", () => {
    const applies = focusQuestionFilter(focus, `${SKETCH}// werte2 digitalWrite2\n`);
    expect(applies("Was tut `werte[1]`?")).toBe(true);
    expect(applies("Was tut `wert`?")).toBe(false);
    expect(focusQuestionFilter([{ ...focus[0]!, questions: [{ kind: "concept", text: "`int`" }, { kind: "concept", text: "`PIN_LED`" }] }], "// int\nint println;\nconst byte PIN_LED = 1;")("`int`")).toBe(true);
  });

  it("keeps the IDs of the whole focus when questions drop out", () => {
    const topic = buildInlineFocusTopic("beispiel", focus, SKETCH.replace("pinMode(PIN_LED, OUTPUT);", ""));
    expect(topic?.questions.map(({ id }) => id)).toEqual(["pin-q2", "werte-q1"]);
    expect(topic?.concepts[0]?.mastery.minimumSuccessfulProbes).toBe(1);
  });
});
