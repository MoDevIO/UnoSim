import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import { config } from "../../config";
import { ExamplesError, asExamplesError } from "./examples-error";
import {
  ExamplesCache,
  type RevisionCacheEntry,
  type SourceCacheEntry,
  toRevisionCacheKey,
  toSourceCacheKey,
} from "./examples-cache";
import { ExamplesLoadController } from "./examples-load-controller";
import type { LoadedRevisionSnapshot } from "./http-provider";

export interface RequestContext {
  identity: string;
  requestId: string;
  signal?: AbortSignal;
}

export interface RevisionResolver {
  resolve(
    repository: RepositorySlug,
    ref: ExamplesRef,
    context: RequestContext,
  ): Promise<FullCommitSha>;
}

export interface RevisionLoader {
  load(
    repository: RepositorySlug,
    revision: FullCommitSha,
    signal?: AbortSignal,
  ): Promise<LoadedRevisionSnapshot>;
}

export interface ResolvedSourceSnapshot {
  revision: FullCommitSha;
  snapshot: RevisionCacheEntry;
  status: "remote" | "cache";
  stale: boolean;
}

export class SourceProvider {
  private readonly now: () => number;

  constructor(
    private readonly resolver: RevisionResolver,
    private readonly revisionLoader: RevisionLoader,
    private readonly cache: ExamplesCache,
    private readonly loads: ExamplesLoadController,
    private readonly options: { refreshMs?: number; refreshRetryMs?: number; now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async resolve(
    repository: RepositorySlug,
    ref: ExamplesRef,
    context: RequestContext,
    requireFresh: boolean,
  ): Promise<ResolvedSourceSnapshot> {
    const sourceKey = toSourceCacheKey(repository, ref);
    const existing = this.cache.getSource(sourceKey);
    const now = this.now();
    if (existing && !existing.stale && existing.expiresAt > now) return this.fromEntry(existing);
    if (existing?.stale && existing.nextRetryAt > now) {
      if (requireFresh) throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref could not be refreshed");
      return this.fromEntry(existing);
    }

    try {
      return await this.cache.withSourceSingleflight(sourceKey, () =>
        this.loads.runLoad(async () => {
          const revision = await this.resolver.resolve(repository, ref, context);
          const revisionKey = toRevisionCacheKey(repository, revision);
          const cachedSnapshot = this.cache.getRevision(revisionKey);
          const loadedSnapshot = cachedSnapshot ?? await this.loadRevision(repository, revision, context);
          const checkedAt = this.now();
          const activated = this.cache.activateSource(sourceKey, {
            repository,
            ref,
            activeRevision: revision,
            checkedAt,
            expiresAt: checkedAt + (this.options.refreshMs ?? config.examples.refreshMs),
            stale: false,
            nextRetryAt: 0,
          }, revisionKey, loadedSnapshot);
          return {
            revision,
            snapshot: activated.revision,
            status: cachedSnapshot ? "cache" as const : "remote" as const,
            stale: false,
          };
        }, context.signal),
      );
    } catch (error) {
      const lastGood = this.cache.markSourceFailure(
        sourceKey,
        this.now() + Math.min(
          this.options.refreshRetryMs ?? config.examples.refreshRetryMs,
          this.options.refreshMs ?? config.examples.refreshMs,
        ),
      );
      if (lastGood && !requireFresh) return this.fromEntry(lastGood);
      throw asExamplesError(error);
    }
  }

  async getRevision(
    repository: RepositorySlug,
    revision: FullCommitSha,
    context: RequestContext,
  ): Promise<RevisionCacheEntry> {
    const key = toRevisionCacheKey(repository, revision);
    const existing = this.cache.getRevision(key);
    if (existing) return existing;
    return this.cache.withRevisionSingleflight(key, () => this.loads.runLoad(async () => {
      const raced = this.cache.getRevision(key);
      if (raced) return raced;
      const loaded = await this.revisionLoader.load(repository, revision, context.signal);
      return this.cache.setRevision(key, { repository, revision, ...loaded });
    }, context.signal));
  }

  private async loadRevision(
    repository: RepositorySlug,
    revision: FullCommitSha,
    context: RequestContext,
  ): Promise<Omit<RevisionCacheEntry, "lastAccessedAt">> {
    const key = toRevisionCacheKey(repository, revision);
    return this.cache.withRevisionSingleflight(key, async () => {
      const loaded = await this.revisionLoader.load(repository, revision, context.signal);
      return { repository, revision, ...loaded };
    });
  }

  private fromEntry(entry: SourceCacheEntry): ResolvedSourceSnapshot {
    const snapshot = this.cache.getRevision(toRevisionCacheKey(entry.repository, entry.activeRevision));
    if (!snapshot) throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples snapshot is unavailable");
    return { revision: entry.activeRevision, snapshot, status: "cache", stale: entry.stale };
  }
}
