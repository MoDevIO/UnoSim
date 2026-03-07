/**
 * registry-pin-dedup.test.ts
 *
 * Unit & Integration test suite for IO-Registry pin deduplication and
 * conflict detection. All tests run against the pure in-memory
 * RegistryManager API or the CodeParser static analyser – no binary
 * compilation or SandboxRunner required, so they are fast (<1 ms each).
 *
 * Scenarios covered:
 *   1. Simple deduplication  – same pin registered multiple times
 *   2. Variable / const pins – CodeParser static analysis for named pins
 *   3. Loop invariance       – runtime & static: each logical pin appears once
 *   4. Array / struct access – repeated updatePinMode for the same pin number
 *   5. Conflict detection    – mode change (INPUT→OUTPUT) and write-to-INPUT
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";
import { CodeParser } from "../../../shared/code-parser";
import type { IOPinRecord } from "@shared/schema";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeManager(onUpdate = vi.fn()) {
  return new RegistryManager({ onUpdate });
}

/** Simulate a binary that emits IO_REGISTRY_START, N pins, IO_REGISTRY_END */
function runStaticCollection(
  manager: RegistryManager,
  pins: IOPinRecord[],
): void {
  manager.startCollection();
  for (const p of pins) {
    manager.addPin(p);
  }
  manager.finishCollection();
}

const parser = new CodeParser();

// ─── Scenario 1 ──────────────────────────────────────────────────────────────

describe("Scenario 1 – Simple Deduplication", () => {
  let manager: RegistryManager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("runtime: updatePinMode called twice with same mode → exactly one registry entry", () => {
    runStaticCollection(manager, [
      { pin: "1", defined: true, pinMode: 1, usedAt: [] },
    ]);

    // Binary emits [[PIN_MODE:1:1]] a second time (e.g. loop re-runs setup)
    manager.updatePinMode(1, 1);
    manager.updatePinMode(1, 1);

    const registry = manager.getRegistry();
    const pin1Entries = registry.filter((p) => p.pin === "1");
    expect(pin1Entries).toHaveLength(1);
  });

  it("runtime: updatePinMode called N times for the same pin → still one entry", () => {
    runStaticCollection(manager, []);

    // Simulates flicker: loop body calls pinMode(1, OUTPUT) every iteration
    for (let i = 0; i < 10; i++) {
      manager.updatePinMode(1, 1); // OUTPUT
    }

    const registry = manager.getRegistry();
    const pin1Entries = registry.filter((p) => p.pin === "1");
    expect(pin1Entries).toHaveLength(1);
  });

  it("runtime: re-confirmation of same mode adds operation entry at most once per mode value", () => {
    runStaticCollection(manager, [
      { pin: "1", defined: true, pinMode: 1, usedAt: [] },
    ]);

    // Call updatePinMode with OUTPUT three times – usedAt should contain "pinMode:1" once
    manager.updatePinMode(1, 1);
    manager.updatePinMode(1, 1);
    manager.updatePinMode(1, 1);

    const pin1 = manager.getRegistry().find((p) => p.pin === "1");
    expect(pin1).toBeDefined();
    const outputOps = pin1!.usedAt?.filter((u) => u.operation === "pinMode:1") ?? [];
    expect(outputOps).toHaveLength(1);
  });

  it("static collection: addPin for same pin string twice → merged into one entry", () => {
    // addPin now deduplicates by pin name. If the binary emits the same pin
    // twice (e.g. due to variable aliasing), the entries are merged.
    runStaticCollection(manager, [
      { pin: "5", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
      { pin: "5", defined: false, pinMode: 0, usedAt: [{ line: 6, operation: "pinMode:0" }] },
    ]);

    const pin5Entries = manager.getRegistry().filter((p) => p.pin === "5");
    expect(pin5Entries).toHaveLength(1);
    // Last-write-wins for mode
    expect(pin5Entries[0].pinMode).toBe(0);
    // Both usedAt entries are preserved
    expect(pin5Entries[0].usedAt).toHaveLength(2);
    // Conflict detected because mode changed from 1 to 0
    expect(pin5Entries[0].hasConflict).toBe(true);
  });

  it("static + runtime combination: static entry + updatePinMode → still one entry", () => {
    // Binary emits static registry then immediately emits a PIN_MODE marker
    runStaticCollection(manager, [
      { pin: "3", defined: true, pinMode: 0, usedAt: [] }, // INPUT from static
    ]);

    manager.updatePinMode(3, 0); // same mode at runtime

    const pin3Entries = manager.getRegistry().filter((p) => p.pin === "3");
    expect(pin3Entries).toHaveLength(1);
    expect(pin3Entries[0].pinMode).toBe(0);
  });
});

// ─── Scenario 2 ──────────────────────────────────────────────────────────────

describe("Scenario 2 – Variable / const Pin Names (CodeParser static analysis)", () => {
  it("no warning when const variable is used consistently with pinMode(var, …)", () => {
    const code = `
      const int led = 13;
      void setup() {
        pinMode(led, OUTPUT);
      }
      void loop() {
        digitalWrite(led, HIGH);
        delay(500);
        digitalWrite(led, LOW);
        delay(500);
      }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    // 'led' is covered by pinMode(led, …), so no "variable not in pinMode" warning
    const varWarnings = messages.filter(
      (m) => m.message.includes("'led'") && m.message.includes("digitalRead/digitalWrite"),
    );
    expect(varWarnings).toHaveLength(0);
  });

  it("warning when const variable used in digitalRead/Write but missing from pinMode", () => {
    const code = `
      const int sensor = 7;
      void setup() { }
      void loop() {
        int val = digitalRead(sensor);
      }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    // 'sensor' is used without a matching pinMode(sensor, …)
    const varWarnings = messages.filter(
      (m) => m.message.includes("'sensor'") || m.message.includes("variable"),
    );
    expect(varWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it("no duplicate-pinMode warning when variable is used only once", () => {
    const code = `
      const int led = 13;
      void setup() {
        pinMode(led, OUTPUT);
      }
      void loop() { }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    const dupWarnings = messages.filter(
      (m) => m.message.includes("multiple") || m.message.includes("duplicate"),
    );
    expect(dupWarnings).toHaveLength(0);
  });

  it("duplicate-mode warning when literal pin 13 has two different modes in code", () => {
    const code = `
      void setup() {
        pinMode(13, INPUT);
        pinMode(13, OUTPUT);
      }
      void loop() { }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    // Should produce a "multiple pinMode() calls with different modes" warning for pin 13
    const conflictWarning = messages.find(
      (m) => m.message.includes("13") && m.message.includes("multiple"),
    );
    expect(conflictWarning).toBeDefined();
    expect(conflictWarning!.category).toBe("pins");
  });

  it("duplicate-mode warning when literal pin has same mode twice", () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
        pinMode(5, OUTPUT);
      }
      void loop() { }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    const dupWarning = messages.find(
      (m) =>
        m.message.includes("5") &&
        (m.message.includes("multiple") || m.message.includes("duplicate")),
    );
    expect(dupWarning).toBeDefined();
  });

  it("RegistryManager: runtime pin resolved from named const → single entry for pin 13", () => {
    // Simulates: const int led = 13; — binary emits [[PIN_MODE:13:1]] at runtime
    const manager = makeManager();

    runStaticCollection(manager, [
      { pin: "13", defined: true, pinMode: 1, usedAt: [] },
    ]);

    // Even if the binary emits the marker twice
    manager.updatePinMode(13, 1);

    const pin13 = manager.getRegistry().find((p) => p.pin === "13");
    expect(pin13).toBeDefined();
    expect(manager.getRegistry().filter((p) => p.pin === "13")).toHaveLength(1);
  });
});

// ─── Scenario 3 ──────────────────────────────────────────────────────────────

describe("Scenario 3 – Loop Invariance (static & runtime)", () => {
  it("CodeParser: detects for-loop pin range and infers pins 10, 11, 12", () => {
    // getLoopConfiguredPins is private; we verify indirectly via parseHardwareCompatibility
    // which suppresses "no-pinMode" warnings for loop-covered pins
    const code = `
      void setup() {
        for (int i = 10; i < 13; i++) {
          pinMode(i, OUTPUT);
        }
      }
      void loop() {
        for (int i = 10; i < 13; i++) {
          digitalWrite(i, HIGH);
        }
      }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    // No "used without pinMode" warning because the loop configures 10,11,12
    const noPinModeWarnings = messages.filter(
      (m) => m.message.includes("without") && m.message.includes("pinMode"),
    );
    expect(noPinModeWarnings).toHaveLength(0);
  });

  it("CodeParser: no 'duplicate pinMode' warning for loop-based configuration", () => {
    // The loop calls pinMode(i, OUTPUT) multiple times per run but the parser
    // sees only one literal call context → should not produce spurious duplicates
    const code = `
      void setup() {
        for (int i = 0; i < 5; i++) {
          pinMode(i, OUTPUT);
        }
      }
      void loop() { }
    `;

    const messages = parser.parseHardwareCompatibility(code);
    const dupWarnings = messages.filter(
      (m) =>
        (m.message.includes("multiple") || m.message.includes("duplicate")) &&
        m.category === "pins",
    );
    expect(dupWarnings).toHaveLength(0);
  });

  it("runtime: each pin in range registered exactly once after multiple loop iterations", () => {
    const manager = makeManager();
    runStaticCollection(manager, []);

    // Simulate 3 loop() executions, each calling: for i in [10,11,12]: updatePinMode(i, OUTPUT)
    const LOOP_ITERATIONS = 3;
    for (let iter = 0; iter < LOOP_ITERATIONS; iter++) {
      manager.updatePinMode(10, 1);
      manager.updatePinMode(11, 1);
      manager.updatePinMode(12, 1);
    }

    const registry = manager.getRegistry();
    expect(registry.filter((p) => p.pin === "10")).toHaveLength(1);
    expect(registry.filter((p) => p.pin === "11")).toHaveLength(1);
    expect(registry.filter((p) => p.pin === "12")).toHaveLength(1);
  });

  it("runtime: total registry size equals unique pin count despite many iterations", () => {
    const manager = makeManager();
    runStaticCollection(manager, []);

    const pins = [10, 11, 12];
    for (let iter = 0; iter < 50; iter++) {
      for (const p of pins) {
        manager.updatePinMode(p, 1);
      }
    }

    expect(manager.getRegistry()).toHaveLength(pins.length);
  });

  it("runtime: loop over analog pins A0–A5 → each analog pin entry appears once", () => {
    const manager = makeManager();
    runStaticCollection(manager, []);

    // Analog pins are pins 14..19 internally, shown as A0..A5
    for (let iter = 0; iter < 5; iter++) {
      for (let ap = 14; ap <= 19; ap++) {
        manager.updatePinMode(ap, 0); // INPUT
      }
    }

    const analogEntries = manager.getRegistry().filter((p) => p.pin.startsWith("A"));
    expect(analogEntries).toHaveLength(6); // A0..A5
  });
});

// ─── Scenario 4 ──────────────────────────────────────────────────────────────

describe("Scenario 4 – Array / Struct Runtime Tracking", () => {
  it("same physical pin accessed via repeated array index → single registry entry", () => {
    // Simulates: int pins[] = {5, 5, 5}; for(int i=0;i<3;i++) { pinMode(pins[i], INPUT); }
    // The binary resolves each array access to pin 5 and emits [[PIN_MODE:5:0]] three times
    const manager = makeManager();
    runStaticCollection(manager, []);

    manager.updatePinMode(5, 0);
    manager.updatePinMode(5, 0);
    manager.updatePinMode(5, 0);

    const registry = manager.getRegistry();
    const pin5Entries = registry.filter((p) => p.pin === "5");
    expect(pin5Entries).toHaveLength(1);
  });

  it("different array slots resolving to different pins → one entry per logical pin", () => {
    // int pins[] = {3, 5, 7}; for(i) { pinMode(pins[i], OUTPUT); }
    const manager = makeManager();
    runStaticCollection(manager, []);

    [3, 5, 7].forEach((pin) => manager.updatePinMode(pin, 1));
    [3, 5, 7].forEach((pin) => manager.updatePinMode(pin, 1)); // second pass

    const registry = manager.getRegistry();
    expect(registry.filter((p) => p.pin === "3")).toHaveLength(1);
    expect(registry.filter((p) => p.pin === "5")).toHaveLength(1);
    expect(registry.filter((p) => p.pin === "7")).toHaveLength(1);
    expect(registry).toHaveLength(3);
  });

  it("struct-based pin: repeated mode updates preserve the latest mode, no duplicates", () => {
    // struct { int pin; } dev = { .pin = 9 };
    // loop: pinMode(dev.pin, OUTPUT); → binary emits [[PIN_MODE:9:1]] each loop
    const manager = makeManager();
    runStaticCollection(manager, []);

    for (let i = 0; i < 20; i++) {
      manager.updatePinMode(9, 1); // OUTPUT
    }

    const pin9 = manager.getRegistry().find((p) => p.pin === "9");
    expect(pin9).toBeDefined();
    expect(pin9!.pinMode).toBe(1); // OUTPUT
    expect(manager.getRegistry().filter((p) => p.pin === "9")).toHaveLength(1);
  });

  it("array with mixed pins: 100 runtime updates → registry size equals unique pin count", () => {
    const UNIQUE_PINS = [2, 4, 6, 8];
    const manager = makeManager();
    runStaticCollection(manager, []);

    // Simulate high-frequency loop: picks array[i % 4] each iteration
    for (let i = 0; i < 100; i++) {
      manager.updatePinMode(UNIQUE_PINS[i % UNIQUE_PINS.length], 1);
    }

    expect(manager.getRegistry()).toHaveLength(UNIQUE_PINS.length);
  });
});

// ─── Scenario 5 ──────────────────────────────────────────────────────────────

describe("Scenario 5 – Conflict Detection", () => {
  describe("5a – Mode-change conflict (INPUT → OUTPUT and vice versa)", () => {
    it("hasConflict set when mode changes from INPUT to OUTPUT at runtime", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 0, usedAt: [] }, // initially INPUT
      ]);

      onUpdate.mockClear();
      manager.updatePinMode(7, 1); // now OUTPUT → conflict

      const pin7 = manager.getRegistry().find((p) => p.pin === "7");
      expect(pin7).toBeDefined();
      expect(pin7!.hasConflict).toBe(true);
      expect(pin7!.pinMode).toBe(1); // mode updated to OUTPUT
    });

    it("hasConflict set when mode changes from OUTPUT to INPUT at runtime", () => {
      const manager = makeManager();

      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 1, usedAt: [] }, // OUTPUT
      ]);

      manager.updatePinMode(7, 0); // INPUT → conflict

      const pin7 = manager.getRegistry().find((p) => p.pin === "7");
      expect(pin7!.hasConflict).toBe(true);
    });

    it("hasConflict set when mode changes from INPUT to INPUT_PULLUP", () => {
      const manager = makeManager();
      runStaticCollection(manager, [
        { pin: "4", defined: true, pinMode: 0, usedAt: [] }, // INPUT
      ]);

      manager.updatePinMode(4, 2); // INPUT_PULLUP → mode changed → conflict

      const pin4 = manager.getRegistry().find((p) => p.pin === "4");
      expect(pin4!.hasConflict).toBe(true);
    });

    it("NO conflict when same mode is reaffirmed at runtime", () => {
      const manager = makeManager();

      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 1, usedAt: [] }, // OUTPUT
      ]);

      manager.updatePinMode(7, 1); // same mode → no conflict
      manager.updatePinMode(7, 1); // again

      const pin7 = manager.getRegistry().find((p) => p.pin === "7");
      expect(pin7!.hasConflict).toBeFalsy();
    });

    it("NO conflict when a brand-new pin is registered without prior definition", () => {
      const manager = makeManager();
      runStaticCollection(manager, []);

      manager.updatePinMode(8, 1); // first-time registration

      const pin8 = manager.getRegistry().find((p) => p.pin === "8");
      expect(pin8!.hasConflict).toBeFalsy();
    });

    it("conflict triggers an immediate onUpdate callback with reason 'pin-mode-conflict'", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 0, usedAt: [] },
      ]);
      onUpdate.mockClear();

      manager.updatePinMode(7, 1); // mode change → conflict

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [, , reason] = onUpdate.mock.calls[0];
      expect(reason).toBe("pin-mode-conflict");
    });

    it("once hasConflict is set it persists through subsequent same-mode calls", () => {
      const manager = makeManager();
      runStaticCollection(manager, [
        { pin: "6", defined: true, pinMode: 0, usedAt: [] },
      ]);

      manager.updatePinMode(6, 1); // conflict set
      manager.updatePinMode(6, 1); // same mode again – conflict must not be cleared

      const pin6 = manager.getRegistry().find((p) => p.pin === "6");
      expect(pin6!.hasConflict).toBe(true);
    });
  });

  describe("5b – Write-to-INPUT conflict", () => {
    it("hasConflict set when updatePinValue is called on an INPUT pin", () => {
      const manager = makeManager();
      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 0, usedAt: [] }, // INPUT
      ]);

      manager.updatePinValue(7, 1); // simulates: digitalWrite(7, HIGH)

      const pin7 = manager.getRegistry().find((p) => p.pin === "7");
      expect(pin7!.hasConflict).toBe(true);
    });

    it("write-to-INPUT triggers onUpdate callback with reason 'pin-write-to-input-conflict'", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 0, usedAt: [] },
      ]);
      onUpdate.mockClear();

      manager.updatePinValue(7, 1);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [, , reason] = onUpdate.mock.calls[0];
      expect(reason).toBe("pin-write-to-input-conflict");
    });

    it("NO conflict when updatePinValue is called on an OUTPUT pin", () => {
      const manager = makeManager();
      runStaticCollection(manager, [
        { pin: "7", defined: true, pinMode: 1, usedAt: [] }, // OUTPUT
      ]);

      manager.updatePinValue(7, 1); // normally writes to OUTPUT – no conflict

      const pin7 = manager.getRegistry().find((p) => p.pin === "7");
      expect(pin7!.hasConflict).toBeFalsy();
    });

    it("NO repeat onUpdate calls for the same write-to-INPUT conflict", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "3", defined: true, pinMode: 0, usedAt: [] },
      ]);
      onUpdate.mockClear();

      manager.updatePinValue(3, 1); // first write → conflict
      manager.updatePinValue(3, 0); // second write → already conflicted, no second fire
      manager.updatePinValue(3, 1); // third write

      // Only one callback for the first conflict discovery
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it("analog INPUT pin: updatePinValue for A0 (pin 14) marks conflict", () => {
      const manager = makeManager();
      runStaticCollection(manager, [
        { pin: "A0", defined: true, pinMode: 0, usedAt: [] }, // A0 as INPUT
      ]);

      manager.updatePinValue(14, 1); // internal pin 14 = A0, writing HIGH

      const a0 = manager.getRegistry().find((p) => p.pin === "A0");
      expect(a0!.hasConflict).toBe(true);
    });
  });

  describe("5c – Static conflict detection via CodeParser", () => {
    it("warns about INPUT→OUTPUT mode change on same pin in source code", () => {
      const code = `
        void setup() {
          pinMode(7, INPUT);
          pinMode(7, OUTPUT);
        }
        void loop() { }
      `;

      const messages = parser.parseHardwareCompatibility(code);
      const conflictMsg = messages.find(
        (m) =>
          m.message.includes("7") &&
          m.message.includes("multiple") &&
          m.category === "pins",
      );
      expect(conflictMsg).toBeDefined();
      expect(conflictMsg!.type).toBe("warning");
    });

    it("warns about OUTPUT→INPUT mode change on same pin in source code", () => {
      const code = `
        void setup() {
          pinMode(4, OUTPUT);
          pinMode(4, INPUT);
        }
        void loop() { }
      `;

      const messages = parser.parseHardwareCompatibility(code);
      const conflictMsg = messages.find(
        (m) => m.message.includes("4") && m.message.includes("multiple"),
      );
      expect(conflictMsg).toBeDefined();
    });

    it("detects digital/analog pin conflict via parsePinConflicts", () => {
      const code = `
        void setup() {
          pinMode(A0, INPUT);
        }
        void loop() {
          digitalWrite(14, HIGH);  // A0 used as digital
          int val = analogRead(A0); // also as analog
        }
      `;

      const messages = parser.parsePinConflicts(code);
      // A0 == pin 14: used as both digital and analog → should warn
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const analogDigitalConflict = messages.find(
        (m) => m.message.includes("digital") && m.message.includes("analog"),
      );
      expect(analogDigitalConflict).toBeDefined();
    });
  });

  describe("5d – hasConflict in registry hash (change detection)", () => {
    it("onUpdate fires when hasConflict transitions from false to true", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "2", defined: true, pinMode: 0, usedAt: [] },
      ]);

      const callsBefore = onUpdate.mock.calls.length;
      manager.updatePinMode(2, 1); // conflict
      const callsAfter = onUpdate.mock.calls.length;

      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    it("onUpdate does NOT fire when already-conflicted pin mode is re-applied", () => {
      const onUpdate = vi.fn();
      const manager = makeManager(onUpdate);

      runStaticCollection(manager, [
        { pin: "2", defined: true, pinMode: 0, usedAt: [] },
      ]);

      manager.updatePinMode(2, 1); // conflict set HERE
      onUpdate.mockClear();

      manager.updatePinMode(2, 1); // same mode again – hash unchanged due to same state
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});

// ─── Scenario 6 ──────────────────────────────────────────────────────────────

describe("Scenario 6 – Double-Compile (recompilation clears old entries)", () => {
  let manager: RegistryManager;
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onUpdate = vi.fn();
    manager = makeManager(onUpdate);
  });

  it("startCollection clears registry before new collection", () => {
    // First compilation cycle
    runStaticCollection(manager, [
      { pin: "12", defined: true, pinMode: 0, usedAt: [{ line: 4, operation: "pinMode:0" }] },
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
    ]);
    expect(manager.getRegistry()).toHaveLength(2);

    // Second compilation cycle – startCollection must clear old entries
    runStaticCollection(manager, [
      { pin: "7", defined: true, pinMode: 1, usedAt: [{ line: 3, operation: "pinMode:1" }] },
    ]);
    expect(manager.getRegistry()).toHaveLength(1);
    expect(manager.getRegistry()[0].pin).toBe("7");
  });

  it("reset() clears entire registry", () => {
    runStaticCollection(manager, [
      { pin: "0", defined: true, pinMode: 1, usedAt: [] },
      { pin: "1", defined: true, pinMode: 1, usedAt: [] },
    ]);
    manager.updatePinMode(0, 1);
    manager.updatePinMode(1, 1);
    expect(manager.getRegistry().length).toBeGreaterThan(0);

    manager.reset();
    expect(manager.getRegistry()).toHaveLength(0);
  });

  it("full recompile cycle: reset → collection → runtime keeps only new pins", () => {
    // === First compilation ===
    runStaticCollection(manager, [
      { pin: "12", defined: true, pinMode: 0, usedAt: [{ line: 4, operation: "pinMode:0" }] },
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
      { pin: "0",  defined: true, pinMode: 1, usedAt: [{ line: 8, operation: "pinMode:1" }] },
      { pin: "1",  defined: true, pinMode: 1, usedAt: [{ line: 8, operation: "pinMode:1" }] },
    ]);
    manager.updatePinMode(12, 0);
    manager.updatePinMode(11, 1);
    manager.updatePinMode(11, 0); // conflict on pin 11
    manager.updatePinMode(0, 1);
    manager.updatePinMode(1, 1);

    const firstRegistry = manager.getRegistry();
    expect(firstRegistry).toHaveLength(4);
    const pin11 = firstRegistry.find((p) => p.pin === "11");
    expect(pin11?.hasConflict).toBe(true);

    // === Simulate recompilation (as sandbox-runner does) ===
    manager.reset();

    // Second compilation with different pins
    runStaticCollection(manager, [
      { pin: "7", defined: true, pinMode: 1, usedAt: [{ line: 3, operation: "pinMode:1" }] },
      { pin: "8", defined: true, pinMode: 0, usedAt: [{ line: 4, operation: "pinMode:0" }] },
    ]);
    manager.updatePinMode(7, 1);
    manager.updatePinMode(8, 0);

    const secondRegistry = manager.getRegistry();
    expect(secondRegistry).toHaveLength(2);
    expect(secondRegistry.map((p) => p.pin).sort()).toEqual(["7", "8"]);
    // No old pins (0, 1, 11, 12) should remain
    expect(secondRegistry.find((p) => p.pin === "12")).toBeUndefined();
    expect(secondRegistry.find((p) => p.pin === "11")).toBeUndefined();
    expect(secondRegistry.find((p) => p.pin === "0")).toBeUndefined();
    expect(secondRegistry.find((p) => p.pin === "1")).toBeUndefined();
    // No conflicts carry over
    expect(secondRegistry.every((p) => !p.hasConflict)).toBe(true);
  });

  it("two identical compilations: no duplicate entries", () => {
    const staticPins: IOPinRecord[] = [
      { pin: "12", defined: true, pinMode: 0, usedAt: [{ line: 4, operation: "pinMode:0" }] },
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
    ];

    // First compile
    runStaticCollection(manager, staticPins);
    manager.updatePinMode(12, 0);
    manager.updatePinMode(11, 1);
    expect(manager.getRegistry()).toHaveLength(2);

    // Recompile same code
    manager.reset();
    runStaticCollection(manager, staticPins);
    manager.updatePinMode(12, 0);
    manager.updatePinMode(11, 1);

    const registry = manager.getRegistry();
    expect(registry).toHaveLength(2);
    expect(registry.filter((p) => p.pin === "12")).toHaveLength(1);
    expect(registry.filter((p) => p.pin === "11")).toHaveLength(1);
  });

  it("addPin deduplicates during collection: same pin with different modes → merged + conflict", () => {
    // Simulates: const byte P1=11; pinMode(11, OUTPUT); pinMode(P1, INPUT);
    // Binary emits IO_PIN for pin 11 twice with different modes
    runStaticCollection(manager, [
      { pin: "11", defined: true, pinMode: 1, usedAt: [{ line: 5, operation: "pinMode:1" }] },
      { pin: "11", defined: true, pinMode: 0, usedAt: [{ line: 6, operation: "pinMode:0" }] },
    ]);

    const registry = manager.getRegistry();
    const pin11Entries = registry.filter((p) => p.pin === "11");
    expect(pin11Entries).toHaveLength(1);
    expect(pin11Entries[0].hasConflict).toBe(true);
    // Both usedAt entries kept
    expect(pin11Entries[0].usedAt).toHaveLength(2);
  });

  it("onUpdate callback receives clean registry on second compile", () => {
    // First compile
    runStaticCollection(manager, [
      { pin: "5", defined: true, pinMode: 1, usedAt: [] },
    ]);
    manager.updatePinMode(5, 1);

    manager.reset();
    onUpdate.mockClear();

    // Second compile
    runStaticCollection(manager, [
      { pin: "9", defined: true, pinMode: 0, usedAt: [] },
    ]);

    // The onUpdate from finishCollection should have exactly 1 pin (pin 9)
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const sentRegistry = lastCall[0] as IOPinRecord[];
    expect(sentRegistry).toHaveLength(1);
    expect(sentRegistry[0].pin).toBe("9");
  });

  it("runtime updatePinMode between reset and startCollection creates temporary entries that get cleared", () => {
    // First compile
    runStaticCollection(manager, [
      { pin: "5", defined: true, pinMode: 1, usedAt: [] },
    ]);

    // Simulate recompile
    manager.reset();

    // Runtime events arrive before IO_REGISTRY_START (race condition)
    manager.updatePinMode(5, 1);
    expect(manager.getRegistry()).toHaveLength(1);

    // Then startCollection clears everything
    manager.startCollection();
    // After startCollection, old entries flushed and cleared
    // New collection starts fresh
    manager.addPin({ pin: "9", defined: true, pinMode: 0, usedAt: [] });
    manager.finishCollection();

    const registry = manager.getRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0].pin).toBe("9");
  });
});
