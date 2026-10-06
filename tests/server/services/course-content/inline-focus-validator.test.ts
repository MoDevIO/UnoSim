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

  it("ignores examples without focus", () => {
    expect(validateInlineFocus([{ id: "e", code, annotation: { schemaVersion: 2 } }])).toEqual([]);
  });
});
