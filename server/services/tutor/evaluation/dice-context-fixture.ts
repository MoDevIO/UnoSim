import type { ExampleTutorAnnotation } from "../../course-content/embedded-tutor-annotation";
import type { ResolvedTutorCourseContent } from "../../course-content/course-content-session";
import { createTutorProgressionState } from "../curriculum/progression-state";

/**
 * Course Content fixture `dice-context` for the Tutor Quality corpus (Plan Aufgabe 8, case TQ-DICE-CLARIFY),
 * after the pattern of `it064Content`. It binds a first question about the type of the local variable `t`
 * and a second one about the missing serial output in `show`, for the dice sketch
 * `tests/fixtures/tutor-quality/TQ-REG-002-dice-context.ino`. Its facts come from that sketch (Plan, Anhang A):
 * `t` is a local `static unsigned long` in `switchInit`, never updated in the code shown, and `switchInit` is
 * never called there; `show` contains no serial output call, `Serial.begin` only initializes, and the one
 * `Serial.println` line is commented out.
 *
 * Deliberately without a reference answer: no model answer for these questions is invented here, so the
 * application cannot correct a rating for them; the cases measure the model's own explanation.
 */
export const DICE_CONTEXT_T_QUESTION = "Welchen Datentyp hat die lokale Variable `t` in `switchInit`?";
export const DICE_CONTEXT_SERIAL_QUESTION = "Welche serielle Ausgabe wird in `show(const byte x)` ausgeführt?";

export const DICE_CONTEXT_ANNOTATION: ExampleTutorAnnotation = {
  schemaVersion: 2,
  learningObjectives: [
    "Die Studierenden sollen Typ und Lebensdauer lokaler Variablen am Sketch benennen und Aufrufe im Code belegen können.",
  ],
  afterFocus: "free",
  focus: [
    {
      id: "typ-von-t",
      title: "Der Typ von t",
      objective: "Den Datentyp und die Lebensdauer der lokalen Variablen t in switchInit erklären.",
      questions: [{ kind: "concept", text: DICE_CONTEXT_T_QUESTION }],
    },
    {
      id: "serielle-ausgabe",
      title: "Serielle Ausgabe in show",
      objective: "Belegen, ob und wo der Sketch Daten seriell ausgibt.",
      questions: [{ kind: "concept", text: DICE_CONTEXT_SERIAL_QUESTION }],
    },
  ],
};

export const DICE_CONTEXT_REVISION = "8".repeat(40);

export function diceContextContent(): ResolvedTutorCourseContent {
  return {
    repository: "ttbombadil/unosim-examples",
    ref: "main",
    revision: DICE_CONTEXT_REVISION,
    exampleId: "dice-context",
    tutor: { status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleTutorAnnotation: DICE_CONTEXT_ANNOTATION,
    progressionState: createTutorProgressionState(DICE_CONTEXT_REVISION),
    contentBytes: 4_096,
  } as ResolvedTutorCourseContent;
}
