import { describe, expect, it } from "vitest";
import { examplesManifestSchema, isSafeRelativePath, validateManifestReferences } from "../../../server/services/examples/examples-schema";

describe("external examples manifest validation", () => {
  it("accepts a multi-file ino/h example", () => {
    const manifest = examplesManifestSchema.parse({
      schemaVersion: 1,
      examples: [{
        id: "motor-control",
        title: "Motor Control",
        category: "Motors",
        files: [
          { name: "motor-control.ino", path: "motors/motor-control/motor-control.ino" },
          { name: "motor.h", path: "motors/motor-control/motor.h" },
        ],
        main: "motor-control.ino",
      }],
    });

    expect(() => validateManifestReferences(manifest)).not.toThrow();
  });

  it("rejects traversal, absolute and unsupported paths", () => {
    expect(isSafeRelativePath("../escape.ino")).toBe(false);
    expect(isSafeRelativePath("/absolute.ino")).toBe(false);
    expect(isSafeRelativePath(String.raw`folder\escape.ino`)).toBe(false);
    expect(isSafeRelativePath("folder/readme.txt")).toBe(false);
  });

  it("requires main to be one of the ino files", () => {
    const manifest = examplesManifestSchema.parse({
      schemaVersion: 1,
      examples: [{
        id: "invalid-main",
        title: "Invalid",
        category: "Tests",
        files: [{ name: "main.ino", path: "tests/main.ino" }],
        main: "missing.ino",
      }],
    });

    expect(() => validateManifestReferences(manifest)).toThrow(/Invalid main file/);
  });
});

