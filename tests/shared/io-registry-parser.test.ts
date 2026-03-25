/**
 * io-registry-parser.test.ts
 *
 * Unit tests for parseStaticIORegistry() covering all 11 test cases defined
 * in ssot_io-registry.md.
 *
 * TC  1 – literal pin + literal mode (pinMode)
 * TC  2 – A0 alias → pinId 14, digitalRead column
 * TC  3 – for-loop expansion → multiple pins in digitalWrite column
 * TC  4 – const int variable resolution → correct pin
 * TC  5 – #define BTN A3 resolution → pin A3 (id 17)
 * TC  6 – loop() call → single static entry, no per-iteration duplication
 * TC  7 – same pin in both read AND write columns
 * TC  8 – dynamic pin (runtime()) → NOT in static result
 * TC  9 – pinMode INPUT + digitalWrite → conflict flag
 * TC 10 – array index resolution (pins[1] → pin 8)
 * TC 11 – multiple different modes on same pin → conflict + both line numbers
 */

import { describe, it, expect } from "vitest";
import { parseStaticIORegistry } from "../../shared/io-registry-parser";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a sketch string with optional extra lines for correct line counting. */
function sketch(lines: string[]): string {
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("parseStaticIORegistry – SSOT test cases", () => {
  // ── TC 1 ──────────────────────────────────────────────────────────────────
  it("TC1: pinMode(13, OUTPUT) → pin 13, OUTPUT in pinModeLines", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(13, OUTPUT);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin13 = registry.find((p) => p.pin === "13");
    expect(pin13, "pin 13 must be in registry").toBeDefined();
    expect(pin13!.pinModeModes).toContain("OUTPUT");
    expect(pin13!.pinModeLines).toHaveLength(1);
    // Compact mode: defined means checkmark
    expect(pin13!.defined).toBe(true);
    // Line number must be > 0 (not 0)
    expect(pin13!.pinModeLines![0]).toBeGreaterThan(0);
  });

  // ── TC 2 ──────────────────────────────────────────────────────────────────
  it("TC2: digitalRead(A0) → pin A0 (pinId 14) in digitalRead column", () => {
    const code = sketch([
      "void setup() {}",
      "void loop() {",
      "  digitalRead(A0);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pinA0 = registry.find((p) => p.pin === "A0");
    expect(pinA0, "A0 must be in registry").toBeDefined();
    expect(pinA0!.pinId).toBe(14);
    expect(pinA0!.digitalReadLines).toBeDefined();
    expect(pinA0!.digitalReadLines!.length).toBeGreaterThan(0);
    // No pinMode was set, so the flag should not be set
    expect(pinA0!.pinModeModes).toBeUndefined();
  });

  // ── TC 3 ──────────────────────────────────────────────────────────────────
  it("TC3: for-loop digitalWrite(i) expands to pins 2 and 3", () => {
    const code = sketch([
      "void loop() {",
      "  for (int i = 2; i < 4; i++) {",
      "    digitalWrite(i, HIGH);",
      "  }",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin2 = registry.find((p) => p.pin === "2");
    const pin3 = registry.find((p) => p.pin === "3");

    expect(pin2, "pin 2 must be in registry").toBeDefined();
    expect(pin3, "pin 3 must be in registry").toBeDefined();
    expect(pin2!.digitalWriteLines!.length).toBeGreaterThan(0);
    expect(pin3!.digitalWriteLines!.length).toBeGreaterThan(0);

    // Pins 0, 1, 4+ must NOT be added by this code
    expect(registry.find((p) => p.pin === "4")).toBeUndefined();
  });

  // ── TC 4 ──────────────────────────────────────────────────────────────────
  it("TC4: const int led = 12; digitalWrite(led) → pin 12", () => {
    const code = sketch([
      "const int led = 12;",
      "void setup() {}",
      "void loop() {",
      "  digitalWrite(led, HIGH);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin12 = registry.find((p) => p.pin === "12");
    expect(pin12, "pin 12 must be in registry").toBeDefined();
    expect(pin12!.digitalWriteLines!.length).toBeGreaterThan(0);
  });

  // ── TC 5 ──────────────────────────────────────────────────────────────────
  it("TC5: #define BTN A3 + pinMode(BTN, INPUT) → pin A3 (id 17)", () => {
    const code = sketch([
      "#define BTN A3",
      "void setup() {",
      "  pinMode(BTN, INPUT);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pinA3 = registry.find((p) => p.pin === "A3");
    expect(pinA3, "A3 must be in registry").toBeDefined();
    expect(pinA3!.pinId).toBe(17);
    expect(pinA3!.pinModeModes).toContain("INPUT");
  });

  // ── TC 6 ──────────────────────────────────────────────────────────────────
  it("TC6: digitalWrite(9) in loop() → exactly one static entry (no duplicates)", () => {
    const code = sketch([
      "void setup() {}",
      "void loop() {",
      "  digitalWrite(9, HIGH);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin9 = registry.find((p) => p.pin === "9");
    expect(pin9, "pin 9 must be in registry").toBeDefined();
    // Static parser must produce exactly ONE entry even though loop() runs many times
    expect(pin9!.digitalWriteLines).toHaveLength(1);
  });

  // ── TC 7 ──────────────────────────────────────────────────────────────────
  it("TC7: digitalRead(5) + digitalWrite(5) → both columns filled with different lines", () => {
    // Build code so that digitalRead is around line 10 and digitalWrite around line 20
    const lines = [
      "void setup() {}",
      "void loop() {",
      "  int x = 0;",
      "  int y = 0;",
      "  int z = 0;",
      "  int a = 0;",
      "  int b = 0;",
      "  int c = 0;",
      "  digitalRead(5);",      // ~line 9
      "  int d = 0;",
      "  int e = 0;",
      "  int f = 0;",
      "  int g = 0;",
      "  int h = 0;",
      "  int i = 0;",
      "  int j = 0;",
      "  int k = 0;",
      "  int l = 0;",
      "  int m = 0;",
      "  digitalWrite(5, LOW);", // ~line 20
      "}",
    ];
    const code = sketch(lines);
    const registry = parseStaticIORegistry(code);

    const pin5 = registry.find((p) => p.pin === "5");
    expect(pin5, "pin 5 must be in registry").toBeDefined();
    expect(pin5!.digitalReadLines!.length, "digitalRead column").toBeGreaterThan(0);
    expect(pin5!.digitalWriteLines!.length, "digitalWrite column").toBeGreaterThan(0);
    // The two lines must be different
    expect(pin5!.digitalReadLines![0]).not.toBe(pin5!.digitalWriteLines![0]);
  });

  // ── TC 8 ──────────────────────────────────────────────────────────────────
  it("TC8: dynamic pin (int p = random(0,5); digitalRead(p)) → NOT in static registry", () => {
    const code = sketch([
      "void setup() {}",
      "void loop() {",
      "  int p = random(0, 5);",
      "  digitalRead(p);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    // `p` is assigned from random() which is not a compile-time constant.
    // The static parser must not add any pin for this.
    expect(registry).toHaveLength(0);
  });

  // ── TC 9 ──────────────────────────────────────────────────────────────────
  it("TC9: pinMode(A0, INPUT) + digitalWrite(A0) → conflict = true", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(A0, INPUT);",
      "  digitalWrite(A0, HIGH);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pinA0 = registry.find((p) => p.pin === "A0");
    expect(pinA0, "A0 must be in registry").toBeDefined();
    expect(pinA0!.conflict).toBe(true);
    expect(pinA0!.conflictMessage).toBeTruthy();
    // Both columns must be populated
    expect(pinA0!.pinModeModes).toContain("INPUT");
    expect(pinA0!.digitalWriteLines!.length).toBeGreaterThan(0);
  });

  // ── TC 10 ─────────────────────────────────────────────────────────────────
  it("TC10: int pins[] = {7, 8}; digitalRead(pins[1]) → pin 8", () => {
    const code = sketch([
      "int pins[] = {7, 8};",
      "void setup() {}",
      "void loop() {",
      "  digitalRead(pins[1]);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin8 = registry.find((p) => p.pin === "8");
    expect(pin8, "pin 8 must be in registry").toBeDefined();
    expect(pin8!.digitalReadLines!.length).toBeGreaterThan(0);
    // pin 7 must NOT be in registry (only pins[1] = 8 is read)
    expect(registry.find((p) => p.pin === "7")).toBeUndefined();
  });

  // ── TC 11 ─────────────────────────────────────────────────────────────────
  it("TC11: pinMode(13, OUTPUT) + pinMode(13, INPUT) → conflict, both lines recorded", () => {
    // Build code with the two pinMode calls far apart (lines ~5 and ~25)
    const lines = [
      "void setup() {",
      "  // ----",
      "  // ----",
      "  // ----",
      "  pinMode(13, OUTPUT);",  // line 5
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  // ....",
      "  pinMode(13, INPUT);",   // line 25
      "}",
      "void loop() {}",
    ];
    const code = sketch(lines);
    const registry = parseStaticIORegistry(code);

    const pin13 = registry.find((p) => p.pin === "13");
    expect(pin13, "pin 13 must be in registry").toBeDefined();
    expect(pin13!.conflict).toBe(true);
    expect(pin13!.pinModeLines, "both pinMode lines must be recorded").toHaveLength(2);
    expect(pin13!.pinModeModes).toContain("OUTPUT");
    expect(pin13!.pinModeModes).toContain("INPUT");
    // The two line numbers must differ
    expect(pin13!.pinModeLines![0]).not.toBe(pin13!.pinModeLines![1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional edge-case tests
// ─────────────────────────────────────────────────────────────────────────────

describe("parseStaticIORegistry – edge cases", () => {
  it("sorts output by pinId (0 → 19)", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(13, OUTPUT);",
      "  pinMode(0, INPUT);",
      "  pinMode(A5, INPUT_PULLUP);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);
    const ids = registry.map((r) => r.pinId);
    expect(ids).toEqual([...ids].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("A0-A5 labels are correct (A0 = id 14, A5 = id 19)", () => {
    const code = sketch([
      "void setup() {",
      "  analogRead(A0);",
      "  analogRead(A5);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);
    expect(registry.find((p) => p.pin === "A0")?.pinId).toBe(14);
    expect(registry.find((p) => p.pin === "A5")?.pinId).toBe(19);
  });

  it("LED_BUILTIN resolves to pin 13", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(LED_BUILTIN, OUTPUT);",
      "  digitalWrite(LED_BUILTIN, HIGH);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);
    const pin13 = registry.find((p) => p.pin === "13");
    expect(pin13).toBeDefined();
    expect(pin13!.pinModeModes).toContain("OUTPUT");
    expect(pin13!.digitalWriteLines!.length).toBeGreaterThan(0);
  });

  it("code without any IO calls returns empty array", () => {
    const code = sketch([
      "void setup() { Serial.begin(115200); }",
      "void loop() { Serial.println(42); }",
    ]);
    expect(parseStaticIORegistry(code)).toHaveLength(0);
  });

  it("pins in comments are ignored", () => {
    const code = sketch([
      "void setup() {",
      "  // pinMode(13, OUTPUT); // this is a comment",
      "  /* digitalWrite(7, HIGH); */",
      "}",
      "void loop() {}",
    ]);
    expect(parseStaticIORegistry(code)).toHaveLength(0);
  });

  it("INPUT_PULLUP mode is preserved", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(2, INPUT_PULLUP);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);
    const pin2 = registry.find((p) => p.pin === "2");
    expect(pin2!.pinModeModes).toContain("INPUT_PULLUP");
    expect(pin2!.pinMode).toBe(2);
  });

  // ── TC3b: braceless for-loop ───────────────────────────────────────────────
  it("TC3b: braceless for-loop expands to all pins; overlapping range creates conflict", () => {
    // Loop 1: pins 1..6 as INPUT (braceless)
    // Loop 2: pins 6..10 as OUTPUT (braceless)
    // → pins 1-5: INPUT, pin 6: conflict INPUT+OUTPUT, pins 7-10: OUTPUT
    const code = sketch([
      "void setup() {",
      "  for (int i = 1; i <= 6; i++) pinMode(i, INPUT);",
      "  for (int i = 6; i <= 10; i++) pinMode(i, OUTPUT);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    // Pins 1–5: INPUT only, no conflict
    for (const n of [1, 2, 3, 4, 5]) {
      const p = registry.find((r) => r.pin === String(n));
      expect(p, `pin ${n} must be in registry`).toBeDefined();
      expect(p!.pinModeModes).toContain("INPUT");
      expect(p!.conflict).toBeFalsy();
    }

    // Pin 6: INPUT + OUTPUT → conflict
    const pin6 = registry.find((r) => r.pin === "6");
    expect(pin6, "pin 6 must be in registry").toBeDefined();
    expect(pin6!.pinModeModes).toContain("INPUT");
    expect(pin6!.pinModeModes).toContain("OUTPUT");
    expect(pin6!.conflict).toBe(true);

    // Pins 7–10: OUTPUT only, no conflict
    for (const n of [7, 8, 9, 10]) {
      const p = registry.find((r) => r.pin === String(n));
      expect(p, `pin ${n} must be in registry`).toBeDefined();
      expect(p!.pinModeModes).toContain("OUTPUT");
      expect(p!.conflict).toBeFalsy();
    }
  });

  // ── TC9b: OUTPUT + digitalRead conflict ───────────────────────────────────
  it("TC9b: pinMode(OUTPUT) + digitalRead() on same pin → conflict", () => {
    const code = sketch([
      "void setup() {",
      "  pinMode(5, OUTPUT);",
      "}",
      "void loop() {",
      "  int val = digitalRead(5);",
      "}",
    ]);
    const registry = parseStaticIORegistry(code);

    const pin5 = registry.find((p) => p.pin === "5");
    expect(pin5, "pin 5 must be in registry").toBeDefined();
    expect(pin5!.pinModeModes).toContain("OUTPUT");
    expect(pin5!.conflict).toBe(true);
    expect(pin5!.conflictMessage).toBeTruthy();
  });

  // ── Array with unresolvable tokens → array ignored ────────────────────────
  it("array with unresolvable variable tokens is skipped", () => {
    const code = sketch([
      "int vals[] = {unknownVar, 8};",
      "void setup() {",
      "  pinMode(vals[0], OUTPUT);",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    // unknownVar cannot be resolved, so the array is skipped entirely
    // Thus, vals[0] cannot be resolved either, and no pin record is created
    expect(registry).toHaveLength(0);
  });

  // ── For-loop with unknown symbol limit (resolveToken returns undefined) ──
  it("for-loop with unknown symbol limit is skipped", () => {
    const code = sketch([
      "void setup() {",
      "  for (int i=0; i<NUM_LEDS; i++) {",
      "    pinMode(i, OUTPUT);",
      "  }",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    // NUM_LEDS is not defined, so parseInt yields NaN → for-loop expansion skipped.
    // The direct scan may still pick up the literal call, so just ensure
    // that the for-loop did NOT expand to multiple pins.
    expect(registry.length).toBeLessThanOrEqual(1);
  });

  // ── For-loop with >= comparator ───────────────────────────────────────────
  it("for-loop with >= comparator is handled", () => {
    const code = sketch([
      "void setup() {",
      "  for (int i=5; i>=2; i--) {",
      "    pinMode(i, OUTPUT);",
      "  }",
      "}",
      "void loop() {}",
    ]);
    const registry = parseStaticIORegistry(code);

    // >= comparator: iterates from high to low, should find pins
    expect(registry.length).toBeGreaterThanOrEqual(1);
  });
});
