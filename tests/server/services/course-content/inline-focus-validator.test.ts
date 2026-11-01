import { describe, expect, it } from "vitest";
import { validateInlineFocus } from "../../../../server/services/course-content/inline-focus-validator";
import type { ExampleTutorAnnotation } from "../../../../server/services/course-content/embedded-tutor-annotation";

const annotation = (text: string): ExampleTutorAnnotation => ({
  schemaVersion: 2,
  focus: [{ id: "zeit", title: "Zeit", objective: "Zeitwert einordnen.", questions: [{ kind: "concept", text }] }],
});

describe("validateInlineFocus", () => {
  const code = "unsigned long t = millis();\n// long ist hier nur ein Kommentar\n";

  it("accepts code terms that occur in the sketch", () => {
    expect(validateInlineFocus([{ id: "e", code, annotation: annotation("Warum `unsigned long` für `millis()`?") }])).toEqual([]);
  });

  it("flags a code term that only occurs in a comment or not at all", () => {
    const issues = validateInlineFocus([{ id: "e", code: "unsigned long t = 1;\n// struct\n", annotation: annotation("Was macht `struct` hier?") }]);
    expect(issues).toMatchObject([{ code: "inline-focus-term-not-in-sketch", exampleId: "e", conceptId: "zeit" }]);
  });

  it("matches identifier terms as whole words", () => {
    const issues = validateInlineFocus([{ id: "e", code: "Serial.println(x);\n", annotation: annotation("Was wäre bei `int` anders?") }]);
    expect(issues).toMatchObject([{ code: "inline-focus-term-not-in-sketch" }]);
  });

  it.each([
    ["inline-focus-question-without-term", "Was geschieht hier?"],
    ["inline-focus-multiple-questions", "Was tut `millis()`? Und wann?"],
    ["inline-focus-complete-solution", "Passt `millis()` zu ```void loop() {}```?"],
  ])("flags %s", (issue, text) => {
    expect(validateInlineFocus([{ id: "e", code, annotation: annotation(text) }]).map((found) => found.code)).toContain(issue);
  });

  it.each([
    ["Definition nennen wir die gleichzeitige Deklaration und Initialisierung."],
    ["Deklaration + Initialisierung = Definition"],
    ["Deklaration und Zuweisung in einem Schritt ist möglich."],
    ["Eine Definition ist eine Deklaration mit Initialisierung."],
    ["`int a;` ist nur eine Deklaration."],
    ["`int a = 0;` ist nur eine Deklaration."],
    ["`extern int b;` passt, aber `const byte PIN = 2;` ist nur eine Deklaration."],
  ])("rejects the older wording %s in a question and in a sketch comment", (wording) => {
    const issues = validateInlineFocus([
      { id: "frage", code, annotation: annotation(`${wording} Gilt das für \`millis()\`?`) },
      { id: "kommentar", code: `// ${wording}\n${code}`, annotation: annotation("Was liefert `millis()`?") },
    ]);
    expect(issues.filter((issue) => issue.code === "inline-focus-non-cpp-terms").map((issue) => issue.exampleId)).toEqual(["frage", "kommentar"]);
  });

  it.each([
    ["Eine Definition ist zugleich eine Deklaration."],
    ["Die Definition von `millis()` ist eine Funktion."],
    ["Direkte Initialisierung eines Arrays"],
    ["`extern int a;` ist eine reine Deklaration."],
    ["`extern int a;` ist nur eine Deklaration."],
    ["`void f();` ist nur eine Deklaration."],
    ["`int a;` ist nicht nur eine Deklaration, sondern auch eine Definition."],
    ["Eine Definition ist zugleich eine Deklaration, eine explizite Initialisierung ist nicht erforderlich."],
    ["Eine Definition ist eine Deklaration mit oder ohne Initialisierung."],
    ["Eine Definition ist nicht Deklaration und Initialisierung."],
    ["Falsch ist: Definition = Deklaration + Initialisierung."],
    ["Die Formel Deklaration + Initialisierung = Definition stimmt nicht."],
    ["Das ist keine Deklaration und Zuweisung in einem Schritt, sondern eine Initialisierung."],
  ])("accepts %s", (wording) => {
    const issues = validateInlineFocus([
      { id: "e", code: `// ${wording}\n${code}`, annotation: { ...annotation("Was liefert `millis()`?"), learningObjectives: [wording] } },
    ]);
    expect(issues).toEqual([]);
  });

  it("accepts a pure declaration named in code, whatever else the sketch defines", () => {
    const sketch = `int a;\nextern int b; // Das ist nur eine Deklaration.\n${code}`;
    expect(validateInlineFocus([{ id: "e", code: sketch, annotation: annotation("Was liefert `millis()`?") }])).toEqual([]);
  });

  it.each([
    ["int a; // nur eine Deklaration"],
    ["/*\n * Definition nennen wir die gleichzeitige\n * Deklaration und Initialisierung.\n */"],
    ["// Definition nennen wir die gleichzeitige\n// Deklaration und Initialisierung."],
  ])("rejects %j in the sketch source", (source) => {
    const issues = validateInlineFocus([{ id: "e", code: `${source}\n${code}`, annotation: annotation("Was liefert `millis()`?") }]);
    expect(issues.map((issue) => issue.code)).toContain("inline-focus-non-cpp-terms");
  });

  it("ignores examples without focus", () => {
    expect(validateInlineFocus([{ id: "e", code, annotation: { schemaVersion: 2 } }])).toEqual([]);
  });
});
