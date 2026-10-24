import { describe, expect, it } from "vitest";
import type { IOPinRecord } from "@shared/schema";
import { mergeIoRegistry } from "@/lib/io-registry-merge";

/** Plan 4.9 merges per pin of the selected board, not by the Uno's rule A<n> = 14 + n. */
describe("mergeIoRegistry per board", () => {
  const record = (pin: string, extra: Partial<IOPinRecord> = {}): IOPinRecord => ({ pin, defined: true, usedAt: [], ...extra });
  const analogReadAtRuntime = (pin: string) => record(pin, { usedAt: [{ line: 0, operation: "analogRead" }] });
  const origins = (records: IOPinRecord[]) => records.map((entry) => [entry.pin, entry.origin ?? {}]);

  it("keeps digital pin 14 of the Mega 2560 apart from A0 (pin 54)", () => {
    const statics = [record("14", { digitalWriteLines: [3], pinMode: 1 }), record("A0", { analogReadLines: [4] })];

    expect(origins(mergeIoRegistry(statics, [analogReadAtRuntime("A0")], "mega2560"))).toEqual([
      ["14", {}],
      ["A0", { analogRead: "both" }],
    ]);
    expect(origins(mergeIoRegistry(statics, [analogReadAtRuntime("54")], "mega2560"))[1]).toEqual(["A0", { analogRead: "both" }]);
  });

  it("merges A1 and pin 2 of the ATtiny85", () => {
    expect(origins(mergeIoRegistry([record("A1", { analogReadLines: [5] })], [analogReadAtRuntime("2")], "attiny85"))).toEqual([
      ["A1", { analogRead: "both" }],
    ]);
  });

  it("keeps the Uno's rule without a board", () => {
    expect(origins(mergeIoRegistry([record("A0", { analogReadLines: [4] })], [analogReadAtRuntime("14")]))).toEqual([
      ["A0", { analogRead: "both" }],
    ]);
  });
});
