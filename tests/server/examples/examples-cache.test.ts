import { describe, expect, it } from "vitest";
import { ExamplesCache, toRevisionCacheKey, toSourceCacheKey } from "../../../server/services/examples/examples-cache";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);

describe("external examples cache", () => {
  it("uses the exact versioned keys from the plan", () => {
    expect(toSourceCacheKey("owner/repo", "main")).toBe("examples:source:v1:owner/repo:main");
    expect(toRevisionCacheKey("owner/repo", revisionA)).toBe(`examples:revision:v1:owner/repo:${revisionA}`);
  });

  it("pins an active revision and evicts the unpinned LRU revision", () => {
    let now = 1;
    const cache = new ExamplesCache({ maxSources: 2, maxSnapshots: 2, maxSnapshotBytes: 100, now: () => now++ });
    const keyA = toRevisionCacheKey("owner/repo", revisionA);
    const keyB = toRevisionCacheKey("owner/repo", revisionB);
    cache.setRevision(keyA, { repository: "owner/repo", revision: revisionA, examples: [], contentBytes: 10 });
    cache.setSource(toSourceCacheKey("owner/repo", "main"), {
      repository: "owner/repo", ref: "main", activeRevision: revisionA,
      checkedAt: 1, expiresAt: 2, stale: false, nextRetryAt: 0,
    });
    cache.setRevision(keyB, { repository: "owner/repo", revision: revisionB, examples: [], contentBytes: 10 });
    cache.setRevision(toRevisionCacheKey("other/repo", revisionA), {
      repository: "other/repo", revision: revisionA, examples: [], contentBytes: 10,
    });
    expect(cache.getRevision(keyA)).toBeDefined();
    expect(cache.getRevision(keyB)).toBeUndefined();
  });

  it("activates a new snapshot atomically when the revision cache is full", () => {
    let now = 1;
    const cache = new ExamplesCache({ maxSources: 1, maxSnapshots: 1, maxSnapshotBytes: 100, now: () => now++ });
    cache.activateSource(toSourceCacheKey("owner/repo", "main"), {
      repository: "owner/repo", ref: "main", activeRevision: revisionA,
      checkedAt: 1, expiresAt: 2, stale: false, nextRetryAt: 0,
    }, toRevisionCacheKey("owner/repo", revisionA), {
      repository: "owner/repo", revision: revisionA, examples: [], contentBytes: 10,
    });
    cache.activateSource(toSourceCacheKey("owner/repo", "main"), {
      repository: "owner/repo", ref: "main", activeRevision: revisionB,
      checkedAt: 3, expiresAt: 4, stale: false, nextRetryAt: 0,
    }, toRevisionCacheKey("owner/repo", revisionB), {
      repository: "owner/repo", revision: revisionB, examples: [], contentBytes: 10,
    });
    expect(cache.getRevision(toRevisionCacheKey("owner/repo", revisionA))).toBeUndefined();
    expect(cache.getRevision(toRevisionCacheKey("owner/repo", revisionB))).toBeDefined();
    expect(cache.getSource(toSourceCacheKey("owner/repo", "main"))?.activeRevision).toBe(revisionB);
  });

  it("shares only identical source singleflights", async () => {
    const cache = new ExamplesCache({ maxSources: 4, maxSnapshots: 4, maxSnapshotBytes: 100 });
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = async () => { loads++; await gate; return loads; };
    const key = toSourceCacheKey("owner/repo", "main");
    const first = cache.withSourceSingleflight(key, load);
    const second = cache.withSourceSingleflight(key, load);
    const different = cache.withSourceSingleflight(toSourceCacheKey("owner/repo", "preview"), load);
    expect(loads).toBe(2);
    release();
    await Promise.all([first, second, different]);
    expect(loads).toBe(2);
  });

  it("evicts LRU sources and rejects when all capacity is in flight", async () => {
    let now = 1;
    const cache = new ExamplesCache({ maxSources: 1, maxSnapshots: 2, maxSnapshotBytes: 100, now: () => now++ });
    const firstKey = toSourceCacheKey("owner/repo", "main");
    cache.setSource(firstKey, {
      repository: "owner/repo", ref: "main", activeRevision: revisionA,
      checkedAt: 1, expiresAt: 2, stale: false, nextRetryAt: 0,
    });
    await cache.withSourceSingleflight(toSourceCacheKey("other/repo", "main"), async () => undefined);
    expect(cache.getSource(firstKey)).toBeUndefined();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = cache.withSourceSingleflight(toSourceCacheKey("active/repo", "main"), () => gate);
    await expect(cache.withSourceSingleflight(toSourceCacheKey("third/repo", "main"), async () => undefined))
      .rejects.toMatchObject({ code: "LOAD_CAPACITY_EXCEEDED" });
    release();
    await active;
  });
});
