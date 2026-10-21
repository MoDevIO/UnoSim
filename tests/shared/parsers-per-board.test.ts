import { describe, expect, it } from "vitest";
import { CodeParser } from "@shared/code-parser";
import { analyzeStaticIO, parseStaticIORegistry, parseStaticIORegistryProject } from "@shared/io-registry-parser";
import { pinContext } from "@shared/parsers/pin-context";

const NANO_SKETCH = `void setup() { Serial.begin(115200); pinMode(13, OUTPUT); }
void loop() {
  int a = analogRead(A6);
  int b = analogRead(7);
  digitalWrite(13, a > b);
}`;

const pinsOf = (code: string, board?: "uno" | "nano") => analyzeStaticIO(code, board ? { board } : {}).pins.map((pin) => pin.pinId);

describe("static I/O analysis per board (plan P4.2)", () => {
  it("leaves the Uno as it was: A0–A5 resolve, A6 and A7 do not, analogRead(6) is pin 6", () => {
    expect(pinsOf("void loop(){ analogRead(A5); }")).toEqual([19]);
    expect(pinsOf("void loop(){ analogRead(A6); }")).toEqual([]);
    expect(pinsOf("void loop(){ analogRead(6); }")).toEqual([6]);
    expect(pinsOf("void loop(){ analogRead(A0); }", "uno")).toEqual([14]);
    expect(pinsOf("void loop(){ digitalWrite(20, HIGH); }")).toEqual([]);
  });

  it("resolves A6 and A7 on the Nano as pins 20 and 21, and analogRead(6) and (7) as those inputs", () => {
    expect(pinsOf(NANO_SKETCH, "nano")).toEqual([13, 20, 21]);
    expect(pinsOf("const int sensor = A7; void loop(){ analogRead(sensor); }", "nano")).toEqual([21]);
  });

  it("writes pin names the way a sketch does in the registry records", () => {
    const records = parseStaticIORegistry(NANO_SKETCH, { board: "nano" });

    expect(records.map((record) => record.pin)).toEqual(["13", "A6", "A7"]);
    expect(records.find((record) => record.pin === "A6")?.analogReadLines).toEqual([3]);
  });

  it("does not leak the board of one analysis into the next, also when it throws", () => {
    parseStaticIORegistry(NANO_SKETCH, { board: "nano" });
    expect(pinsOf("void loop(){ analogRead(A6); }")).toEqual([]);

    expect(() => analyzeStaticIO(undefined as unknown as string, { board: "nano" })).toThrow();
    expect(pinsOf("void loop(){ analogRead(A6); }")).toEqual([]);
  });

  it("analyses a project for a board", () => {
    const project = { entryFile: "sketch.ino", files: { "sketch.ino": "void loop(){ analogRead(A7); }" } };

    expect(parseStaticIORegistryProject(project, { board: "nano" }).map((record) => record.pin)).toEqual(["A7"]);
    expect(parseStaticIORegistryProject(project).map((record) => record.pin)).toEqual([]);
  });

  it("falls back to the Uno for a board without hardware profile yet", () => {
    expect(pinContext("attiny85").board).toBe("uno");
    expect(pinContext("attiny85").maxPin).toBe(19);
  });
});

describe("hardware rules per board (plan P4.2)", () => {
  const messages = (code: string, board: "uno" | "nano") => new CodeParser(undefined, undefined, board).parseAll(code).map((message) => message.message);

  it("names the board in the PWM warning, with its PWM pins", () => {
    const code = "void setup(){ pinMode(4, OUTPUT); } void loop(){ analogWrite(4, 10); }";

    expect(messages(code, "uno")).toContain("analogWrite(4, ...) used on pin 4, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.");
    expect(messages(code, "nano")).toContain("analogWrite(4, ...) used on pin 4, which doesn't support PWM on Arduino Nano. PWM pins: 3, 5, 6, 9, 10, 11.");
  });

  it("warns when A6 or A7 of the Nano are used digitally", () => {
    const code = "void setup(){ Serial.begin(115200); pinMode(A6, INPUT); } void loop(){ int v = digitalRead(A6); }";

    const warnings = messages(code, "nano").filter((message) => message.includes("analog-only"));

    expect(warnings).toEqual([
      "pinMode(A6, ...) used on A6, which is an analog-only input on Arduino Nano and has no digital function.",
      "digitalRead(A6, ...) used on A6, which is an analog-only input on Arduino Nano and has no digital function.",
    ]);
  });

  it("does not warn about analog use of A6 and A7", () => {
    expect(messages(NANO_SKETCH, "nano").filter((message) => message.includes("analog-only"))).toEqual([]);
  });

  it("names pins in the conflict warning the way a sketch does", () => {
    const code = "void setup(){ Serial.begin(115200); pinMode(A7, INPUT); } void loop(){ analogRead(A7); }";

    expect(messages(code, "nano").some((message) => message.includes("Pin A7 used as both digital and analog"))).toBe(true);
  });
});
