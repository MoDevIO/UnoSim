import { describe, expect, it, vi } from "vitest";
import type { ParsedExamplesConfig } from "../../../server/config";
import { ExamplesRepository } from "../../../server/services/examples/examples-repository";

const revisionA = "a".repeat(40);
const baseConfig: ParsedExamplesConfig = {
  mode: "repository-ref", source: "default/repo", ref: "main", repository: "default/repo",
  refreshMs: 300_000, refreshRetryMs: 30_000, timeoutMs: 5_000, maxManifestBytes: 262_144,
  maxFileBytes: 131_072, maxTotalBytes: 1_048_576, maxFiles: 100,
  allowedHosts: ["api.github.com", "raw.githubusercontent.com"],
  validateRateLimitMaxRequests: 5, overrideRateLimitMaxRequests: 60, globalLoadStartsPerMinute: 20,
  maxConcurrentLoads: 4, maxLoadQueue: 32, maxFileFetchConcurrency: 8, maxOutboundFetches: 16,
  maxSources: 32, snapshotCacheMaxEntries: 64, snapshotCacheMaxBytes: 67_108_864,
};
const external = (revision: string) => ({
  repository: "owner/repo", revision, contentBytes: 1, lastAccessedAt: 1,
  examples: [{
    id: `external-${revision[0]}`, title: "External", category: "Test", main: "main.ino", source: "external" as const,
    files: [{ name: "main.ino", path: "main.ino", content: revision }],
  }],
});

describe("examples repository request scoping", () => {
  it("preserves response selection while identical sources may share the provider cache", async () => {
    const resolve = vi.fn(async () => ({ revision: revisionA, snapshot: external(revisionA), status: "cache" as const, stale: false }));
    const repository = new ExamplesRepository({
      examplesConfig: baseConfig,
      builtInProvider: { getExamples: async () => [] },
      sourceProvider: { resolve, getRevision: async () => external(revisionA) },
    });
    const context = { identity: "user", requestId: "request" };
    const defaultCatalog = await repository.getCatalog({ kind: "default" }, context);
    const overrideCatalog = await repository.getCatalog({
      kind: "browser-override", repository: "default/repo", ref: "main",
    }, context);
    expect(defaultCatalog.source.selection).toBe("default");
    expect(overrideCatalog.source.selection).toBe("browser-override");
    expect(resolve).toHaveBeenNthCalledWith(1, "default/repo", "main", context, false);
    expect(resolve).toHaveBeenNthCalledWith(2, "default/repo", "main", context, false);
  });

  it("binds detail loading directly to repository plus requested revision", async () => {
    const getRevision = vi.fn(async (_repository: string, requested: string) => external(requested));
    const repository = new ExamplesRepository({
      examplesConfig: baseConfig,
      builtInProvider: { getExamples: async () => [] },
      sourceProvider: { resolve: vi.fn(), getRevision },
    });
    const context = { identity: "user", requestId: "request" };
    const detail = await repository.getExample("owner/repo", revisionA, "external-a", context);
    expect(detail).toMatchObject({ revision: revisionA, files: [{ content: revisionA }] });
    expect(getRevision).toHaveBeenCalledWith("owner/repo", revisionA, context);
  });

  it("does not require source parameters for built-ins", async () => {
    const builtin = { id: "builtin", title: "Built in", category: "Test", main: "main.ino", source: "builtin" as const,
      files: [{ name: "main.ino", path: "main.ino", content: "code" }] };
    const repository = new ExamplesRepository({
      examplesConfig: { ...baseConfig, mode: "builtin", source: "", ref: "", repository: null },
      builtInProvider: { getExamples: async () => [builtin] },
      sourceProvider: { resolve: vi.fn(), getRevision: vi.fn() },
    });
    await expect(repository.getExample(undefined, undefined, "builtin", { identity: "user", requestId: "request" }))
      .resolves.toMatchObject({ revision: null, source: "builtin" });
  });
});
