import { describe, expect, it } from "vitest";
import { analyzeCatalogSession, findUnsupportedTypeMentions, questionSimilarity } from "../../../../../server/services/tutor/evaluation/catalog-checks";

const millis = "void loop() {\n  unsigned long zeit = millis();\n  Serial.println(zeit);\n}\n// long ist hier nur Kommentar\n";

describe("findUnsupportedTypeMentions", () => {
  it("flags long for an unsigned long sketch", () => {
    expect(findUnsupportedTypeMentions("Welche Information wird in einem long-Wert gespeichert?", millis)).toEqual(["long"]);
  });
  it("accepts unsigned long and ignores German words", () => {
    expect(findUnsupportedTypeMentions("Warum eignet sich `unsigned long` für die Zeit? Das ist lang und intensiv.", millis)).toEqual([]);
  });
  it("flags types absent from the code", () => {
    expect(findUnsupportedTypeMentions("Warum ist float hier nötig?", millis)).toEqual(["float"]);
  });
});

describe("analyzeCatalogSession", () => {
  const turn = (question: string, followUpSource: "planner" | "provider" = "planner", feedback?: string) => ({ question, followUpSource, ...(feedback ? { feedback } : {}) });

  it("reports a clean focus-then-free session as clean", () => {
    expect(analyzeCatalogSession({
      code: millis,
      focusQuestions: ["In welcher Einheit liefert millis die Zeit?"],
      turns: [turn("In welcher Einheit liefert `millis()` die Zeit?"), turn("Warum unsigned long?"), turn("Was passiert bei Überlauf?", "provider")],
    })).toEqual([]);
  });

  it("flags repeats, planner after free mode and unasked focus", () => {
    const codes = analyzeCatalogSession({
      code: millis,
      focusQuestions: ["In welcher Einheit liefert millis die Zeit?"],
      turns: [turn("Etwas völlig anderes über Schleifen und Zähler?", "provider"), turn("Etwas völlig anderes über Schleifen und Zähler?", "provider"), turn("Frage", "planner")],
    }).map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining(["question-repeated", "planner-after-free", "focus-question-not-asked"]));
  });

  it("measures similarity", () => {
    expect(questionSimilarity("a b c", "a b c")).toBe(1);
    expect(questionSimilarity("a b", "c d")).toBe(0);
  });
});
