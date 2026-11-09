import type { ExampleTutorAnnotation } from "../../course-content/embedded-tutor-annotation";
import type { ResolvedTutorCourseContent } from "../../course-content/course-content-session";
import { createTutorProgressionState } from "../curriculum/progression-state";

/**
 * Example IT06.4 "Eine Zahl binär ausgeben" (UnoSim-Examples, examples/IT06/it06-04-binaerzahl.ino), the
 * regression of LearningQuestions R-SUP-8: the prediction question assumes `a = 200` while the Example
 * starts with `a = 37`. Checked by hand: 1 << 7 = 128, 200 & 128 = 128, 128 && 1 is true, so the first
 * `Serial.print` in the loop prints 1; the first line is `200 = 11001000`.
 */
export const IT064_SKETCH = `byte a = 37;

void setup() {
  Serial.begin(115200);

  Serial.print(a);
  Serial.print(" = ");
  for (int i = 7; i >= 0; i--) {
    Serial.print(a & (1 << i) && 1);   // ist Bit i gesetzt?
  }
  Serial.println();

  Serial.print("Mit BIN: ");
  Serial.println(a, BIN);
}

void loop() {
}
`;

export const IT064_CONCEPT_QUESTION = "Welche Aufgabe hat `1 << i` in der Schleife?";
export const IT064_PREDICTION_QUESTION = "Was wird im ersten Durchlauf ausgegeben, wenn `a` den Wert 200 hat?";

export const IT064_REFERENCE = {
  answer: "1",
  explanation: "Im ersten Durchlauf ist i = 7, also ist 1 << 7 = 128 (binär 10000000). 200 ist binär 11001000, Bit 7 ist gesetzt: 200 & 128 = 128. Der Ausdruck 128 && 1 ist wahr, deshalb gibt Serial.print eine 1 aus. Die ganze erste Zeile lautet 200 = 11001000.",
  accept: ["1", "200 = 1"],
  assumptions: ["a = 200"],
  requiresCode: ["for (int i = 7; i >= 0; i--) {", "Serial.print(a & (1 << i) && 1);"],
};

export const IT064_ANNOTATION: ExampleTutorAnnotation = {
  schemaVersion: 3,
  learningObjectives: [
    "Die Studierenden sollen eine Zählschleife mit bitweisen Operatoren kombinieren können.",
  ],
  afterFocus: "free",
  focus: [
    {
      id: "bit-pruefen",
      title: "Ein Bit prüfen",
      objective: "Erklären, wie in jedem Durchlauf ein Bit geprüft wird.",
      questions: [
        { kind: "concept", text: IT064_CONCEPT_QUESTION },
        { kind: "prediction", text: IT064_PREDICTION_QUESTION, reference: IT064_REFERENCE },
      ],
    },
    {
      id: "schleife-und-skalierung",
      title: "Schleife und Skalierbarkeit",
      objective: "Die Zählrichtung begründen und das Programm auf 16 Bit übertragen.",
      questions: [
        { kind: "concept", text: "Warum zählt die Schleife mit `i--` von 7 herunter?" },
      ],
    },
  ],
};

export const IT064_REVISION = "6".repeat(40);

export function it064Content(): ResolvedTutorCourseContent {
  return {
    repository: "ttbombadil/unosim-examples",
    ref: "main",
    revision: IT064_REVISION,
    exampleId: "it06-04-binaerzahl",
    tutor: { status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleTutorAnnotation: IT064_ANNOTATION,
    exampleProgram: { code: IT064_SKETCH, headers: [] },
    progressionState: createTutorProgressionState(IT064_REVISION),
    contentBytes: 4_096,
  } as ResolvedTutorCourseContent;
}

/**
 * Example IT06.1 "Eine kopfgesteuerte Schleife" (UnoSim-Examples, examples/IT06/it06-01-while.ino), the
 * regression of LearningQuestions R-SUP-9: the learner changed `GRENZE` from 1000 to 2000 while `wert` still
 * starts at 1, and answers the teacher's question about `wert` starting at 2000 with what the changed sketch
 * prints. Checked by hand: from 1 doubling while below 2000 gives 1, 2, ..., 1024 (11 passes) and the final
 * value 2048; with `wert` = 2000, `2000 < 2000` is false at the first check, so the loop runs 0 times (with
 * GRENZE 1000 as well). The Example has no reviewed reference answer for the question.
 */
export const IT061_EXAMPLE_SKETCH = `const unsigned int GRENZE = 1000;

void setup() {
  Serial.begin(115200);

  unsigned int wert = 1;
  byte schritte = 0;

  while (wert < GRENZE) {
    Serial.println(wert);
    wert = wert * 2;
    schritte++;
  }

  Serial.print("Schritte: ");
  Serial.println(schritte);
  Serial.print("Endwert: ");
  Serial.println(wert);
}

void loop() {
}
`;

export const IT061_CONCEPT_QUESTION = "Wann wird die Bedingung `wert < GRENZE` geprüft?";
export const IT061_PREDICTION_QUESTION = "Wie oft läuft die Schleife, wenn `wert` mit 2000 startet?";

export const IT061_ANNOTATION: ExampleTutorAnnotation = {
  schemaVersion: 3,
  learningObjectives: [
    "Die Studierenden sollen eine kopfgesteuerte Schleife mit while formulieren und ihren Ablauf beschreiben können.",
  ],
  afterFocus: "free",
  focus: [
    {
      id: "pruefung",
      title: "Prüfung am Kopf",
      objective: "Erklären, wann die Bedingung geprüft wird, und die Zahl der Durchläufe vorhersagen.",
      questions: [
        { kind: "concept", text: IT061_CONCEPT_QUESTION },
        { kind: "prediction", text: IT061_PREDICTION_QUESTION },
      ],
    },
    {
      id: "abbruch",
      title: "Abbruch der Schleife",
      objective: "Begründen, warum sich die Bedingung im Block ändern muss.",
      questions: [
        { kind: "concept", text: "Warum muss `wert` im Schleifenblock verändert werden?" },
      ],
    },
  ],
};

export const IT061_REVISION = "7".repeat(40);

export function it061Content(): ResolvedTutorCourseContent {
  return {
    repository: "ttbombadil/unosim-examples",
    ref: "main",
    revision: IT061_REVISION,
    exampleId: "it06-01-while",
    tutor: { status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleTutorAnnotation: IT061_ANNOTATION,
    exampleProgram: { code: IT061_EXAMPLE_SKETCH, headers: [] },
    progressionState: createTutorProgressionState(IT061_REVISION),
    contentBytes: 4_096,
  } as ResolvedTutorCourseContent;
}
