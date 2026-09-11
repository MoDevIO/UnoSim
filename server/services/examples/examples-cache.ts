import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import type { ExampleRecord } from "./examples-schema";
import { ExamplesError } from "./examples-error";

export type SourceCacheKey = `examples:source:v1:${RepositorySlug}:${ExamplesRef}`;
export type RevisionCacheKey = `examples:revision:v1:${RepositorySlug}:${FullCommitSha}`;

export function toSourceCacheKey(repository: RepositorySlug, ref: ExamplesRef): SourceCacheKey {
  return `examples:source:v1:${repository}:${ref}`;
}

export function toRevisionCacheKey(repository: RepositorySlug, revision: FullCommitSha): RevisionCacheKey {
  return `examples:revision:v1:${repository}:${revision}`;
}

export interface SourceCacheEntry {
  repository: RepositorySlug;
  ref: ExamplesRef;
  activeRevision: FullCommitSha;
  checkedAt: number;
  expiresAt: number;
  stale: boolean;
  nextRetryAt: number;
  lastAccessedAt: number;
}

export interface RevisionCacheEntry {
  repository: RepositorySlug;
  revision: FullCommitSha;
  examples: ExampleRecord[];
  contentBytes: number;
  lastAccessedAt: number;
}

export interface ExamplesCacheOptions {
  maxSources: number;
  maxSnapshots: number;
  maxSnapshotBytes: number;
  now?: () => number;
}

export class ExamplesCache {
  private readonly sources = new Map<SourceCacheKey, SourceCacheEntry>();
  private readonly revisions = new Map<RevisionCacheKey, RevisionCacheEntry>();
  private readonly sourceFlights = new Map<SourceCacheKey, Promise<unknown>>();
  private readonly revisionFlights = new Map<RevisionCacheKey, Promise<unknown>>();
  private totalSnapshotBytes = 0;
  private readonly now: () => number;

  constructor(private readonly options: ExamplesCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  getSource(key: SourceCacheKey): SourceCacheEntry | undefined {
    const entry = this.sources.get(key);
    if (entry) entry.lastAccessedAt = this.now();
    return entry;
  }

  setSource(key: SourceCacheKey, entry: Omit<SourceCacheEntry, "lastAccessedAt">): SourceCacheEntry {
    const beforeSources = new Map(this.sources);
    const beforeRevisions = new Map(this.revisions);
    const beforeBytes = this.totalSnapshotBytes;
    const stored = { ...entry, lastAccessedAt: this.now() };
    this.sources.set(key, stored);
    try {
      this.enforceRevisionLimits();
    } catch (error) {
      this.restore(beforeSources, beforeRevisions, beforeBytes);
      throw error;
    }
    return stored;
  }

  activateSource(
    sourceKey: SourceCacheKey,
    source: Omit<SourceCacheEntry, "lastAccessedAt">,
    revisionKey: RevisionCacheKey,
    revision: Omit<RevisionCacheEntry, "lastAccessedAt">,
  ): { source: SourceCacheEntry; revision: RevisionCacheEntry } {
    const beforeSources = new Map(this.sources);
    const beforeRevisions = new Map(this.revisions);
    const beforeBytes = this.totalSnapshotBytes;
    const previous = this.revisions.get(revisionKey);
    if (previous) this.totalSnapshotBytes -= previous.contentBytes;
    const accessedAt = this.now();
    const storedRevision = { ...revision, lastAccessedAt: accessedAt };
    const storedSource = { ...source, lastAccessedAt: accessedAt };
    this.revisions.set(revisionKey, storedRevision);
    this.totalSnapshotBytes += storedRevision.contentBytes;
    this.sources.set(sourceKey, storedSource);
    try {
      this.enforceRevisionLimits();
    } catch (error) {
      this.restore(beforeSources, beforeRevisions, beforeBytes);
      throw error;
    }
    return { source: storedSource, revision: storedRevision };
  }

  markSourceFailure(key: SourceCacheKey, nextRetryAt: number): SourceCacheEntry | undefined {
    const entry = this.sources.get(key);
    if (!entry) return undefined;
    entry.stale = true;
    entry.nextRetryAt = nextRetryAt;
    entry.lastAccessedAt = this.now();
    return entry;
  }

  getRevision(key: RevisionCacheKey): RevisionCacheEntry | undefined {
    const entry = this.revisions.get(key);
    if (entry) entry.lastAccessedAt = this.now();
    return entry;
  }

  setRevision(key: RevisionCacheKey, entry: Omit<RevisionCacheEntry, "lastAccessedAt">): RevisionCacheEntry {
    const beforeSources = new Map(this.sources);
    const beforeRevisions = new Map(this.revisions);
    const beforeBytes = this.totalSnapshotBytes;
    const previous = this.revisions.get(key);
    if (previous) this.totalSnapshotBytes -= previous.contentBytes;
    const stored = { ...entry, lastAccessedAt: this.now() };
    this.revisions.set(key, stored);
    this.totalSnapshotBytes += stored.contentBytes;
    try {
      this.enforceRevisionLimits();
    } catch (error) {
      this.restore(beforeSources, beforeRevisions, beforeBytes);
      throw error;
    }
    return stored;
  }

  async withSourceSingleflight<T>(key: SourceCacheKey, load: () => Promise<T>): Promise<T> {
    const current = this.sourceFlights.get(key) as Promise<T> | undefined;
    if (current) return current;
    this.admitSource(key);
    const flight = load().finally(() => this.sourceFlights.delete(key));
    this.sourceFlights.set(key, flight);
    return flight;
  }

  async withRevisionSingleflight<T>(key: RevisionCacheKey, load: () => Promise<T>): Promise<T> {
    const current = this.revisionFlights.get(key) as Promise<T> | undefined;
    if (current) return current;
    const flight = load().finally(() => this.revisionFlights.delete(key));
    this.revisionFlights.set(key, flight);
    return flight;
  }

  getStats() {
    return {
      sources: this.sources.size,
      revisions: this.revisions.size,
      snapshotBytes: this.totalSnapshotBytes,
      sourceFlights: this.sourceFlights.size,
      revisionFlights: this.revisionFlights.size,
    };
  }

  private admitSource(key: SourceCacheKey): void {
    if (this.sources.has(key) || this.sourceFlights.has(key)) return;
    const sourceCount = () => new Set([...this.sources.keys(), ...this.sourceFlights.keys()]).size;
    while (sourceCount() >= this.options.maxSources) {
      if (!this.evictOldestSource()) {
        throw new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples source capacity is exhausted");
      }
    }
  }

  private enforceRevisionLimits(): void {
    while (this.revisions.size > this.options.maxSnapshots || this.totalSnapshotBytes > this.options.maxSnapshotBytes) {
      if (this.evictOldestUnpinnedRevision()) continue;
      if (this.evictOldestSource()) continue;
      throw new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples snapshot cache is exhausted");
    }
  }

  private evictOldestSource(): boolean {
    const oldest = [...this.sources.entries()]
      .filter(([key]) => !this.sourceFlights.has(key))
      .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)[0];
    if (!oldest) return false;
    this.sources.delete(oldest[0]);
    return true;
  }

  private evictOldestUnpinnedRevision(): boolean {
    const pinned = new Set(
      [...this.sources.values()].map((entry) => toRevisionCacheKey(entry.repository, entry.activeRevision)),
    );
    const oldest = [...this.revisions.entries()]
      .filter(([key]) => !pinned.has(key) && !this.revisionFlights.has(key))
      .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)[0];
    if (!oldest) return false;
    this.revisions.delete(oldest[0]);
    this.totalSnapshotBytes -= oldest[1].contentBytes;
    return true;
  }

  private restore(
    sources: Map<SourceCacheKey, SourceCacheEntry>,
    revisions: Map<RevisionCacheKey, RevisionCacheEntry>,
    totalSnapshotBytes: number,
  ): void {
    this.sources.clear();
    for (const [key, entry] of sources) this.sources.set(key, entry);
    this.revisions.clear();
    for (const [key, entry] of revisions) this.revisions.set(key, entry);
    this.totalSnapshotBytes = totalSnapshotBytes;
  }
}
