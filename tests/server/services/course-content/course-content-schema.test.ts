import { describe, expect, it } from "vitest";
import {
  courseContentManifestSchema,
  exampleTutorBindingSchema,
  parseCourseContentManifest,
  tutorDescriptorSchema,
} from "../../../../server/services/course-content/course-content-schema";

const file = { name: "main.ino", path: "examples/arrays/main.ino" };

function example(): Record<string, unknown> {
  return {
    id: "arrays-example",
    title: "Arrays",
    category: "Data",
    main: "main.ino",
    files: [file],
  };
}

function root(schemaVersion: 1 | 2 = 1): Record<string, unknown> {
  return {
    schemaVersion,
    examples: [example()],
  };
}

describe("Course Content manifest schema", () => {
  it("keeps schema-v1 Examples-only manifests valid without a Tutor capability", () => {
    const result = parseCourseContentManifest(root());

    expect(result.examples.status).toBe("valid");
    expect(result.tutor.status).toBe("absent");
    expect(courseContentManifestSchema.safeParse(root()).success).toBe(true);
  });

  it("accepts schema-v2 root and example Tutor metadata", () => {
    const value = {
      ...root(2),
      tutor: { manifest: "tutor/manifest.yaml" },
      examples: [{
        ...example(),
        tutor: { topics: ["arrays"], primaryTopic: "arrays", strategy: "socratic" },
      }],
    };

    expect(courseContentManifestSchema.parse(value).tutor?.manifest).toBe("tutor/manifest.yaml");
    const result = parseCourseContentManifest(value);
    expect(result.examples.status).toBe("valid");
    expect(result.tutor.status).toBe("valid");
  });

  it("keeps valid Examples when the optional Tutor descriptor is malformed", () => {
    const result = parseCourseContentManifest({
      ...root(2),
      tutor: { manifest: "curriculum/manifest.yaml", unexpected: true },
    });

    expect(result.examples.status).toBe("valid");
    expect(result.tutor.status).toBe("invalid");
  });

  it("keeps valid Examples when an example Tutor binding is malformed", () => {
    const value = {
      ...root(2),
      tutor: { manifest: "tutor/manifest.yaml" },
      examples: [{
        ...example(),
        tutor: { topics: ["not a safe topic"] },
      }],
    };

    const result = parseCourseContentManifest(value);
    expect(result.examples.status).toBe("valid");
    expect(result.tutor.status).toBe("invalid");
  });

  it("uses closed Tutor-only schemas", () => {
    expect(tutorDescriptorSchema.safeParse({ manifest: "tutor/manifest.yaml", prompt: "unsafe" }).success).toBe(false);
    expect(exampleTutorBindingSchema.safeParse({ topics: ["arrays"], systemPrompt: "unsafe" }).success).toBe(false);
  });

  it("reports a core failure separately from Tutor capability state", () => {
    const result = parseCourseContentManifest({
      ...root(2),
      examples: [{ ...example(), main: "missing.ino" }],
      tutor: { manifest: "tutor/manifest.yaml" },
    });

    expect(result.examples.status).toBe("invalid");
    expect(result.tutor.status).toBe("valid");
  });
});
