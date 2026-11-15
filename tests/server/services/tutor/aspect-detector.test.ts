import { describe, expect, it } from "vitest";
import { ASPECT_IDS, detectAspects, type AspectId } from "../../../../server/services/tutor/curriculum/aspect-detector";
import { TEMPERATURE_CONTROLLER } from "./support/aspect-fixtures";

const EMPTY = "void setup() {}\nvoid loop() {}\n";

/** Each aspect with a sketch that shows it and one that does not. */
const CASES: Readonly<Record<AspectId, { readonly positive: string; readonly negative: string }>> = {
  variables: { positive: "const int ledPin = 13;\nvoid setup() {}\nvoid loop() {}", negative: EMPTY },
  expressions: { positive: "void setup() {}\nvoid loop() { float v = analogRead(A0) * 5.0 / 1023.0; }", negative: "void setup() {}\nvoid loop() { int v = 3; }" },
  branching: { positive: "void setup() {}\nvoid loop() { if (digitalRead(2) == LOW) { digitalWrite(13, HIGH); } }", negative: EMPTY },
  loops: { positive: "void setup() { for (int i = 0; i < 3; i++) { digitalWrite(13, HIGH); } }\nvoid loop() {}", negative: EMPTY },
  functions: { positive: "int twice(int value) { return value * 2; }\nvoid setup() {}\nvoid loop() { twice(2); }", negative: EMPTY },
  arrays: { positive: "int values[3] = {1, 2, 3};\nvoid setup() {}\nvoid loop() {}", negative: "int value = 1;\nvoid setup() {}\nvoid loop() {}" },
  scope: { positive: "void setup() {}\nvoid loop() { static int count = 0; count++; }", negative: "void setup() {}\nvoid loop() { int count = 0; count++; }" },
  serial: { positive: "void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(1); }", negative: EMPTY },
  pins: { positive: "void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}", negative: EMPTY },
  timing: { positive: "void setup() {}\nvoid loop() { delay(100); }", negative: EMPTY },
  "program-flow": { positive: EMPTY, negative: "int value = 1;" },
};

function ids(code: string): AspectId[] {
  return detectAspects(code).map(({ id }) => id);
}

describe("aspect detector", () => {
  it.each(ASPECT_IDS)("finds %s in a sketch that shows it and not in one that does not", (aspect) => {
    expect(ids(CASES[aspect].positive)).toContain(aspect);
    expect(ids(CASES[aspect].negative)).not.toContain(aspect);
  });

  it("orders the aspects by weight, and the temperature controller is about branching first", () => {
    const aspects = detectAspects(TEMPERATURE_CONTROLLER);
    expect(aspects[0]?.id).toBe("branching");
    expect(aspects.map(({ weight }) => weight)).toEqual([...aspects.map(({ weight }) => weight)].sort((left, right) => right - left));
  });

  it("describes a branch chain as one site with its condition, names and features", () => {
    const branching = detectAspects(TEMPERATURE_CONTROLLER).find(({ id }) => id === "branching");
    const chain = branching?.sites.find(({ has }) => has.includes("else-if"));
    expect(branching?.sites).toHaveLength(2);
    expect(chain).toMatchObject({ function: "loop", code: "(temperature < TEMP_MIN)", names: ["temperature", "TEMP_MIN"] });
    expect(chain?.has).toEqual(expect.arrayContaining(["condition", "variable", "else-if", "else-branch"]));
    expect(branching?.sites.some(({ has }) => has.includes("early-return"))).toBe(true);
  });

  it("gives a site an id that survives a shifted line", () => {
    const shifted = `// a new first line\n${TEMPERATURE_CONTROLLER}`;
    const siteIds = (code: string) => detectAspects(code).flatMap(({ sites }) => sites.map(({ id }) => id));
    expect(siteIds(shifted)).toEqual(siteIds(TEMPERATURE_CONTROLLER));
    expect(detectAspects(shifted)[0]?.sites[0]?.line).toBe((detectAspects(TEMPERATURE_CONTROLLER)[0]?.sites[0]?.line ?? 0) + 1);
  });

  it("tells sites with the same code apart", () => {
    const code = "void setup() {}\nvoid loop() { delay(10); delay(10); }";
    const timing = detectAspects(code).find(({ id }) => id === "timing");
    expect(new Set(timing?.sites.map(({ id }) => id)).size).toBe(2);
  });

  it("finds a global written in loop() as the state of the program", () => {
    const code = "int count = 0;\nvoid setup() {}\nvoid loop() { count++; }";
    const flow = detectAspects(code).find(({ id }) => id === "program-flow");
    expect(flow?.sites.find((site) => site.function === "loop")).toMatchObject({ names: ["count"], has: ["state"] });
  });

  it("yields nothing for text that is no sketch, and stays fast on a long one", () => {
    expect(detectAspects("")).toEqual([]);
    const long = `void setup() {}\nvoid loop() {\n${"  if (digitalRead(2) == LOW) { digitalWrite(13, HIGH); }\n".repeat(2000)}}`;
    const started = Date.now();
    expect(detectAspects(long)[0]?.id).toBe("branching");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
