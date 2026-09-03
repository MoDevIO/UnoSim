import { describe, expect, it } from "vitest";
import { cleanRegistryRecord, mergeRegistryUsage } from "../../../server/services/registry-logic";
import { parseCompilerDiagnostics } from "../../../server/services/compiler-diagnostics";

describe("extracted registry and compiler logic", () => {
  it("merges and cleans registry records deterministically", () => {
    expect(mergeRegistryUsage([{ operation: "digitalRead", line: 2 }], [{ operation: "digitalRead", line: 2 }, { operation: "pinMode", line: 0 }])).toHaveLength(2);
    expect(cleanRegistryRecord({ pin: "1", defined: false, definedAt: { line: 0 }, usedAt: [{ line: 0 }] })).toEqual({ pin: "1", defined: false });
  });
  it("keeps compiler diagnostics parsing behind a pure boundary", () => {
    expect(parseCompilerDiagnostics("sketch.ino:3:5: error: bad", 0)[0]?.line).toBe(3);
  });
});
