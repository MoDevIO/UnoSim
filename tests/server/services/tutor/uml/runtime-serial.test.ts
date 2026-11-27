import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { context, ref } from "./contract-fixtures";

const serialCode = `void setup() {
  Serial.begin(115200);
  Serial.println("Start");
}
void loop() {
  digitalWrite(13, 1);
}`;
const serialCycle = (code: string) => ({
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "activity",
  purpose: "Die serielle Ausgabe einmal vorbereiten und dann wiederholt schalten.",
  scope: ref(1, code.split("\n").length),
  runtime: "arduino-setup-loop",
  setup: {
    ref: ref(1, 4),
    body: code.split("\n").slice(1, 3).map((line, index) => ({ type: "action", code: line.trim(), ref: ref(index + 2) })),
  },
  loop: { ref: ref(5, 7), body: [{ type: "action", code: "digitalWrite(13, 1);", ref: ref(6) }] },
});

it("accepts methods of the core Serial object in setup and loop", () => {
  expect(validateTutorUmlProposal(serialCycle(serialCode), context(serialCode)).ok).toBe(true);
});

it.each([
  ["a Serial the sketch declares itself", `${serialCode}\nint Serial = 0;`],
  ["another object's method", serialCode.replace("Serial.println", "Display.println")],
  ["a pointer access", serialCode.replace("Serial.println", "Serial->println")],
  ["a nested member", serialCode.replace("Serial.println", "Serial.port.println")],
])("still rejects %s", (_name, code) => {
  expect(validateTutorUmlProposal(serialCycle(code), context(code)).ok).toBe(false);
});

it("accepts the setup sequence of review5 (header with #pragma once in a folder, Serial.begin)", () => {
  const corpus = "tests/fixtures/runtime-corpus/examples-v3.0.0/it11-04-matrix-transponieren/";
  const entryFile = "examples/IT11/it11-04-matrix-transponieren.ino";
  const code = readFileSync(corpus + "it11-04-matrix-transponieren.ino", "utf8");
  const line = (text: string) => code.split("\n").findIndex((l) => l.trim() === text) + 1;
  const at = (start: number, end = start) => ({ file: entryFile, startLine: start, endLine: end });
  const [setupStart, loopStart] = [line("void setup() {"), line("void loop() {")];
  const actions = ["Serial.begin(115200);", 'printMatrix(A, "A", 0);', "transposeMatrix(A, AT);", 'printMatrix(AT, "AT", 0);'];
  const proposal = {
    version: 1,
    profile: "uml1-classic-v1",
    status: "diagram",
    kind: "activity",
    purpose: "Zeigt, dass AT vor der Ausgabe durch transposeMatrix gefüllt wird.",
    scope: at(setupStart, loopStart + 1),
    runtime: "arduino-setup-loop",
    setup: { ref: at(setupStart, setupStart + 5), body: actions.map((action) => ({ type: "action", code: action, ref: at(line(action)) })) },
    loop: { ref: at(loopStart, loopStart + 1), body: [] },
  };
  const result = validateTutorUmlProposal(proposal, {
    question: "Warum passt der Aufruf von `printMatrix` mit `AT` zu den Matrixgrößen?",
    code,
    entryFile,
    board: "uno",
    headers: { "examples/IT11/mat_func.h": readFileSync(corpus + "mat_func.h", "utf8") },
  });
  expect(result).toMatchObject({ ok: true });
});
