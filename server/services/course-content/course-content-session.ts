import { randomUUID } from "node:crypto";
import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import type { RequestContext } from "../examples/source-provider";
import type { TutorCapability } from "./course-content-loader";

export interface TutorCourseContentRequest {
  readonly repository: RepositorySlug;
  readonly ref: ExamplesRef;
  readonly revision: FullCommitSha;
  readonly exampleId?: string;
}

export interface ResolvedTutorCourseContent extends TutorCourseContentRequest {
  readonly tutor: TutorCapability;
}

export interface TutorCourseContentResolver {
  resolveTutorContent(request: TutorCourseContentRequest, context: RequestContext): Promise<ResolvedTutorCourseContent>;
  getTutorContent(request: ResolvedTutorCourseContent, context: RequestContext): Promise<ResolvedTutorCourseContent>;
}

type SessionEntry = {
  readonly identity: string;
  readonly content: ResolvedTutorCourseContent;
  readonly expiresAt: number;
};

export class TutorCourseContentSessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly ttlMs = 60 * 60 * 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  create(identity: string, content: ResolvedTutorCourseContent): string {
    this.prune();
    const handle = randomUUID();
    this.sessions.set(handle, { identity, content, expiresAt: this.now() + this.ttlMs });
    return handle;
  }

  get(identity: string, handle: string): ResolvedTutorCourseContent | null {
    const entry = this.sessions.get(handle);
    if (!entry || entry.identity !== identity || entry.expiresAt <= this.now()) {
      if (entry && entry.expiresAt <= this.now()) this.sessions.delete(handle);
      return null;
    }
    return entry.content;
  }

  private prune(): void {
    const now = this.now();
    for (const [handle, entry] of this.sessions) {
      if (entry.expiresAt <= now) this.sessions.delete(handle);
    }
  }
}
