import { describe, expect, it } from "vitest";
import type { IOPinRecord } from "@shared/schema";
import { getEffectiveIoRegistry } from "@/lib/io-registry-state";

const staticRegistry: IOPinRecord[] = [
  { pin: "13", defined: true, pinMode: 1, pinModeLines: [3], pinModeModes: ["OUTPUT"], usedAt: [{ line: 3, operation: "pinMode:1" }] },
];

const runtimeRegistry: IOPinRecord[] = [
  { pin: "4", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "5", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "6", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "7", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
];

const pins = (registry: IOPinRecord[]) => registry.map((record) => record.pin);

describe("effective I/O registry (plan 4.9: merge instead of replace)", () => {
  it("keeps the static entries during a run and adds the pins only the run found", () => {
    expect(pins(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "running"))).toEqual(["13", "4", "5", "6", "7"]);
  });

  it("keeps the runtime findings when delayed static analysis returns empty", () => {
    expect(pins(getEffectiveIoRegistry([], runtimeRegistry, "running"))).toEqual(["4", "5", "6", "7"]);
  });

  it("keeps the static entries when the runtime snapshot is empty", () => {
    expect(getEffectiveIoRegistry(staticRegistry, [], "running")).toEqual(staticRegistry);
  });

  it("uses the static registry before the first runtime snapshot", () => {
    expect(getEffectiveIoRegistry(staticRegistry, null, "running")).toBe(staticRegistry);
  });

  it("falls back to the current static registry after a run ends", () => {
    expect(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "idle")).toBe(staticRegistry);
  });

  it("keeps runtime data while paused", () => {
    expect(pins(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "paused"))).toContain("4");
  });
});
