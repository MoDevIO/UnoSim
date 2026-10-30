import { describe, expect, it } from "vitest";
import { parseCourseContentManifest } from "../../../../server/services/course-content/course-content-schema";

const AUNIT = { name: "AUnit", version: "1.7.1" };
const example = (extra: Record<string, unknown> = {}) => ({
  id: "unit-tests",
  title: "Unit tests",
  category: "Testing",
  files: [{ name: "UnitTests.ino", path: "unit-tests/UnitTests.ino" }],
  main: "UnitTests.ino",
  ...extra,
});

describe("library requirements of external examples (SSOT Libraries §8.3)", () => {
  it("are part of a strictly validated v2 example entry", () => {
    const validation = parseCourseContentManifest({ schemaVersion: 2, examples: [example({ libraries: [AUNIT] })] });

    expect(validation.examples).toMatchObject({ status: "valid", manifest: { examples: [{ id: "unit-tests", libraries: [AUNIT] }] } });
  });

  it("make the examples capability invalid when they are malformed, but not when a version is merely missing here", () => {
    for (const libraries of [[{ name: "AUnit", version: "*" }], [AUNIT, AUNIT], ["AUnit"]]) {
      expect(parseCourseContentManifest({ schemaVersion: 2, examples: [example({ libraries })] }).examples.status).toBe("invalid");
    }
    expect(parseCourseContentManifest({ schemaVersion: 2, examples: [example({ libraries: [{ name: "AUnit", version: "9.9.9" }] })] }).examples.status).toBe("valid");
  });

  it("are refused in a v1 manifest instead of being dropped", () => {
    const validation = parseCourseContentManifest({ schemaVersion: 1, examples: [example({ libraries: [AUNIT] })] });

    expect(validation.examples).toEqual({ status: "invalid", reason: "Library requirements need manifest schema version 2" });
  });

  it("leave v1 and v2 manifests without them valid, with no requirement", () => {
    for (const schemaVersion of [1, 2]) {
      const validation = parseCourseContentManifest({ schemaVersion, examples: [example()] });
      expect(validation.examples.status).toBe("valid");
      expect(validation.examples.status === "valid" && validation.examples.manifest.examples[0]).not.toHaveProperty("libraries");
    }
  });
});
