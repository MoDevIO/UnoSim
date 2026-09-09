import { CodeParser } from "../../../shared/code-parser";
import { parseStaticIORegistry } from "../../../shared/io-registry-parser";

const parser = new CodeParser();

describe("static I/O parser message regressions", () => {
  it("reports a literal digitalWrite without pinMode with stable metadata", () => {
    const messages = parser.parseHardwareCompatibility([
      "void setup() {}",
      "void loop() {",
      "  digitalWrite(7, HIGH);",
      "}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "hardware",
        severity: 2,
        message: "Pin 7 used with digitalRead/digitalWrite but pinMode() was not called for this pin.",
        suggestion: "pinMode(7, INPUT);",
        line: 3,
      }),
    ]);
  });

  it("does not warn for matching pinMode and digitalWrite calls", () => {
    const messages = parser.parseHardwareCompatibility([
      "void setup() { pinMode(7, OUTPUT); }",
      "void loop() { digitalWrite(7, HIGH); }",
    ].join("\n"));

    expect(messages).toEqual([]);
  });

  it("does not report a false missing-pinMode warning for an array loop", () => {
    const messages = parser.parseHardwareCompatibility([
      "const int pinArray[] = {2, 3, 4, 5};",
      "void setup() {",
      "  for (int i = 0; i < 4; i++) {",
      "    pinMode(pinArray[i], OUTPUT);",
      "    digitalWrite(pinArray[i], LOW);",
      "  }",
      "}",
      "void loop() {}",
    ].join("\n"));

    expect(messages).toEqual([]);
  });

  it("reports an unconfigured digitalWrite array loop once", () => {
    const messages = parser.parseHardwareCompatibility([
      "const int pinArray[] = {2, 3, 4, 5};",
      "void loop() {",
      "  for (int i = 0; i < 4; i++) {",
      "    digitalWrite(pinArray[i], LOW);",
      "  }",
      "}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "hardware",
        severity: 2,
        message: "Variable 'pinArray[i]' used in digitalRead/digitalWrite but no pinMode() call found for this variable.",
        suggestion: "pinMode(pinArray[i], INPUT);",
        line: 3,
      }),
    ]);
  });

  it("reports digitalRead on an OUTPUT pin", () => {
    const messages = parser.parseHardwareCompatibility([
      "void setup() { pinMode(8, OUTPUT); }",
      "void loop() {",
      "  digitalRead(8);",
      "}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "pins",
        severity: 2,
        message: "Pin 8 is configured as OUTPUT but read with digitalRead(). Reading an OUTPUT pin may return unexpected values.",
        suggestion: "If you need to read the pin, use pinMode(8, INPUT) or INPUT_PULLUP instead.",
        line: 3,
      }),
    ]);
  });

  it.each(["INPUT", "INPUT_PULLUP"])(
    "retains the registry conflict for digitalWrite on %s",
    (mode) => {
      const registry = parseStaticIORegistry([
        `void setup() { pinMode(6, ${mode}); }`,
        "void loop() { digitalWrite(6, HIGH); }",
      ].join("\n"));

      expect(registry).toContainEqual(expect.objectContaining({
        pin: "6",
        conflict: true,
        conflictMessage: `Write on ${mode} pin`,
      }));
    },
  );

  it("reports conflicting repeated pinMode calls with stable metadata", () => {
    const messages = parser.parseHardwareCompatibility([
      "void setup() {",
      "  pinMode(6, INPUT);",
      "  pinMode(6, OUTPUT);",
      "}",
      "void loop() {}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "pins",
        severity: 2,
        message: "Pin 6 has multiple pinMode() calls with different modes: INPUT, OUTPUT.",
        suggestion: "Use a single pinMode(6, <MODE>) call in setup().",
        line: 3,
      }),
    ]);
  });

  it("warns for analogWrite on a non-PWM pin but not on a PWM pin", () => {
    const messages = parser.parseHardwareCompatibility([
      "void loop() {",
      "  analogWrite(2, 128);",
      "  analogWrite(3, 128);",
      "}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "hardware",
        severity: 2,
        message: "analogWrite(2, ...) used on pin 2, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.",
        suggestion: "// Use PWM pin instead: analogWrite(3, value);",
        line: 2,
      }),
    ]);
  });

  it("treats numeric analogRead channel 0 as A0 in conflict messages", () => {
    const messages = parser.parsePinConflicts([
      "void setup() { pinMode(A0, INPUT); }",
      "void loop() { analogRead(0); }",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "hardware",
        severity: 2,
        message: "Pin A0 used as both digital and analog. This may be unintended.",
        suggestion: "// Use separate pins for digital and analog",
      }),
    ]);
  });

  it("resolves define, const, and Arduino aliases while preserving message order", () => {
    const messages = parser.parseHardwareCompatibility([
      "#define BAD_PWM_PIN 2",
      "const int outputPin = 8;",
      "void setup() { pinMode(outputPin, OUTPUT); }",
      "void loop() {",
      "  analogWrite(BAD_PWM_PIN, 128);",
      "  digitalRead(outputPin);",
      "}",
    ].join("\n"));

    expect(messages).toEqual([
      expect.objectContaining({
        type: "warning",
        category: "hardware",
        severity: 2,
        message: "analogWrite(BAD_PWM_PIN, ...) used on pin 2, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.",
        line: 5,
      }),
      expect.objectContaining({
        type: "warning",
        category: "pins",
        severity: 2,
        message: "Pin 8 is configured as OUTPUT but read with digitalRead(). Reading an OUTPUT pin may return unexpected values.",
        line: 6,
      }),
    ]);

    expect(parser.parsePinConflicts([
      "#define SENSOR A0",
      "void setup() { pinMode(SENSOR, INPUT); }",
      "void loop() { analogRead(SENSOR); }",
    ].join("\n"))).toEqual([
      expect.objectContaining({
        category: "hardware",
        severity: 2,
        message: "Pin A0 used as both digital and analog. This may be unintended.",
      }),
    ]);
  });

  it("does not invent warnings for consistently configured dynamic expressions", () => {
    const code = [
      "int activePin = getActivePin();",
      "void setup() { pinMode(activePin, OUTPUT); }",
      "void loop() { digitalWrite(activePin, HIGH); }",
    ].join("\n");

    expect(parser.parseHardwareCompatibility(code)).toEqual([]);
    expect(parser.parsePinConflicts(code)).toEqual([]);
  });
});
