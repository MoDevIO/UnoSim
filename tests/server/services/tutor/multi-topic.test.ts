import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_TUTOR_STRATEGY } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import {
  curriculumManifestSchema,
  validateCurriculumManifest,
  validateCurriculumTopic,
} from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { DefaultLearningPlanner } from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import { DefaultTopicMatcher } from "../../../../server/services/tutor/curriculum/topic-matcher";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";

async function pilotTopic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

describe("multi-topic Tutor curriculum", () => {
  it("accepts multiple generic topic IDs and rejects duplicates", () => {
    const first = {
      id: "arrays",
      path: "topics/arrays.yaml",
      sha256: "a".repeat(64),
    };
    const second = {
      id: "loops",
      path: "topics/loops.yaml",
      sha256: "b".repeat(64),
    };
    expect(curriculumManifestSchema.parse({
      schemaVersion: 1,
      curriculumId: "unosim-core-de",
      release: "2026.1",
      locale: "de-DE",
      topics: [first, second],
    }).topics).toHaveLength(2);
    expect(() => validateCurriculumManifest({
      schemaVersion: 1,
      curriculumId: "unosim-core-de",
      release: "2026.1",
      locale: "de-DE",
      topics: [first, first],
    })).toThrow(/Duplicate topic id/);
  });

  it("matches applicable facts across multiple topics deterministically", async () => {
    const topic = await pilotTopic();
    const second = validateCurriculumTopic({ ...topic, id: "arrays" });
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const matches = new DefaultTopicMatcher().match([second, topic], facts);
    expect(matches.map(({ topic: matched }) => matched.id)).toEqual(["arrays", "memory-and-data-types"]);
  });

  it("uses effective question-kind weights as a deterministic selection tie-break", async () => {
    const topic = await pilotTopic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const planner = new DefaultLearningPlanner();
    const plan = planner.start(topic, "0123456789abcdef0123456789abcdef01234567", facts, [], 30, BUILT_IN_TUTOR_STRATEGY);
    expect(plan?.brief.questionKind).toBe("application");
  });
});
