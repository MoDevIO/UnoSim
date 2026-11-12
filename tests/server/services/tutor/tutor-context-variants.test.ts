import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TutorService, buildTutorContext } from "../../../../server/services/tutor/tutor-service";
import { applyReferenceGrade } from "../../../../server/services/tutor/learning-support";
import { resolveQuestionReference } from "../../../../server/services/tutor/question-reference";
import { referenceAppliesTo } from "../../../../server/services/tutor/curriculum/reference-answer";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import type { CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { IT064_PREDICTION_QUESTION, IT064_REFERENCE, IT064_SKETCH, it064Content } from "./fixtures/it06-4";

/**
 * Sketch variants and reference binding (Plan Aufgabe 4). Context preparation, fact extraction and the
 * reference resolution are real. The provider only records what is sent. The dice sketch is a fixture
 * of this plan (Anhang A); its reference facts are read off the source text below, by plain text
 * operations that are independent of the product's fact extraction.
 */

const DICE = readFileSync(path.resolve(process.cwd(), "tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino"), "utf8");
const facts = new DefaultSketchFactExtractor();

/** The text of the function `name`: from its signature to the matching closing brace. */
function functionBody(code: string, name: string): string {
  const start = code.search(new RegExp(String.raw`^void ${name}\(`, "m"));
  expect(start, `function ${name} exists`).toBeGreaterThanOrEqual(0);
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}") depth -= 1;
    if (depth === 0) return code.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/** Lines that are not a `//` comment: a deliberately simple reading, valid for this fixture only. */
const activeLines = (code: string): string[] => code.split("\n").filter((line) => !line.trimStart().startsWith("//"));

async function promptFor(code: string, source: Parameters<typeof buildTutorContext>[1] = "uno"): Promise<string> {
  const generateLearningQuestion = vi.fn().mockResolvedValue({ model: "m", result: { question: "Welche Rolle hat BTN?" } });
  const service = new TutorService({ listModels: vi.fn().mockResolvedValue(["m"]), generateLearningQuestion });
  await service.generateQuestion(code, "key", undefined, 30, undefined, undefined, typeof source === "string" ? { board: source } : source);
  expect(generateLearningQuestion).toHaveBeenCalledTimes(1);
  return generateLearningQuestion.mock.calls[0]![0].userPrompt as string;
}

const callsOf = (code: string, source: Parameters<typeof buildTutorContext>[1] = "uno") =>
  buildTutorContext(code, source).staticIO.pins.map(({ pinId, calls }) => ({ pinId, calls: calls.map(({ op, sourceExpression, mode }) => ({ op, sourceExpression, mode })) }));

describe("CV-01: the dice sketch fixture says what the plan says it says", () => {
  it("has no Serial output call in show; Serial.begin only initializes; the println line is commented out", () => {
    expect(functionBody(DICE, "show")).not.toContain("Serial");
    expect(functionBody(DICE, "setup")).toContain("Serial.begin(115200);");
    expect(DICE.split("\n").filter((line) => line.includes("Serial.println"))).toEqual(["//Serial.println(state);"]);
    expect(activeLines(DICE).filter((line) => /Serial\s*\.\s*(print|println|write)\s*\(/.test(line))).toEqual([]);
  });

  it("declares t as a local static unsigned long that is never updated, and never calls switchInit", () => {
    const body = functionBody(DICE, "switchInit");
    expect(body).toContain("static unsigned long t;");
    // every occurrence of the identifier t in the body: the declaration and one read in the condition
    const uses = [...body.matchAll(/\bt\b/g)].length;
    expect(uses).toBe(2);
    expect(body).toContain("millis()-t>100");
    expect(body).not.toMatch(/\bt\s*(=|\+=|-=|\+\+|--)/);
    expect([...DICE.matchAll(/\bswitchInit\b/g)]).toHaveLength(1);
    expect([...DICE.matchAll(/\bunsigned long t\b/g)]).toHaveLength(1); // t is declared only once
  });

  it("is seen by the fact extraction as an array and type use, without any Serial call", () => {
    const extracted = facts.extract(DICE);
    expect(extracted.serialCalls).toEqual([]);
    expect(extracted.typesUsed).toEqual(["byte", "int", "long"]);
    expect(extracted.arrays[0]).toEqual({ name: "PINS", elementType: "byte", elementCount: 9 });
  });

  it("sends the sketch together with the deterministic context and no active Serial call in it", async () => {
    const prompt = await promptFor(DICE);
    expect(prompt).toContain(DICE);
    expect(prompt).toContain('"symbols":{"BTN":7,"ms":50,"idx":0}');
    expect(prompt).toContain('"arrays":[{"name":"PINS","elementCount":9,"firstIndex":0,"lastIndex":8}]');
    expect(buildTutorContext(DICE, "uno").staticIO.pins).toHaveLength(1); // only BTN (pin 7) is resolvable; the loops use i
    const contextJson = JSON.stringify(buildTutorContext(DICE, "uno"));
    expect(contextJson).not.toMatch(/Serial/);
  });
});

describe("CV-02: comments and consistent renaming do not change what is active", () => {
  const commented = DICE.replace("  delay(250);\n}", "  // Serial.println(\"warte\");\n  /* Serial.print(state); */\n  delay(250);\n}");
  const stripped = DICE.replace("//Serial.println(state);\n", "");
  const renamed = DICE.replaceAll("BTN", "BUTTON").replace("static unsigned long t;", "static unsigned long lastToggle;").replace("millis()-t>100", "millis()-lastToggle>100");

  it.each([["added comments", commented], ["removed comment", stripped], ["renamed variables", renamed]])("%s: no Serial call becomes active, facts stay the same", (_name, variant) => {
    expect(variant).not.toBe(DICE);
    expect(facts.extract(variant)).toEqual(facts.extract(DICE));
    expect(facts.extract(variant).serialCalls).toEqual([]);
  });

  it("the call facts of the variants agree where the variant is semantically equal", () => {
    expect(callsOf(commented)).toEqual(callsOf(DICE));
    expect(callsOf(stripped)).toEqual(callsOf(DICE));
    const original = callsOf(DICE);
    const renamedCalls = callsOf(renamed);
    expect(renamedCalls.map(({ pinId, calls }) => ({ pinId, ops: calls.map((call) => call.op) })))
      .toEqual(original.map(({ pinId, calls }) => ({ pinId, ops: calls.map((call) => call.op) })));
    expect(renamedCalls[0]!.calls.map((call) => call.sourceExpression)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
  });

  it("the provider prompt carries the current names and not the old ones", async () => {
    const prompt = await promptFor(renamed);
    expect(prompt).toContain('"symbols":{"BUTTON":7');
    expect(prompt).toContain("lastToggle");
    expect(prompt).not.toMatch(/\bBTN\b/);
    expect(prompt).not.toContain("millis()-t>100");
  });
});

describe("CV-03: an active Serial call changes the fact and the applicability of a question", () => {
  const activated = DICE.replace("//Serial.println(state);", "Serial.println(state);");
  const question = {
    id: "serial-question", concept: "serial", indicator: "serial-use", kind: "concept" as const, difficulty: [1, 100] as [number, number],
    requires: [{ fact: "serial-call" as const, values: ["print"] }], text: "Was gibt Serial.println aus?",
  };
  const topic: CurriculumTopic = {
    schemaVersion: 1, id: "serial-output", title: "Serielle Ausgabe", locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "serial", title: "Ausgabe", objective: "Ausgabe erklären", prerequisites: [], difficulty: { entry: [1, 100], transfer: [1, 100] }, misconceptions: [],
      indicators: [{ id: "serial-use", description: "Ausgabe" }],
      mastery: { minimumSuccessfulProbes: 1, successRatingAtLeast: 3, requiredIndicators: ["serial-use"], minimumDistinctQuestionKinds: 1, recentWeakAnswersAllowed: 0 },
    }],
    questions: [question], scaffolds: [],
    progression: { entryConcepts: ["serial"], preferredOrder: ["serial"], onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" } },
  };
  const courseContent = () => ({
    revision: "a".repeat(40),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [topic], strategies: [] },
    progressionState: createTutorProgressionState("a".repeat(40)),
  });
  const plan = (code: string) => new CurriculumTutorAdapter().planInitial({ code, history: [], difficulty: 30, courseContent: courseContent() });

  it("the activated println is a print fact; the commented one is none", () => {
    expect(facts.extract(activated).serialCalls).toEqual(["print"]);
    expect(facts.extract(DICE).serialCalls).toEqual([]);
  });

  it("the serial question applies only to the variant with the active call", async () => {
    expect(await plan(DICE)).toBeNull();
    expect(await plan(DICE.replace("//Serial.println(state);", "/* Serial.println(state); */"))).toBeNull();
    expect(await plan(activated)).toMatchObject({ questionId: "serial-question", question: "Was gibt Serial.println aus?" });
  });
});

describe("CV-04: a declaration moved to a header is counted once; a meaningful header voids a reference", () => {
  const pinsLine = DICE.split("\n")[0]!;
  const moved = DICE.replace(`${pinsLine}\n`, '#include "pins.h"\n');
  const header = [{ name: "pins.h", content: `${pinsLine}\n` }];

  it("the array is declared once, in the header, and the context sees one capacity of 9", async () => {
    const context = buildTutorContext(moved, { board: "uno", headers: header, entryFile: "dice.ino" });
    expect(context.arrays).toEqual([{ name: "PINS", elementCount: 9, firstIndex: 0, lastIndex: 8 }]);
    const prompt = await promptFor(moved, { board: "uno", headers: header, entryFile: "dice.ino" });
    expect([...prompt.matchAll(/const byte PINS\[\]=\{2,3,4,5,8,10,11,12,13\};/g)]).toHaveLength(1);
    expect(prompt).toContain("// ---- Datei pins.h ----");
    const inMain = buildTutorContext(DICE, "uno");
    expect(context.arrays).toEqual(inMain.arrays);
  });

  it("an unreviewed header voids a reference that held for the lone sketch; the identical header does not", () => {
    const reviewed = { code: IT064_SKETCH, headers: [] };
    expect(referenceAppliesTo(IT064_REFERENCE as never, { code: IT064_SKETCH, headers: [] }, reviewed)).toBe(true);
    const withHeader = { code: `#include "defs.h"\n${IT064_SKETCH}`, headers: [{ name: "defs.h", content: "#define BIN 2\n" }] };
    expect(referenceAppliesTo(IT064_REFERENCE as never, withHeader, reviewed)).toBe(false);

    const reviewedWithHeader = { code: IT064_SKETCH, headers: [{ name: "defs.h", content: "const int K = 1;\n" }] };
    expect(referenceAppliesTo(IT064_REFERENCE as never, { code: IT064_SKETCH, headers: [{ name: "defs.h", content: "const int K = 1;\n" }] }, reviewedWithHeader)).toBe(true);
    expect(referenceAppliesTo(IT064_REFERENCE as never, { code: IT064_SKETCH, headers: [{ name: "defs.h", content: "const int K = 2;\n" }] }, reviewedWithHeader)).toBe(false);
  });
});

describe("CV-05: the reference is bound to the exact program; the same model rating then leads to different outcomes", () => {
  const QUESTION = IT064_PREDICTION_QUESTION; // the focus question that carries the reviewed reference
  const modelResult = { responseStyle: "normal" as const, question: "Nächste Frage?", answerRating: 1 as const, feedback: "Falsch, es wird 0 ausgegeben." };
  const content = () => ({ ...it064Content(), tutor: it064Content().tutor });
  const resolve = (code: string, board?: "uno" | "mega2560") =>
    resolveQuestionReference(QUESTION, { code, headers: [], ...(board ? { board } : {}) }, content() as never);

  it("under the reviewed sketch the reference decides: the model's 1 star and 'Falsch' become a correct answer", () => {
    const resolved = resolve(IT064_SKETCH);
    expect(resolved.status).toBe("available");
    if (resolved.status !== "available") return;
    const graded = applyReferenceGrade(modelResult, "1", resolved.reference);
    expect(graded.answerRating).toBe(5);
    expect(graded.feedback).toBe("Richtig, das ist die gesuchte Antwort.");
  });

  it("the question's own assumption may change the initial value only: a = 37 -> 200 keeps the reference", () => {
    expect(resolve(IT064_SKETCH.replace("byte a = 37;", "byte a = 200;")).status).toBe("available");
  });

  it.each([
    ["a statement in the loop changed", IT064_SKETCH.replace("a & (1 << i) && 1", "bitRead(a, i)"), undefined],
    ["a line inserted", IT064_SKETCH.replace("void loop() {", "void loop() {\n  a = 0;"), undefined],
    ["a comment added", IT064_SKETCH.replace("void loop() {", "// neu\nvoid loop() {"), undefined],
    ["the type of a changed", IT064_SKETCH.replace("byte a = 37;", "int a = 37;"), undefined],
    ["the literal gets a suffix", IT064_SKETCH.replace("byte a = 37;", "byte a = 37u;"), undefined],
    ["a macro before the declaration", `#define byte int\n${IT064_SKETCH}`, undefined],
    ["spacing inside an expression", IT064_SKETCH.replace("a & (1 << i)", "a  & (1 << i)"), undefined],
    ["another board with identical code", IT064_SKETCH, "mega2560" as const],
  ])("%s: the reference no longer applies, so the same model rating stays as it is", (_name, code, board) => {
    const resolved = resolve(code, board);
    expect(resolved).toEqual({ status: "unavailable", reason: "not-applicable" });
    // Without a reference nothing corrects the model: the identical rating is delivered unchanged.
    expect(applyReferenceGrade(modelResult, "1", undefined)).toBe(modelResult);
  });
});
