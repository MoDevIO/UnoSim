import { describe, expect, it } from "vitest";
import type { IOPinRecord } from "@shared/schema";
import { mergeIoRegistry } from "../../../client/src/lib/io-registry-merge";

const staticPin13: IOPinRecord = {
  pin: "13",
  defined: true,
  pinMode: 1,
  pinModeLines: [4],
  pinModeModes: ["OUTPUT"],
  digitalWriteLines: [9, 11],
};

describe("mergeIoRegistry (plan P3.7)", () => {
  it("keeps static entries and their lines, and marks what the run confirmed as seen by both", () => {
    const runtime: IOPinRecord[] = [{ pin: "13", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }, { line: 0, operation: "digitalWrite" }] }];

    const [merged] = mergeIoRegistry([staticPin13], runtime);

    expect(merged.pinModeLines).toEqual([4]);
    expect(merged.digitalWriteLines).toEqual([9, 11]);
    expect(merged.origin).toEqual({ pinMode: "both", digitalWrite: "both" });
    expect(merged.conflict).toBeUndefined();
  });

  it("adds a function only the run saw as a runtime finding, next to the static lines", () => {
    const runtime: IOPinRecord[] = [{ pin: "13", defined: true, usedAt: [{ line: 0, operation: "digitalRead" }] }];

    const [merged] = mergeIoRegistry([staticPin13], runtime);

    expect(merged.digitalReadLines).toEqual(["runtime"]);
    expect(merged.digitalWriteLines).toEqual([9, 11]);
    expect(merged.origin).toEqual({ pinMode: "static", digitalWrite: "static", digitalRead: "runtime" });
  });

  it("keeps the lines of a host-mock finding and marks the origin", () => {
    const runtime: IOPinRecord[] = [{ pin: "2", defined: true, pinMode: 2, definedAt: { line: 7 }, usedAt: [{ line: 7, operation: "pinMode:2" }, { line: 12, operation: "digitalRead" }] }];

    const [merged] = mergeIoRegistry([], runtime);

    expect(merged.digitalReadLines).toEqual([12]);
    expect(merged.pinModeLines).toEqual([7]);
    expect(merged.pinModeModes).toEqual(["INPUT_PULLUP"]);
    expect(merged.origin).toEqual({ pinMode: "runtime", digitalRead: "runtime" });
  });

  it("appends a pin only the run found, after the static entries", () => {
    const runtime: IOPinRecord[] = [{ pin: "A0", defined: false, usedAt: [{ line: 0, operation: "analogRead" }] }];

    const merged = mergeIoRegistry([staticPin13], runtime);

    expect(merged.map((record) => record.pin)).toEqual(["13", "A0"]);
    expect(merged[1].analogReadLines).toEqual(["runtime"]);
  });

  it("matches A0 with pin 14 and keeps the static spelling", () => {
    const staticA0: IOPinRecord = { pin: "A0", defined: false, analogReadLines: [5] };
    const runtime: IOPinRecord[] = [{ pin: "14", defined: false, usedAt: [{ line: 0, operation: "analogRead" }] }];

    const merged = mergeIoRegistry([staticA0], runtime);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ pin: "A0", analogReadLines: [5], origin: { analogRead: "both" } });
  });

  it("marks a pin as a conflict when the run used a mode the static analysis did not find", () => {
    const staticInput: IOPinRecord = { pin: "2", defined: true, pinMode: 0, pinModeLines: [3], pinModeModes: ["INPUT"] };
    const runtime: IOPinRecord[] = [{ pin: "2", defined: true, pinMode: 2, usedAt: [{ line: 0, operation: "pinMode:2" }] }];

    const [merged] = mergeIoRegistry([staticInput], runtime);

    expect(merged.conflict).toBe(true);
    expect(merged.conflictMessage).toBe("Static analysis found INPUT, the running simulation used INPUT_PULLUP");
  });

  it("appends to an existing conflict message and does not mark a pin whose run mode is among the static modes", () => {
    const staticConflict: IOPinRecord = { pin: "2", defined: true, pinModeLines: [3, 5], pinModeModes: ["INPUT", "OUTPUT"], conflict: true, conflictMessage: "two modes" };

    const same = mergeIoRegistry([staticConflict], [{ pin: "2", defined: true, usedAt: [{ line: 0, operation: "pinMode:1" }] }])[0];
    expect(same.conflictMessage).toBe("two modes");

    const other = mergeIoRegistry([staticConflict], [{ pin: "2", defined: true, usedAt: [{ line: 0, operation: "pinMode:2" }] }])[0];
    expect(other.conflictMessage).toBe("two modes; Static analysis found INPUT/OUTPUT, the running simulation used INPUT_PULLUP");
  });

  it("leaves a static pin alone that the run did not touch", () => {
    const merged = mergeIoRegistry([staticPin13], [{ pin: "7", defined: true, usedAt: [] }]);

    expect(merged[0]).toBe(staticPin13);
  });

  it("does not change its inputs", () => {
    const runtime: IOPinRecord[] = [{ pin: "13", defined: true, usedAt: [{ line: 0, operation: "digitalRead" }] }];
    const before = JSON.stringify([staticPin13, runtime]);

    mergeIoRegistry([staticPin13], runtime);

    expect(JSON.stringify([staticPin13, runtime])).toBe(before);
  });
});
