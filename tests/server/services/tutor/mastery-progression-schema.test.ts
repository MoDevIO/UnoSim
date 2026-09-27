import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { courseContentTutorManifestSchema } from "../../../../server/services/course-content/course-content-schema";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { curriculumTopicSchema } from "../../../../server/services/tutor/curriculum/curriculum-schema";

describe("mastery progression schema compatibility", () => {
  it("accepts Tutor manifest v2 phase strategies while keeping v1 strict", () => {
    const v1 = {
      schemaVersion: 1 as const,
      defaultStrategy: "precision-policy",
      topics: [],
      strategies: [],
    };
    expect(courseContentTutorManifestSchema.safeParse(v1).success).toBe(true);
    expect(courseContentTutorManifestSchema.safeParse({
      ...v1,
      phaseStrategies: { deepen: "exploration-policy", expand: "exploration-policy" },
    }).success).toBe(false);
    expect(courseContentTutorManifestSchema.safeParse({
      ...v1,
      schemaVersion: 2,
      phaseStrategies: { deepen: "exploration-policy", expand: "exploration-policy" },
    }).success).toBe(true);
  });

  it("accepts Topic v2 deepening and extensions while keeping v1 strict", async () => {
    const topic = parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
    const v2 = {
      ...topic,
      schemaVersion: 2 as const,
      deepening: {
        minimumSuccessfulProbes: 2,
        successRatingAtLeast: 4,
        requiredQuestionKinds: ["transfer" as const],
        recentWeakAnswersAllowed: 0,
      },
      extensions: [{ topic: "memory-and-data-types", objective: "Ein verwandtes Beispiel vergleichen." }],
    };
    expect(curriculumTopicSchema.safeParse(topic).success).toBe(true);
    expect(curriculumTopicSchema.safeParse({ ...topic, deepening: v2.deepening }).success).toBe(false);
    expect(curriculumTopicSchema.safeParse(v2).success).toBe(true);
  });
});
