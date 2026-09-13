import { describe, expect, it } from "vitest";
import { findTabForSourceLocation } from "@/lib/source-navigation";

describe("source location tab resolution", () => {
  const tabs = [
    { id: "drivers", name: "pins.h", path: "drivers/pins.h" },
    { id: "shared", name: "pins.h", path: "shared/pins.h" },
  ];

  it("matches the complete project path", () => {
    expect(findTabForSourceLocation(tabs, { file: "shared/pins.h", line: 4 })?.id).toBe("shared");
  });

  it("does not fall back to an ambiguous basename", () => {
    expect(findTabForSourceLocation(tabs, { file: "pins.h", line: 4 })).toBeUndefined();
  });

  it("returns no tab when the source file is not open", () => {
    expect(findTabForSourceLocation(tabs, { file: "missing.h", line: 4 })).toBeUndefined();
  });

  it("allows a unique pathless legacy tab name", () => {
    expect(findTabForSourceLocation([{ id: "legacy", name: "main.ino" }], { file: "main.ino", line: 1 })?.id).toBe("legacy");
  });

  it("does not guess between duplicate pathless legacy names", () => {
    expect(findTabForSourceLocation([
      { id: "one", name: "pins.h" },
      { id: "two", name: "pins.h" },
    ], { file: "pins.h", line: 1 })).toBeUndefined();
  });
});
