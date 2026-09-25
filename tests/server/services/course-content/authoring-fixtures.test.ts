import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  courseContentTutorManifestSchema,
  parseCourseContentManifest,
} from "../../../../server/services/course-content/course-content-schema";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";

const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures/course-content");

describe("Course Content authoring fixtures", () => {
  it("covers schema-v1, schema-v2, invalid Tutor isolation, and revision identities", async () => {
    for (const name of ["schema-v1", "schema-v2", "invalid-tutor"]) {
      const manifest = JSON.parse(await readFile(path.join(fixtureRoot, name, "manifest.json"), "utf8")) as unknown;
      expect(parseCourseContentManifest(manifest).examples.status).toBe("valid");
    }
    expect(parseCourseContentManifest(JSON.parse(await readFile(path.join(fixtureRoot, "schema-v2/manifest.json"), "utf8"))).tutor.status).toBe("valid");
    expect(parseCourseContentManifest(JSON.parse(await readFile(path.join(fixtureRoot, "revision-a/manifest.json"), "utf8"))).examples.status).toBe("valid");
    expect(parseCourseContentManifest(JSON.parse(await readFile(path.join(fixtureRoot, "revision-b/manifest.json"), "utf8"))).examples.status).toBe("valid");
  });

  it("validates the two-topic authoring bundle and its declared hashes", async () => {
    const manifest = courseContentTutorManifestSchema.parse(parseYaml(await readFile(path.join(fixtureRoot, "multi-topic/tutor/manifest.yaml"), "utf8")));
    expect(manifest.topics.map(({ id }) => id)).toEqual(["arrays", "loops"]);
    for (const entry of manifest.topics) {
      const source = await readFile(path.join(fixtureRoot, "multi-topic", entry.path), "utf8");
      expect(createHash("sha256").update(source, "utf8").digest("hex")).toBe(entry.sha256);
      expect(parseTopic(source).id).toBe(entry.id);
    }
  });
});
