/**
 * static-io-registry.test.ts
 *
 * TDD tests for static IO-Registry analysis.
 *
 * These tests cover three user requirements:
 *   1. Fix duplicate entries: addPin dedup ensures no pin appears more than once
 *   2. Static analysis without simulation: CodeParser.buildStaticIORegistry() returns
 *      IOPinRecord[] with line numbers directly from source code
 *   3. digitalRead / digitalWrite shown in static analysis with line numbers
 *
 * All tests should FAIL initially (no implementation yet), then pass after fixes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodeParser } from "../../shared/code-parser";
import { RegistryManager } from "../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeManager(onUpdate = vi.fn()) {
  return new RegistryManager({ onUpdate });
}

function runStaticCollection(manager: RegistryManager, pins: IOPinRecord[]) {
  manager.startCollection();
  for (const p of pins) manager.addPin(p);
  manager.finishCollection();
}

const parser = new CodeParser();

// =============================================================================
// Requirement 1: No duplicate entries after recompilation or interleaved events
// =============================================================================

describe("Requirement 1 – No Duplicate Pin Entries", () => {
  let manager: RegistryManager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("addPin with same pin twice in one collection → merged into 1 entry", () => {
    // Simulates: binary emits IO_PIN:11 twice (e.g. variable aliasing)
    runStaticCollection(manager, [
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
      { pin: "11", defined: true, pinMode: 0, usedAt: [{ line: 6, operation: "pinMode:0" }] },
    ]);

    const entries = manager.getRegistry().filter((p) => p.pin === "11");
    expect(entries).toHaveLength(1);
  });

  it("updatePinMode interleaved during collection → still 1 entry per pin", () => {
    // Simulate: PIN_MODE event arrives DURING IO_REGISTRY collection
    manager.startCollection();
    manager.addPin({ pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] });

    // Interleaved runtime event for the same pin
    manager.updatePinMode(11, 1);

    manager.addPin({ pin: "12", defined: true, pinMode: 0, usedAt: [] });
    manager.finishCollection();

    const pin11 = manager.getRegistry().filter((p) => p.pin === "11");
    expect(pin11).toHaveLength(1);
  });

  it("multiple IO_REGISTRY cycles → no accumulation, only last cycle's data", () => {
    // First collection cycle (simulates first loop iteration)
    runStaticCollection(manager, [
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
    ]);

    // Second collection cycle (simulates second loop iteration)
    runStaticCollection(manager, [
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }, { line: 0, operation: "digitalRead" }] },
    ]);

    const entries = manager.getRegistry().filter((p) => p.pin === "11");
    expect(entries).toHaveLength(1);
  });

  it("sent registry never contains duplicate pin entries", () => {
    const onUpdate = vi.fn();
    const mgr = makeManager(onUpdate);

    // Simulate interleaved events
    mgr.updatePinMode(11, 1); // arrives before IO_REGISTRY_START
    runStaticCollection(mgr, [
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
    ]);

    // Check every onUpdate call for duplicate pin names
    for (const call of onUpdate.mock.calls) {
      const registry = call[0] as IOPinRecord[];
      const pinNames = registry.map((p) => p.pin);
      const uniqueNames = new Set(pinNames);
      expect(pinNames.length).toBe(uniqueNames.size);
    }
  });
});

// =============================================================================
// Requirement 2: Static analysis without simulation
// CodeParser.buildStaticIORegistry(code) should return IOPinRecord[]
// with real source line numbers for all pin operations.
// =============================================================================

describe("Requirement 2 – Static IO-Registry Analysis (CodeParser.buildStaticIORegistry)", () => {
  it("detects simple pinMode(11, OUTPUT) with correct line number", () => {
    const code = `
void setup() {
  pinMode(11, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");

    expect(pin11).toBeDefined();
    expect(pin11!.defined).toBe(true);
    expect(pin11!.pinMode).toBe(1); // OUTPUT
    const pinModeOps = pin11!.usedAt?.filter((u) => u.operation.includes("pinMode"));
    expect(pinModeOps?.length).toBeGreaterThanOrEqual(1);
    expect(pinModeOps![0].line).toBe(3); // line 3 (1-indexed)
  });

  it("resolves const byte variable: const byte P=11; pinMode(P, OUTPUT)", () => {
    const code = `
const byte P=11;
void setup() {
  pinMode(P, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    // P=11 → pin "11"
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    expect(pin11!.defined).toBe(true);
    expect(pin11!.pinMode).toBe(1);
  });

  it("resolves #define LED 13; pinMode(LED, OUTPUT)", () => {
    const code = `
#define LED 13
void setup() {
  pinMode(LED, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin13 = registry.find((p) => p.pin === "13");
    expect(pin13).toBeDefined();
    expect(pin13!.defined).toBe(true);
    expect(pin13!.pinMode).toBe(1);
  });

  it("resolves int variable: int sensorPin = A0; pinMode(sensorPin, INPUT)", () => {
    const code = `
int sensorPin = A0;
void setup() {
  pinMode(sensorPin, INPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pinA0 = registry.find((p) => p.pin === "A0");
    expect(pinA0).toBeDefined();
    expect(pinA0!.defined).toBe(true);
    expect(pinA0!.pinMode).toBe(0); // INPUT
  });

  it("handles multiple pins in one sketch", () => {
    const code = `
void setup() {
  pinMode(12, INPUT);
  pinMode(11, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    expect(registry.find((p) => p.pin === "12")).toBeDefined();
    expect(registry.find((p) => p.pin === "11")).toBeDefined();
    expect(registry.find((p) => p.pin === "12")!.pinMode).toBe(0);
    expect(registry.find((p) => p.pin === "11")!.pinMode).toBe(1);
  });

  it("detects conflict: same pin with different modes", () => {
    const code = `
void setup() {
  pinMode(11, OUTPUT);
  pinMode(11, INPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    expect(pin11!.hasConflict).toBe(true);
  });

  it("detects conflict via variable aliasing: const byte P1=11; pinMode(11, OUTPUT); pinMode(P1, INPUT)", () => {
    const code = `
const byte P1=11;
void setup() {
  pinMode(11, OUTPUT);
  pinMode(P1, INPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    expect(pin11!.hasConflict).toBe(true);
  });

  it("returns only pins that have operations (no 20 empty-pin skeleton)", () => {
    const code = `
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    // Should NOT include unused pins 0-12, A0-A5
    expect(registry.length).toBe(1);
    expect(registry[0].pin).toBe("13");
  });

  it("handles analogRead and analogWrite", () => {
    const code = `
void setup() {}
void loop() {
  analogRead(A0);
  analogWrite(9, 128);
}
`;
    const registry = parser.buildStaticIORegistry(code);

    const pinA0 = registry.find((p) => p.pin === "A0");
    expect(pinA0).toBeDefined();
    const arOps = pinA0!.usedAt?.filter((u) => u.operation === "analogRead");
    expect(arOps?.length).toBeGreaterThanOrEqual(1);

    const pin9 = registry.find((p) => p.pin === "9");
    expect(pin9).toBeDefined();
    const awOps = pin9!.usedAt?.filter((u) => u.operation === "analogWrite");
    expect(awOps?.length).toBeGreaterThanOrEqual(1);
  });

  it("skips commented-out code", () => {
    const code = `
void setup() {
  // pinMode(7, OUTPUT);
  /* pinMode(8, INPUT); */
  pinMode(9, OUTPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    expect(registry.find((p) => p.pin === "7")).toBeUndefined();
    expect(registry.find((p) => p.pin === "8")).toBeUndefined();
    expect(registry.find((p) => p.pin === "9")).toBeDefined();
  });
});

// =============================================================================
// Requirement 3: digitalRead / digitalWrite shown in static analysis
// =============================================================================

describe("Requirement 3 – digitalRead & digitalWrite in Static Registry", () => {
  it("detects digitalRead(P) with correct line number", () => {
    const code = `
const byte P=11;
void setup() {
  pinMode(P, OUTPUT);
}
void loop() {
  digitalRead(P);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();

    const drOps = pin11!.usedAt?.filter((u) => u.operation === "digitalRead");
    expect(drOps?.length).toBeGreaterThanOrEqual(1);
    expect(drOps![0].line).toBe(7); // line 7
  });

  it("detects digitalWrite(P, 0) with correct line number", () => {
    const code = `
const byte P=11;
void setup() {
  pinMode(P, OUTPUT);
}
void loop() {
  digitalWrite(P, 0);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();

    const dwOps = pin11!.usedAt?.filter((u) => u.operation === "digitalWrite");
    expect(dwOps?.length).toBeGreaterThanOrEqual(1);
    expect(dwOps![0].line).toBe(7); // line 7
  });

  it("full example: const byte P=11; pinMode + digitalRead + digitalWrite", () => {
    const code = `
const byte P=11;
void setup() {
  pinMode(P, OUTPUT);
}
void loop() {
  digitalRead(P);
  digitalWrite(P, 0);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    expect(pin11!.defined).toBe(true);
    expect(pin11!.pinMode).toBe(1);

    const ops = pin11!.usedAt ?? [];
    expect(ops.some((u) => u.operation.includes("pinMode"))).toBe(true);
    expect(ops.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(ops.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("detects digitalRead with literal pin number", () => {
    const code = `
void setup() {
  pinMode(5, INPUT);
}
void loop() {
  digitalRead(5);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin5 = registry.find((p) => p.pin === "5");
    expect(pin5).toBeDefined();

    const drOps = pin5!.usedAt?.filter((u) => u.operation === "digitalRead");
    expect(drOps?.length).toBeGreaterThanOrEqual(1);
  });

  it("detects digitalWrite with literal pin and value", () => {
    const code = `
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin13 = registry.find((p) => p.pin === "13");
    expect(pin13).toBeDefined();

    const dwOps = pin13!.usedAt?.filter((u) => u.operation === "digitalWrite");
    expect(dwOps?.length).toBeGreaterThanOrEqual(1);
  });

  it("detects digitalRead/Write with #define variable", () => {
    const code = `
#define SENSOR 7
void setup() {
  pinMode(SENSOR, INPUT);
}
void loop() {
  int val = digitalRead(SENSOR);
  digitalWrite(SENSOR, val);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin7 = registry.find((p) => p.pin === "7");
    expect(pin7).toBeDefined();

    const ops = pin7!.usedAt ?? [];
    expect(ops.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(ops.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("operations for different pins are not mixed up", () => {
    const code = `
void setup() {
  pinMode(10, OUTPUT);
  pinMode(11, INPUT);
}
void loop() {
  digitalWrite(10, HIGH);
  int v = digitalRead(11);
}
`;
    const registry = parser.buildStaticIORegistry(code);

    const pin10 = registry.find((p) => p.pin === "10");
    const pin11 = registry.find((p) => p.pin === "11");

    // pin 10: OUTPUT + digitalWrite, no digitalRead
    expect(pin10!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    expect(pin10!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(false);

    // pin 11: INPUT + digitalRead, no digitalWrite
    expect(pin11!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin11!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(false);
  });

  it("each operation entry has a line > 0", () => {
    const code = `
void setup() {
  pinMode(11, OUTPUT);
}
void loop() {
  digitalRead(11);
  digitalWrite(11, 0);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    for (const op of pin11!.usedAt ?? []) {
      expect(op.line).toBeGreaterThan(0);
    }
  });

  it("no duplicate operations for the same call site", () => {
    const code = `
void setup() {
  pinMode(11, OUTPUT);
}
void loop() {
  digitalRead(11);
}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    const drOps = pin11!.usedAt?.filter((u) => u.operation === "digitalRead");
    // Only one digitalRead call in the code → exactly one entry
    expect(drOps).toHaveLength(1);
  });

  it("for-loop with variable pin: detects range of pins", () => {
    const code = `
void setup() {
  for (int i=10; i<13; i++) {
    pinMode(i, OUTPUT);
  }
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    // Should detect pins 10, 11, 12
    expect(registry.find((p) => p.pin === "10")).toBeDefined();
    expect(registry.find((p) => p.pin === "11")).toBeDefined();
    expect(registry.find((p) => p.pin === "12")).toBeDefined();
  });

  it("braceless for-loop pinMode does not double-count pin 0", () => {
    const code = `
void setup() {
  for (byte i=0; i<3; i++)
    pinMode(i, INPUT);
}
void loop() {}
`;
    const registry = parser.buildStaticIORegistry(code);
    const pin0 = registry.find((p) => p.pin === "0");
    const pin1 = registry.find((p) => p.pin === "1");
    const pin2 = registry.find((p) => p.pin === "2");

    expect(pin0).toBeDefined();
    expect(pin1).toBeDefined();
    expect(pin2).toBeDefined();

    const pin0Modes = pin0!.usedAt?.filter((u) => u.operation === "pinMode:0") ?? [];
    expect(pin0Modes).toHaveLength(1);
  });
});

describe("Static IO Registry – Input Source Matrix", () => {
  it("numbers: pinMode/digitalRead/digitalWrite are detected on literal pin", () => {
    const code = `
void setup() {
  pinMode(7, OUTPUT);
}
void loop() {
  digitalRead(7);
  digitalWrite(7, HIGH);
}
`;

    const registry = parser.buildStaticIORegistry(code);
    const pin7 = registry.find((p) => p.pin === "7");
    expect(pin7).toBeDefined();
    expect(pin7!.pinMode).toBe(1);
    expect(pin7!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin7!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("constants: const byte pin is resolved for all three operations", () => {
    const code = `
const byte LED = 11;
void setup() {
  pinMode(LED, OUTPUT);
}
void loop() {
  digitalRead(LED);
  digitalWrite(LED, LOW);
}
`;

    const registry = parser.buildStaticIORegistry(code);
    const pin11 = registry.find((p) => p.pin === "11");
    expect(pin11).toBeDefined();
    expect(pin11!.pinMode).toBe(1);
    expect(pin11!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin11!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("loop counter: for(i=2..4) expands pinMode/digitalRead/digitalWrite to each pin", () => {
    const code = `
void setup() {
  for (int i = 2; i <= 4; i++) {
    pinMode(i, OUTPUT);
  }
}
void loop() {
  for (int i = 2; i <= 4; i++) {
    digitalRead(i);
    digitalWrite(i, HIGH);
  }
}
`;

    const registry = parser.buildStaticIORegistry(code);
    for (const pin of ["2", "3", "4"]) {
      const rec = registry.find((p) => p.pin === pin);
      expect(rec).toBeDefined();
      expect(rec!.pinMode).toBe(1);
      expect(rec!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
      expect(rec!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    }
  });

  it("arrays: PINS[index] resolves for pinMode/digitalRead/digitalWrite", () => {
    const code = `
const byte PINS[] = {8, 9, 10};
void setup() {
  pinMode(PINS[1], OUTPUT);
}
void loop() {
  digitalRead(PINS[1]);
  digitalWrite(PINS[1], LOW);
}
`;

    const registry = parser.buildStaticIORegistry(code);
    const pin9 = registry.find((p) => p.pin === "9");
    expect(pin9).toBeDefined();
    expect(pin9!.pinMode).toBe(1);
    expect(pin9!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin9!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("structs: led.pin resolves for pinMode/digitalRead/digitalWrite", () => {
    const code = `
struct LedConfig {
  byte pin;
};

LedConfig led = {12};

void setup() {
  pinMode(led.pin, OUTPUT);
}

void loop() {
  digitalRead(led.pin);
  digitalWrite(led.pin, HIGH);
}
`;

    const registry = parser.buildStaticIORegistry(code);
    const pin12 = registry.find((p) => p.pin === "12");
    expect(pin12).toBeDefined();
    expect(pin12!.pinMode).toBe(1);
    expect(pin12!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin12!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
  });

  it("for-loop with array access: pinMode(a[i], MODE) shows all pins with same line number", () => {
    const code = `
byte a[3] = {1, 3, 7};

void setup() {
  for (byte i=0; i<3; i++)
    pinMode(a[i], INPUT);
}
`;

    const registry = parser.buildStaticIORegistry(code);
    
    // All three pins should be present
    const pin1 = registry.find((p) => p.pin === "1");
    const pin3 = registry.find((p) => p.pin === "3");
    const pin7 = registry.find((p) => p.pin === "7");
    
    expect(pin1).toBeDefined();
    expect(pin3).toBeDefined();
    expect(pin7).toBeDefined();
    
    // All should have INPUT mode
    expect(pin1!.pinMode).toBe(0);
    expect(pin3!.pinMode).toBe(0);
    expect(pin7!.pinMode).toBe(0);
    
    // All should show the same line number (the for-loop line)
    expect(pin1!.usedAt?.some((u) => u.operation === "pinMode:0" && u.line === 5)).toBe(true);
    expect(pin3!.usedAt?.some((u) => u.operation === "pinMode:0" && u.line === 5)).toBe(true);
    expect(pin7!.usedAt?.some((u) => u.operation === "pinMode:0" && u.line === 5)).toBe(true);
  });

  it("for-loop with array access: digitalRead/Write(a[i]) shows all pins", () => {
    const code = `
byte pins[2] = {2, 4};

void loop() {
  for (byte i=0; i<2; i++) {
    digitalRead(pins[i]);
    digitalWrite(pins[i], HIGH);
  }
}
`;

    const registry = parser.buildStaticIORegistry(code);
    
    const pin2 = registry.find((p) => p.pin === "2");
    const pin4 = registry.find((p) => p.pin === "4");
    
    expect(pin2).toBeDefined();
    expect(pin4).toBeDefined();
    
    // Both should have digitalRead and digitalWrite entries
    expect(pin2!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin2!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    expect(pin4!.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    expect(pin4!.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    
    // All should show the same line number (the for-loop line)
    const loopLine = 5;
    expect(pin2!.usedAt?.some((u) => u.operation === "digitalRead" && u.line === loopLine)).toBe(true);
    expect(pin4!.usedAt?.some((u) => u.operation === "digitalRead" && u.line === loopLine)).toBe(true);
  });
});
