import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@shared/logger";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";

async function context(revision = "c".repeat(40)): Promise<TutorPlanningContentContext> {
  const topic = parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
  return { revision, tutor: { status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [topic], strategies: [] } };
}

describe("CurriculumTutorAdapter diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a planning failure instead of swallowing it, and still falls back to no plan", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const adapter = new CurriculumTutorAdapter({
      factExtractor: { extract: () => { throw new Error("extractor exploded"); } },
    });

    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, courseContent: await context() })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("extractor exploded"));
  });

  it("resets a session state of another revision even when no Topic matches", async () => {
    const supplied = await context();
    const state = createTutorProgressionState("d".repeat(40));
    state.masteredTopicIds.push("memory-and-data-types");

    await new CurriculumTutorAdapter().planInitial({ code: "void setup(){} void loop(){}", history: [], difficulty: 30, courseContent: { ...supplied, progressionState: state } });

    expect(state).toMatchObject({ revision: "c".repeat(40), masteredTopicIds: [] });
  });
});
