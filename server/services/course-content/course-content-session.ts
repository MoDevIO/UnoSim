import { randomUUID } from "node:crypto";
import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import { config, type ParsedTutorSessionConfig } from "../../config";
import type { RequestContext } from "../examples/source-provider";
import type { TutorCapability } from "./course-content-loader";
import type { ExampleTutorAnnotation } from "./embedded-tutor-annotation";
import { createTutorProgressionState, type TutorProgressionState } from "../tutor/curriculum/progression-state";

export interface TutorCourseContentRequest {
  readonly repository: RepositorySlug;
  readonly ref: ExamplesRef;
  readonly revision: FullCommitSha;
  readonly exampleId?: string;
}

export interface ResolvedTutorCourseContent extends TutorCourseContentRequest {
  readonly tutor: TutorCapability;
  readonly exampleTutorAnnotation?: ExampleTutorAnnotation;
  readonly progressionState?: TutorProgressionState;
  /** Size of the immutable snapshot the Tutor data comes from; charged once per pinned revision. */
  readonly contentBytes: number;
}

export interface TutorCourseContentResolver {
  resolveTutorContent(request: TutorCourseContentRequest, context: RequestContext): Promise<ResolvedTutorCourseContent>;
}

/** Course Content pinned to one revision together with its session-local progression state. */
export type PinnedTutorCourseContent = ResolvedTutorCourseContent & { readonly progressionState: TutorProgressionState };

export type TutorCourseContentSessionEvictionReason = "subject-limit" | "session-limit" | "content-budget";

export interface TutorCourseContentSessionStats {
  readonly sessions: number;
  readonly subjects: number;
  readonly pinnedRevisions: number;
  readonly pinnedContentBytes: number;
  readonly expired: number;
  readonly evicted: Readonly<Record<TutorCourseContentSessionEvictionReason, number>>;
}

/**
 * Request-scoped content for a Tutor request without a session handle. Nothing is
 * registered: the route commits it only after the request succeeded, so failed,
 * rejected, or aborted requests leave no session behind.
 */
export function prepareTutorCourseContentSession(content: ResolvedTutorCourseContent): PinnedTutorCourseContent {
  return { ...content, progressionState: content.progressionState ?? createTutorProgressionState(content.revision) };
}

type SessionEntry = {
  readonly identity: string;
  readonly content: PinnedTutorCourseContent;
  readonly revisionKey: string;
  readonly expiresAt: number;
};

type PinnedRevision = {
  readonly contentBytes: number;
  readonly handles: Set<string>;
};

/**
 * Subject-owned Tutor sessions with an absolute TTL and three bounds: sessions per
 * subject, sessions overall, and the Tutor data of distinct pinned revisions.
 * Each map iterates least recently used first; a successful lookup refreshes the
 * session, its subject slot, and its revision. Eviction drops whole sessions, so
 * a learner sees an expired context instead of partial progression.
 */
export class TutorCourseContentSessionStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly subjects = new Map<string, Set<string>>();
  private readonly revisions = new Map<string, PinnedRevision>();
  private pinnedContentBytes = 0;
  private nextExpiryAt = Number.POSITIVE_INFINITY;
  private expired = 0;
  private readonly evicted: Record<TutorCourseContentSessionEvictionReason, number> = {
    "subject-limit": 0,
    "session-limit": 0,
    "content-budget": 0,
  };

  constructor(
    private readonly limits: ParsedTutorSessionConfig = config.tutor.sessions,
    private readonly now: () => number = Date.now,
  ) {}

  commit(identity: string, content: PinnedTutorCourseContent): string {
    const now = this.now();
    this.sweepExpired(now);
    const revisionKey = `${content.repository}@${content.revision}`;
    const ownHandles = this.subjects.get(identity);
    while (ownHandles && ownHandles.size >= this.limits.maxSessionsPerSubject) {
      this.evict(firstOf(ownHandles), "subject-limit");
    }
    while (this.sessions.size >= this.limits.maxSessions) this.evict(firstOf(this.sessions.keys()), "session-limit");
    const contentBytes = this.chargeableBytes(content.contentBytes);
    if (!this.revisions.has(revisionKey)) {
      // Releasing a revision releases every session that pins it; the most recently used revisions stay.
      while (this.revisions.size > 0 && this.pinnedContentBytes + contentBytes > this.limits.maxPinnedContentBytes) {
        const oldest = firstOf(this.revisions.values());
        while (oldest.handles.size > 0) this.evict(firstOf(oldest.handles), "content-budget");
      }
    }

    const handle = randomUUID();
    const expiresAt = now + this.limits.ttlMs;
    this.sessions.set(handle, { identity, content, revisionKey, expiresAt });
    this.subjects.set(identity, (this.subjects.get(identity) ?? new Set()).add(handle));
    const revision = this.revisions.get(revisionKey) ?? { contentBytes, handles: new Set<string>() };
    if (revision.handles.size === 0) this.pinnedContentBytes += contentBytes;
    revision.handles.add(handle);
    this.revisions.delete(revisionKey);
    this.revisions.set(revisionKey, revision);
    this.nextExpiryAt = Math.min(this.nextExpiryAt, expiresAt);
    return handle;
  }

  get(identity: string, handle: string): PinnedTutorCourseContent | null {
    this.sweepExpired(this.now());
    const entry = this.sessions.get(handle);
    if (entry?.identity !== identity) return null;
    this.touch(handle, entry);
    return entry.content;
  }

  stats(): TutorCourseContentSessionStats {
    this.sweepExpired(this.now());
    return {
      sessions: this.sessions.size,
      subjects: this.subjects.size,
      pinnedRevisions: this.revisions.size,
      pinnedContentBytes: this.pinnedContentBytes,
      expired: this.expired,
      evicted: { ...this.evicted },
    };
  }

  private touch(handle: string, entry: SessionEntry): void {
    this.sessions.delete(handle);
    this.sessions.set(handle, entry);
    const subject = this.subjects.get(entry.identity);
    subject?.delete(handle);
    subject?.add(handle);
    const revision = this.revisions.get(entry.revisionKey);
    if (revision) {
      this.revisions.delete(entry.revisionKey);
      this.revisions.set(entry.revisionKey, revision);
    }
  }

  private evict(handle: string, reason: TutorCourseContentSessionEvictionReason): void {
    if (this.remove(handle)) this.evicted[reason] += 1;
  }

  /** Expiry is absolute; the scan runs only once the earliest known expiry has passed. */
  private sweepExpired(now: number): void {
    if (now < this.nextExpiryAt) return;
    let nextExpiryAt = Number.POSITIVE_INFINITY;
    for (const [handle, entry] of this.sessions) {
      if (entry.expiresAt <= now) {
        this.remove(handle);
        this.expired += 1;
      } else {
        nextExpiryAt = Math.min(nextExpiryAt, entry.expiresAt);
      }
    }
    this.nextExpiryAt = nextExpiryAt;
  }

  private remove(handle: string): boolean {
    const entry = this.sessions.get(handle);
    if (!entry) return false;
    this.sessions.delete(handle);
    const subject = this.subjects.get(entry.identity);
    subject?.delete(handle);
    if (subject?.size === 0) this.subjects.delete(entry.identity);
    const revision = this.revisions.get(entry.revisionKey);
    revision?.handles.delete(handle);
    if (revision?.handles.size === 0) {
      this.revisions.delete(entry.revisionKey);
      this.pinnedContentBytes -= revision.contentBytes;
    }
    return true;
  }

  /** An unknown size is charged as the whole budget, so it can never be pinned beside other revisions. */
  private chargeableBytes(contentBytes: number): number {
    return Number.isSafeInteger(contentBytes) && contentBytes >= 0 ? contentBytes : this.limits.maxPinnedContentBytes;
  }
}

function firstOf<T>(values: Iterable<T>): T {
  const first = values[Symbol.iterator]().next();
  if (first.done) throw new Error("Expected a non-empty Tutor session collection");
  return first.value;
}
