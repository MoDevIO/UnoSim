/**
 * registry-manager-conflicts.test.ts
 *
 * Unit tests for RegistryManager.detectConflictsForPin() (tested via the
 * public addPin() + finishCollection() API).
 *
 * Three scenarios that must survive in the RUNTIME registry (i.e. after the
 * IO_REGISTRY burst has been processed) – matching screenshot evidence:
 *
 *  Case A – TC9:  INPUT mode + digitalWrite → conflict: true
 *  Case B – TC9b: OUTPUT mode + digitalRead → conflict: true  (already fixed)
 *  Case C – TC11: multiple modes on same pin  → conflict: true  (already fixed)
 *  Case D – correct use: OUTPUT + write → NO conflict
 *  Case E – no-mode pin: write without any pinMode → NO conflict, no modes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RegistryManager } from "../../../server/services/registry-manager";
import type { IOPinRecord } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal IOPinRecord with a given set of usedAt operations. */
function pinWith(
  pin: string,
  ops: Array<{ operation: string; line?: number }>,
): IOPinRecord {
  return {
    pin,
    pinId: Number(pin),
    defined: true,
    usedAt: ops.map((o) => ({ operation: o.operation, line: o.line ?? 1 })),
  };
}

/**
 * Runs the full addPin → finishCollection lifecycle and returns the final
 * registry snapshot delivered to the onUpdate callback.
 */
function simulateFinishCollection(pins: IOPinRecord[]): IOPinRecord[] {
  let captured: IOPinRecord[] = [];
  const mgr = new RegistryManager({
    onUpdate: (reg) => { captured = reg; },
  });
  mgr.startCollection();
  for (const p of pins) {
    mgr.addPin(p);
  }
  mgr.finishCollection();
  mgr.destroy();
  return captured;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistryManager – runtime conflict detection (detectConflictsForPin)", () => {
  // ── Case A: TC9 – INPUT mode + write ────────────────────────────────────
  it("TC9 runtime: pinMode(INPUT) + digitalWrite → conflict: true", () => {
    const registry = simulateFinishCollection([
      pinWith("0", [
        { operation: "pinMode:0" },    // INPUT = 0
        { operation: "digitalWrite" },
      ]),
    ]);

    const pin0 = registry.find((p) => p.pin === "0");
    expect(pin0, "pin 0 must be in registry").toBeDefined();
    expect(pin0!.conflict).toBe(true);
    expect(pin0!.conflictMessage).toBeTruthy();
  });

  it("TC9 runtime: pinMode(INPUT_PULLUP) + analogWrite → conflict: true", () => {
    const registry = simulateFinishCollection([
      pinWith("3", [
        { operation: "pinMode:2" },    // INPUT_PULLUP = 2
        { operation: "analogWrite" },
      ]),
    ]);

    const pin3 = registry.find((p) => p.pin === "3");
    expect(pin3, "pin 3 must be in registry").toBeDefined();
    expect(pin3!.conflict).toBe(true);
  });

  // ── Case B: TC9b – OUTPUT mode + read (regression guard) ────────────────
  it("TC9b runtime: pinMode(OUTPUT) + digitalRead → conflict: true", () => {
    const registry = simulateFinishCollection([
      pinWith("5", [
        { operation: "pinMode:1" },    // OUTPUT = 1
        { operation: "digitalRead" },
      ]),
    ]);

    const pin5 = registry.find((p) => p.pin === "5");
    expect(pin5, "pin 5 must be in registry").toBeDefined();
    expect(pin5!.conflict).toBe(true);
    expect(pin5!.conflictMessage).toMatch(/output/i);
  });

  // ── Case C: TC11 – multiple different modes (regression guard) ───────────
  it("TC11 runtime: multiple distinct modes → conflict: true", () => {
    const registry = simulateFinishCollection([
      pinWith("6", [
        { operation: "pinMode:0" },    // INPUT
        { operation: "pinMode:1" },    // OUTPUT
      ]),
    ]);

    const pin6 = registry.find((p) => p.pin === "6");
    expect(pin6, "pin 6 must be in registry").toBeDefined();
    expect(pin6!.conflict).toBe(true);
    expect(pin6!.conflictMessage).toMatch(/multiple modes/i);
  });

  // ── Case D: correct use – OUTPUT + write → NO conflict ──────────────────
  it("Case D runtime: pinMode(OUTPUT) + digitalWrite → NO conflict", () => {
    const registry = simulateFinishCollection([
      pinWith("1", [
        { operation: "pinMode:1" },    // OUTPUT = 1
        { operation: "digitalWrite" },
      ]),
    ]);

    const pin1 = registry.find((p) => p.pin === "1");
    expect(pin1, "pin 1 must be in registry").toBeDefined();
    expect(pin1!.conflict).toBeFalsy();
  });

  // ── Case E: no-mode pin – write without pinMode → NO conflict, no modes ──
  it("Case E runtime: write without any pinMode → no conflict, no pinModeModes", () => {
    const registry = simulateFinishCollection([
      pinWith("2", [
        { operation: "digitalWrite" },
      ]),
    ]);

    const pin2 = registry.find((p) => p.pin === "2");
    expect(pin2, "pin 2 must be in registry").toBeDefined();
    expect(pin2!.conflict).toBeFalsy();
    // No mode was set – pinModeModes comes from addPin's incoming record, which
    // has no modes, so the UI will render the red × indicator.
    const hasModeDef = (pin2!.usedAt ?? []).some((u) =>
      u.operation.startsWith("pinMode:"),
    );
    expect(hasModeDef).toBe(false);
  });

  // ── Full three-pin scenario from the screenshot ───────────────────────────
  it("Screenshot scenario: pin0=INPUT+write(conflict), pin1=OUTPUT+write(ok), pin2=write-only(no-conflict)", () => {
    const registry = simulateFinishCollection([
      pinWith("0", [{ operation: "pinMode:0" }, { operation: "digitalWrite" }]),
      pinWith("1", [{ operation: "pinMode:1" }, { operation: "digitalWrite" }]),
      pinWith("2", [{ operation: "digitalWrite" }]),
    ]);

    const pin0 = registry.find((p) => p.pin === "0");
    const pin1 = registry.find((p) => p.pin === "1");
    const pin2 = registry.find((p) => p.pin === "2");

    expect(pin0!.conflict).toBe(true);   // INPUT + write → conflict
    expect(pin1!.conflict).toBeFalsy();  // OUTPUT + write → OK
    expect(pin2!.conflict).toBeFalsy();  // no mode + write → no conflict (just no-mode indicator)
  });
});
