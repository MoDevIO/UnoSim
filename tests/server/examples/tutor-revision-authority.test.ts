import { describe, expect, it, vi } from "vitest";
import type { ParsedExamplesConfig } from "../../../server/config";
import { ExamplesCache } from "../../../server/services/examples/examples-cache";
import { ExamplesLoadController } from "../../../server/services/examples/examples-load-controller";
import { ExamplesRepository } from "../../../server/services/examples/examples-repository";
import { SourceProvider } from "../../../server/services/examples/source-provider";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);
const revisionC = "c".repeat(40);
const context = { identity: "learner", requestId: "request" };
const examplesConfig = {
  mode: "repository-ref", source: "owner/repo", ref: "main", repository: "owner/repo",
} as ParsedExamplesConfig;

function snapshot(revision: string) {
  const annotation = { schemaVersion: 1 as const, learningObjectives: [`Ziel ${revision[0]}`] };
  return {
    contentBytes: 10,
    exampleTutorAnnotations: new Map([["blink", annotation]]),
    examples: [{
      id: "blink", title: "Blink", category: "Basics", main: "main.ino", source: "external" as const,
      files: [{ name: "main.ino", path: "main.ino", content: revision }],
    }],
  };
}

/** A Course repository whose `main` moves from A to B after the first refresh window. */
function pushedCourse() {
  let now = 0;
  const heads: Record<string, string> = { main: revisionA, dev: revisionC };
  const resolver = { resolve: vi.fn(async (_repository: string, ref: string) => heads[ref]!) };
  const loader = { load: vi.fn(async (_repository: string, revision: string) => snapshot(revision)) };
  const cache = new ExamplesCache({ maxSources: 8, maxSnapshots: 8, maxSnapshotBytes: 10_000, now: () => now });
  const loads = new ExamplesLoadController({
    maxConcurrentLoads: 4, maxLoadQueue: 4, maxOutboundFetches: 8, globalLoadStartsPerMinute: 20, now: () => now,
  });
  const sourceProvider = new SourceProvider(resolver, loader, cache, loads, { refreshMs: 100, refreshRetryMs: 30, now: () => now });
  const repository = new ExamplesRepository({ examplesConfig, builtInProvider: { getExamples: async () => [] }, sourceProvider });
  return {
    repository,
    loader,
    async push() {
      heads.main = revisionB;
      now = 101;
      await repository.getCatalog({ kind: "default" }, context);
    },
  };
}

describe("Tutor Course Content revision authority after a push", () => {
  it("pins a non-example request to the server-derived revision instead of the stale browser revision", async () => {
    const course = pushedCourse();
    await course.repository.getCatalog({ kind: "default" }, context);
    await course.push();

    const resolved = await course.repository.resolveTutorContent({ repository: "owner/repo", ref: "main", revision: revisionA }, context);

    expect(resolved.revision).toBe(revisionB);
  });

  it("keeps an example on the validated snapshot it was loaded from", async () => {
    const course = pushedCourse();
    await course.repository.getCatalog({ kind: "default" }, context);
    await course.push();

    const resolved = await course.repository.resolveTutorContent(
      { repository: "owner/repo", ref: "main", revision: revisionA, exampleId: "blink" }, context,
    );

    expect(resolved).toMatchObject({ revision: revisionA, exampleTutorAnnotation: { learningObjectives: ["Ziel a"] } });
    expect(course.loader.load).toHaveBeenCalledTimes(2);
  });

  it("accepts the current revision for an example loaded after the push", async () => {
    const course = pushedCourse();
    await course.push();

    await expect(course.repository.resolveTutorContent(
      { repository: "owner/repo", ref: "main", revision: revisionB, exampleId: "blink" }, context,
    )).resolves.toMatchObject({ revision: revisionB });
  });

  it("rejects an example revision the server never resolved for this repository and ref", async () => {
    const course = pushedCourse();
    await course.repository.getCatalog({ kind: "default" }, context);
    await course.repository.getCatalog({ kind: "browser-override", repository: "owner/repo", ref: "dev" }, context);
    await course.push();

    await expect(course.repository.resolveTutorContent(
      { repository: "owner/repo", ref: "main", revision: revisionC, exampleId: "blink" }, context,
    )).rejects.toMatchObject({ code: "INVALID_REVISION" });
    await expect(course.repository.resolveTutorContent(
      { repository: "other/repo", ref: "main", revision: revisionA, exampleId: "blink" }, context,
    )).rejects.toMatchObject({ code: "INVALID_REVISION" });
    await expect(course.repository.resolveTutorContent(
      { repository: "owner/repo", ref: "main", revision: "d".repeat(40), exampleId: "blink" }, context,
    )).rejects.toMatchObject({ code: "INVALID_REVISION" });
    expect(course.loader.load).not.toHaveBeenCalledWith("owner/repo", "d".repeat(40), expect.anything());
  });

  it("rejects an example that is not part of its validated snapshot", async () => {
    const course = pushedCourse();
    await course.repository.getCatalog({ kind: "default" }, context);

    await expect(course.repository.resolveTutorContent(
      { repository: "owner/repo", ref: "main", revision: revisionA, exampleId: "missing" }, context,
    )).rejects.toMatchObject({ code: "EXAMPLE_NOT_FOUND" });
  });
});
