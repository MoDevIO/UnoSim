import { describe, expect, it } from "vitest";
import { declaredSketchNames, hasUnanchoredReference } from "../../../../server/services/tutor/question-concreteness";

const sketch = `
#define LED_PIN 13
const float TEMP_MIN = 19.0; // int ignored = 1;
int counter = 0;
void blink(int times) { }
void setup() { Serial.begin(9600); }
void loop() { counter++; }
`;

describe("declaredSketchNames", () => {
  it("collects variables, constants, functions, parameters and macros, without setup, loop and comments", () => {
    expect([...declaredSketchNames(sketch)].sort()).toEqual(["LED_PIN", "TEMP_MIN", "blink", "counter", "times"]);
  });
});

describe("hasUnanchoredReference", () => {
  it.each([
    "Welche Rolle spielt der Datentyp der betrachteten Variable im aktuellen Sketch?",
    "Welchen Wert verwendet der Sketch an der betrachteten Integer-Variablen?",
    "Warum passt der für diese Variable verwendete Datentyp zur im Sketch gespeicherten Information?",
    "Wie verändert sich dieser Wert beim nächsten Schleifendurchlauf?",
    "Was bewirkt die genannte Stelle im Ablauf?",
    "Wie hängt der in der Variable gespeicherte Wert mit der sichtbaren seriellen Ausgabe zusammen?",
  ])("flags a reference that names no element: %s", (question) => {
    expect(hasUnanchoredReference(question)).toBe(true);
    expect(hasUnanchoredReference(question, sketch)).toBe(true);
  });

  it.each([
    "Welche Rolle hat der Serial-Ausgabeaufruf in diesem Sketch?",
    "Unter welcher Bedingung erhöht loop() den Zähler?",
    "Nenne eine Variable aus dem aktuellen Sketch: Wozu wird dieser Wert später verwendet?",
    "Warum hat `counter` den Datentyp int, und wie ändert sich dieser Wert in loop()?",
  ])("accepts a question without a silent reference: %s", (question) => {
    expect(hasUnanchoredReference(question)).toBe(false);
    expect(hasUnanchoredReference(question, sketch)).toBe(false);
  });

  it("accepts a reference once the question names a declared element of the sketch", () => {
    const question = "Wie verändert sich dieser Wert von counter beim nächsten Durchlauf?";
    expect(hasUnanchoredReference(question, sketch)).toBe(false);
    expect(hasUnanchoredReference(question)).toBe(true);
  });

  it("does not take a type name, setup, loop or a German word for an element of the sketch", () => {
    const code = "int an = 1;\nvoid setup() {}\nvoid loop() {}";
    expect(hasUnanchoredReference("Welchen Typ int hat an der betrachteten Variable in loop der Wert?", code)).toBe(true);
  });
});
