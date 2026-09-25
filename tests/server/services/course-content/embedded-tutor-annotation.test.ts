import { describe, expect, it } from "vitest";
import {
  EMBEDDED_TUTOR_ANNOTATION_MAX_BYTES,
  extractEmbeddedTutorAnnotation,
} from "../../../../server/services/course-content/embedded-tutor-annotation";

const validBlock = `/* @unosim-tutor
schemaVersion: 1
topics:
  - functions
primaryTopic: functions
strategy: exploration-policy
learningObjectives:
  - Funktionen verstehen.
  - Rückgabewerte verstehen.
@end-unosim-tutor */`;

describe("embedded Tutor annotation parser", () => {
  it("extracts a valid terminal annotation and preserves the sketch", () => {
    const source = `int add(int a, int b) { return a + b; }\n\n${validBlock}\n`;

    const result = extractEmbeddedTutorAnnotation(source, "main.ino", { isMainFile: true });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.annotation).toEqual({
      schemaVersion: 1,
      topics: ["functions"],
      primaryTopic: "functions",
      strategy: "exploration-policy",
      learningObjectives: ["Funktionen verstehen.", "Rückgabewerte verstehen."],
    });
    expect(result.cleanedSource).toBe("int add(int a, int b) { return a + b; }\n\n");
    expect(result.cleanedSource).not.toContain("@unosim-tutor");
  });

  it("returns an absent annotation without changing ordinary source", () => {
    const source = "void setup() {}\nvoid loop() {}\n";

    expect(extractEmbeddedTutorAnnotation(source, "main.ino", { isMainFile: true })).toEqual({
      status: "absent",
      cleanedSource: source,
    });
  });

  it("rejects duplicate blocks and hides all annotation data", () => {
    const source = `void setup() {}\n${validBlock}\n${validBlock}\n`;
    const result = extractEmbeddedTutorAnnotation(source, "main.ino", { isMainFile: true });

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).not.toContain("@unosim-tutor");
    expect(result.cleanedSource).not.toContain("functions");
  });

  it("rejects a block that is not after the final source token", () => {
    const source = `void setup() {}\n${validBlock}\nvoid loop() {}\n`;
    const result = extractEmbeddedTutorAnnotation(source, "main.ino", { isMainFile: true });

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).not.toContain("@unosim-tutor");
    expect(result.cleanedSource).not.toContain("functions");
  });

  it("hides an unterminated block through end of file", () => {
    const result = extractEmbeddedTutorAnnotation(
      "void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nlearningObjectives:\n  - hidden\n",
      "main.ino",
      { isMainFile: true },
    );

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).toBe("void setup() {}\n");
    expect(result.cleanedSource).not.toContain("hidden");
  });

  it("rejects annotations in non-main files and strips them", () => {
    const result = extractEmbeddedTutorAnnotation(`int value;\n${validBlock}\n`, "helper.h", { isMainFile: false });

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).not.toContain("@unosim-tutor");
    expect(result.cleanedSource).not.toContain("functions");
  });

  it("requires primaryTopic to be declared in topics", () => {
    const result = extractEmbeddedTutorAnnotation(
      `void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nprimaryTopic: functions\n@end-unosim-tutor */\n`,
      "main.ino",
      { isMainFile: true },
    );

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).toBe("void setup() {}\n");
  });

  it.each([
    ["unknown field", "prompt: unsafe"],
    ["custom YAML tag", "learningObjectives: [!unsafe value]"],
    ["unsafe identifier", "strategy: bad_strategy"],
    ["empty objective", "learningObjectives: ['   ']"],
    ["control character", "learningObjectives: ['bad\u0001value']"],
  ])("rejects %s", (_label, payload) => {
    const result = extractEmbeddedTutorAnnotation(
      `void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\n${payload}\n@end-unosim-tutor */\n`,
      "main.ino",
      { isMainFile: true },
    );

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).toBe("void setup() {}\n");
  });

  it("trims objectives and accepts long natural-language text within bounds", () => {
    const objective = `  ${"Ä".repeat(500)}  `;
    const result = extractEmbeddedTutorAnnotation(
      `void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nlearningObjectives:\n  - ${objective}\n@end-unosim-tutor */\n`,
      "main.ino",
      { isMainFile: true },
    );

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.annotation.learningObjectives).toEqual(["Ä".repeat(500)]);
  });

  it("enforces a byte limit before parsing the annotation", () => {
    const objective = "x".repeat(EMBEDDED_TUTOR_ANNOTATION_MAX_BYTES);
    const result = extractEmbeddedTutorAnnotation(
      `void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nlearningObjectives:\n  - ${objective}\n@end-unosim-tutor */\n`,
      "main.ino",
      { isMainFile: true },
    );

    expect(result.status).toBe("invalid");
    expect(result.cleanedSource).toBe("void setup() {}\n");
  });
});
