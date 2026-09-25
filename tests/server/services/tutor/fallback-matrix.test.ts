import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CourseContentLoader, type TutorCapability } from "../../../../server/services/course-content/course-content-loader";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { TutorService } from "../../../../server/services/tutor/tutor-service";

const revision = "a".repeat(40);

async function validTutorCapability(): Promise<TutorCapability> {
  const topic = parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
  return {
    status: "valid",
    manifest: { schemaVersion: 1, topics: [], strategies: [] },
    topics: [topic],
    strategies: [],
  };
}

function courseContent(tutor: TutorCapability) {
  return { getSnapshot: vi.fn(async () => ({ revision, tutor })) };
}

describe("Course Content Tutor fallback matrix", () => {
  it.each([
    ["A no Course repository", null],
    ["B schema-v1 Examples-only", { status: "absent" } satisfies TutorCapability],
    ["F invalid Tutor bundle", { status: "invalid", reason: "invalid-tutor-bundle" } satisfies TutorCapability],
    ["G unavailable Tutor capability", null],
  ])("does not activate a partial Tutor bundle for %s", async (_label, tutor) => {
    const adapter = new CurriculumTutorAdapter({
      courseContent: tutor === null ? undefined : courseContent(tutor),
    });
    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 })).resolves.toBeNull();
  });

  it("uses repository topics when the complete Tutor capability is valid", async () => {
    const adapter = new CurriculumTutorAdapter({ courseContent: courseContent(await validTutorCapability()) });
    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ contentRevision: revision, topicId: "memory-and-data-types" });
  });

  it("keeps free Tutor generation functional when repository Tutor is unavailable", async () => {
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Was passiert?" } }),
    };
    const service = new TutorService(provider, new CurriculumTutorAdapter({
      courseContent: courseContent({ status: "invalid", reason: "invalid-tutor-bundle" }),
    }));
    await expect(service.generateQuestion("void setup(){} void loop(){}", "key", undefined, 30))
      .resolves.toMatchObject({ result: { question: "Was passiert?" } });
  });

  it("does not fetch repository content through a second Tutor source", async () => {
    const fetchText = vi.fn(async () => "");
    expect(new CourseContentLoader({ fetchText })).toBeDefined();
    expect(fetchText).not.toHaveBeenCalled();
  });
});
