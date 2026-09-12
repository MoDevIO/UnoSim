import { describe, expect, it, vi } from "vitest";
import { ExamplesCache } from "../../../server/services/examples/examples-cache";
import { ExamplesLoadController } from "../../../server/services/examples/examples-load-controller";
import { SourceProvider } from "../../../server/services/examples/source-provider";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);
const context = { identity: "browser-a", requestId: "request-a" };

function snapshot(marker: string) {
  return {
    contentBytes: marker.length,
    examples: [{
      id: marker, title: marker, category: "Test", main: "main.ino", source: "external" as const,
      files: [{ name: "main.ino", path: "main.ino", content: marker }],
    }],
  };
}

function harness(
  resolve: (repository: string, ref: string) => Promise<string>,
  load: (_repository: string, revision: string) => Promise<ReturnType<typeof snapshot>>,
) {
  let now = 0;
  const cache = new ExamplesCache({ maxSources: 8, maxSnapshots: 8, maxSnapshotBytes: 10_000, now: () => now });
  const loads = new ExamplesLoadController({
    maxConcurrentLoads: 4, maxLoadQueue: 4, maxOutboundFetches: 8, globalLoadStartsPerMinute: 20,
    now: () => now,
  });
  const provider = new SourceProvider({ resolve }, { load }, cache, loads, {
    refreshMs: 100, refreshRetryMs: 30, now: () => now,
  });
  return { provider, cache, setNow: (value: number) => { now = value; } };
}

describe("repository/ref source provider", () => {
  it("re-resolves after TTL but reuses the immutable snapshot when SHA is unchanged", async () => {
    const resolver = vi.fn(async () => revisionA);
    const loader = vi.fn(async () => snapshot("a"));
    const { provider, setNow } = harness(resolver, loader);
    await provider.resolve("owner/repo", "main", context, false);
    setNow(101);
    await provider.resolve("owner/repo", "main", context, false);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("fully loads a new SHA before atomically activating it and keeps LKG on failure", async () => {
    const resolver = vi.fn().mockResolvedValueOnce(revisionA).mockResolvedValue(revisionB);
    const loader = vi.fn(async (_repository: string, revision: string) => {
      if (revision === revisionB) throw new Error("invalid snapshot");
      return snapshot("a");
    });
    const { provider, setNow } = harness(resolver, loader);
    const first = await provider.resolve("owner/repo", "main", context, false);
    setNow(101);
    const fallback = await provider.resolve("owner/repo", "main", context, false);
    expect(first.revision).toBe(revisionA);
    expect(fallback).toMatchObject({ revision: revisionA, stale: true, status: "cache" });
    setNow(120);
    await provider.resolve("owner/repo", "main", context, false);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("activates a successfully validated new SHA after TTL", async () => {
    const resolver = vi.fn().mockResolvedValueOnce(revisionA).mockResolvedValueOnce(revisionB);
    const loader = vi.fn(async (_repository: string, revision: string) => snapshot(revision));
    const { provider, setNow } = harness(resolver, loader);
    await expect(provider.resolve("owner/repo", "main", context, false)).resolves.toMatchObject({ revision: revisionA });
    setNow(101);
    await expect(provider.resolve("owner/repo", "main", context, false)).resolves.toMatchObject({
      revision: revisionB, stale: false,
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shares singleflight only for identical repository/ref sources", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const resolver = vi.fn(async () => { await gate; return revisionA; });
    const loader = vi.fn(async () => snapshot("a"));
    const { provider } = harness(resolver, loader);
    const first = provider.resolve("owner/repo", "main", context, false);
    const same = provider.resolve("owner/repo", "main", { ...context, identity: "browser-b" }, false);
    const different = provider.resolve("owner/repo", "preview", context, false);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([first, same, different]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("never shares LKG across different repository/ref sources", async () => {
    const resolver = vi.fn(async (repository: string, ref: string) => {
      if (repository === "other/repo" || ref === "preview") throw new Error("missing");
      return revisionA;
    });
    const { provider } = harness(resolver, vi.fn(async () => snapshot("a")));
    await provider.resolve("owner/repo", "main", context, false);
    await expect(provider.resolve("other/repo", "main", context, false)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    await expect(provider.resolve("owner/repo", "preview", context, false)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});
