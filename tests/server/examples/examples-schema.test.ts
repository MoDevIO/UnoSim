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

  it("takes an optional board and ignores an id this version does not know (plan P4.6)", () => {
    const example = (board?: unknown) => ({
      id: "pins", title: "Pins", category: "IT03", main: "pins.ino",
      files: [{ name: "pins.ino", path: "pins/pins.ino" }],
      ...(board === undefined ? {} : { board }),
    });
    const parse = (board?: unknown) => examplesManifestSchema.parse({ schemaVersion: 1, examples: [example(board)] }).examples[0];

    expect(parse("nano").board).toBe("nano");
    expect(parse().board).toBeUndefined();
    expect(parse("esp32").board).toBeUndefined(); // a newer manifest must not break an older server
    expect(parse(42).board).toBeUndefined();
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

