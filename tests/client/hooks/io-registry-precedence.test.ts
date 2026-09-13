import { describe, expect, it } from "vitest";
import type { IOPinRecord } from "@shared/schema";
import { getEffectiveIoRegistry } from "@/lib/io-registry-state";

const staticRegistry: IOPinRecord[] = [
  { pin: "13", defined: true, pinMode: 1, usedAt: [{ line: 3, operation: "pinMode:1" }] },
];

const runtimeRegistry: IOPinRecord[] = [
  { pin: "4", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "5", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "6", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
  { pin: "7", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] },
];

describe("runtime I/O registry precedence", () => {
  it("keeps a runtime snapshot when delayed static analysis returns empty", () => {
    expect(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "running")).toBe(runtimeRegistry);
    expect(getEffectiveIoRegistry([], runtimeRegistry, "running")).toBe(runtimeRegistry);
  });

  it("treats an empty runtime snapshot as authoritative", () => {
    expect(getEffectiveIoRegistry(staticRegistry, [], "running")).toEqual([]);
  });

  it("uses the static registry before the first runtime snapshot", () => {
    expect(getEffectiveIoRegistry(staticRegistry, null, "running")).toBe(staticRegistry);
  });

  it("falls back to the current static registry after a run ends", () => {
    expect(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "idle")).toBe(staticRegistry);
  });

  it("keeps runtime data while paused", () => {
    expect(getEffectiveIoRegistry(staticRegistry, runtimeRegistry, "paused")).toBe(runtimeRegistry);
  });
});
