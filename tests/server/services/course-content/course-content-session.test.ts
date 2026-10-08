import { describe, expect, it } from "vitest";
import { parseTutorSessionConfig, type ParsedTutorSessionConfig } from "../../../../server/config";
import {
  prepareTutorCourseContentSession,
  TutorCourseContentSessionStore,
  type PinnedTutorCourseContent,
} from "../../../../server/services/course-content/course-content-session";

const MiB = 1_048_576;

function limits(overrides: Partial<ParsedTutorSessionConfig> = {}): ParsedTutorSessionConfig {
  return { ttlMs: 60_000, maxSessions: 100, maxSessionsPerSubject: 5, maxPinnedContentBytes: 64 * MiB, ...overrides };
}

function content(revisionChar = "a", contentBytes = 1_000): PinnedTutorCourseContent {
  return prepareTutorCourseContentSession({
    repository: "owner/repo",
    ref: "main",
    revision: revisionChar.repeat(40),
    tutor: { status: "absent" },
    contentBytes,
  });
}

function revision(index: number): string {
  return index.toString(16).padStart(40, "0");
}

function contentAt(index: number, contentBytes = 1_000): PinnedTutorCourseContent {
  return prepareTutorCourseContentSession({
    repository: "owner/repo",
    ref: "main",
    revision: revision(index),
    tutor: { status: "absent" },
    contentBytes,
  });
}

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("Course Content Tutor session ownership", () => {
  it("prepares request-scoped content without registering a session", () => {
    const store = new TutorCourseContentSessionStore(limits());
    const prepared = content();

    expect(prepared.progressionState).toEqual(expect.objectContaining({ revision: "a".repeat(40), masteredTopicIds: [] }));
    expect(store.stats().sessions).toBe(0);
  });

  it("commits exactly one reusable session that keeps the pinned revision and its progression", () => {
    const store = new TutorCourseContentSessionStore(limits());
    const handle = store.commit("subject-a", content());

    expect(handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const first = store.get("subject-a", handle);
    expect(first?.revision).toBe("a".repeat(40));
    first!.progressionState.activeTopicId = "arrays";
    expect(store.get("subject-a", handle)?.progressionState.activeTopicId).toBe("arrays");
    expect(store.stats()).toMatchObject({ sessions: 1, subjects: 1, pinnedRevisions: 1, pinnedContentBytes: 1_000 });
  });

  it("never resolves a handle for another subject and keeps that lookup from refreshing the session", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxSessions: 10, maxSessionsPerSubject: 2 }));
    const victim = store.commit("subject-a", content("a"));
    store.commit("subject-a", content("b"));

    expect(store.get("subject-b", victim)).toBeNull();
    expect(store.get("subject-b", "11111111-1111-4111-8111-111111111111")).toBeNull();
    // A foreign lookup is not a use: the victim session stays the subject's oldest slot.
    store.commit("subject-a", content("c"));
    expect(store.get("subject-a", victim)).toBeNull();
  });
});

describe("Course Content Tutor session expiry", () => {
  it("removes expired sessions physically and releases their pinned revision", () => {
    const time = clock();
    const store = new TutorCourseContentSessionStore(limits({ ttlMs: 60_000 }), time.now);
    const first = store.commit("subject-a", content("a", 2_000));
    time.advance(30_000);
    const second = store.commit("subject-b", content("b", 3_000));

    time.advance(30_000);
    expect(store.stats()).toMatchObject({ sessions: 1, pinnedRevisions: 1, pinnedContentBytes: 3_000, expired: 1 });
    expect(store.get("subject-a", first)).toBeNull();
    expect(store.get("subject-b", second)).not.toBeNull();

    time.advance(30_000);
    expect(store.stats()).toMatchObject({ sessions: 0, subjects: 0, pinnedRevisions: 0, pinnedContentBytes: 0, expired: 2 });
  });

  it("keeps an absolute lifetime that use does not extend", () => {
    const time = clock();
    const store = new TutorCourseContentSessionStore(limits({ ttlMs: 60_000 }), time.now);
    const handle = store.commit("subject-a", content());

    time.advance(59_999);
    expect(store.get("subject-a", handle)).not.toBeNull();
    time.advance(1);
    expect(store.get("subject-a", handle)).toBeNull();
    expect(store.stats().sessions).toBe(0);
  });

  it("sweeps expired sessions of other subjects on any access", () => {
    const time = clock();
    const store = new TutorCourseContentSessionStore(limits({ ttlMs: 60_000 }), time.now);
    for (let index = 0; index < 50; index += 1) store.commit(`subject-${index}`, contentAt(index));
    time.advance(60_000);
    const survivor = store.commit("subject-new", content("f"));

    expect(store.stats()).toMatchObject({ sessions: 1, subjects: 1, pinnedRevisions: 1, expired: 50 });
    expect(store.get("subject-new", survivor)).not.toBeNull();
  });
});

describe("Course Content Tutor session bounds", () => {
  it("evicts a subject's least recently used session at the per-subject limit", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxSessionsPerSubject: 3 }));
    const handles = [1, 2, 3].map((index) => store.commit("subject-a", contentAt(index)));
    const other = store.commit("subject-b", contentAt(9));

    expect(store.get("subject-a", handles[0]!)).not.toBeNull();
    const fourth = store.commit("subject-a", contentAt(4));

    expect(store.get("subject-a", handles[1]!)).toBeNull();
    expect([handles[0], handles[2], fourth].map((handle) => store.get("subject-a", handle!))).not.toContain(null);
    expect(store.get("subject-b", other)).not.toBeNull();
    expect(store.stats()).toMatchObject({ sessions: 4, evicted: { "subject-limit": 1, "session-limit": 0, "content-budget": 0 } });
  });

  it("evicts the globally least recently used session at the global limit", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxSessions: 3, maxSessionsPerSubject: 3 }));
    const a = store.commit("subject-a", content());
    const b = store.commit("subject-b", content());
    const c = store.commit("subject-c", content());
    store.get("subject-a", a);

    const d = store.commit("subject-d", content());

    expect(store.get("subject-b", b)).toBeNull();
    for (const [subject, handle] of [["subject-a", a], ["subject-c", c], ["subject-d", d]] as const) {
      expect(store.get(subject, handle)).not.toBeNull();
    }
    expect(store.stats()).toMatchObject({ sessions: 3, evicted: { "session-limit": 1 } });
  });

  it("lets one subject displace at most its own per-subject share of other subjects", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxSessions: 20, maxSessionsPerSubject: 4 }));
    const others = Array.from({ length: 20 }, (_, index) => [`learner-${index}`, store.commit(`learner-${index}`, content())] as const);

    for (let attempt = 0; attempt < 1_000; attempt += 1) store.commit("abuser", content());

    const surviving = others.filter(([subject, handle]) => store.get(subject, handle) !== null);
    expect(surviving).toHaveLength(16);
    expect(store.stats()).toMatchObject({ sessions: 20, subjects: 17 });
  });

  it("charges each pinned revision once and releases the least recently used revision over budget", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxSessionsPerSubject: 10, maxPinnedContentBytes: 3 * MiB }));
    const sharedA = [store.commit("subject-a", contentAt(1, MiB)), store.commit("subject-b", contentAt(1, MiB))];
    const onB = store.commit("subject-a", contentAt(2, MiB));
    const onC = store.commit("subject-c", contentAt(3, MiB));
    expect(store.stats()).toMatchObject({ sessions: 4, pinnedRevisions: 3, pinnedContentBytes: 3 * MiB });

    // Revision 1 is in use again, so revision 2 is now the least recently used one.
    store.get("subject-b", sharedA[1]!);
    const onD = store.commit("subject-d", contentAt(4, MiB));

    expect(store.get("subject-a", onB)).toBeNull();
    expect(store.get("subject-a", sharedA[0]!)).not.toBeNull();
    expect(store.get("subject-c", onC)).not.toBeNull();
    expect(store.get("subject-d", onD)).not.toBeNull();
    expect(store.stats()).toMatchObject({ pinnedRevisions: 3, pinnedContentBytes: 3 * MiB, evicted: { "content-budget": 1 } });
  });

  it("releases every session of a revision when that revision must leave the budget", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxPinnedContentBytes: 2 * MiB }));
    const old = ["subject-a", "subject-b", "subject-c"].map((subject) => [subject, store.commit(subject, contentAt(1, MiB))] as const);
    store.commit("subject-d", contentAt(2, MiB));

    store.commit("subject-e", contentAt(3, MiB));

    expect(old.map(([subject, handle]) => store.get(subject, handle))).toEqual([null, null, null]);
    expect(store.stats()).toMatchObject({ sessions: 2, pinnedRevisions: 2, evicted: { "content-budget": 3 } });
  });

  it("charges content of unknown size as the whole budget", () => {
    const store = new TutorCourseContentSessionStore(limits({ maxPinnedContentBytes: 4 * MiB }));
    const known = store.commit("subject-a", contentAt(1, MiB));

    store.commit("subject-b", contentAt(2, Number.NaN));

    expect(store.get("subject-a", known)).toBeNull();
    expect(store.stats()).toMatchObject({ sessions: 1, pinnedContentBytes: 4 * MiB });
  });

  it("stays within every bound under thousands of synthetic session creations", () => {
    const bounds = limits({ maxSessions: 200, maxSessionsPerSubject: 5, maxPinnedContentBytes: 16 * MiB, ttlMs: 600_000 });
    const time = clock();
    const store = new TutorCourseContentSessionStore(bounds, time.now);
    const live = new Map<string, string>();

    for (let attempt = 0; attempt < 5_000; attempt += 1) {
      const subject = `subject-${(attempt * 7) % 97}`;
      live.set(store.commit(subject, contentAt(attempt % 313, ((attempt * 131) % MiB) + 1)), subject);
      if (attempt % 50 === 0) time.advance(7_000);
      const stats = store.stats();
      expect(stats.sessions).toBeLessThanOrEqual(bounds.maxSessions);
      expect(stats.pinnedContentBytes).toBeLessThanOrEqual(bounds.maxPinnedContentBytes);
      expect(stats.pinnedRevisions).toBeLessThanOrEqual(stats.sessions);
    }

    const perSubject = new Map<string, number>();
    for (const [handle, subject] of live) {
      if (store.get(subject, handle)) perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
    }
    expect(Math.max(...perSubject.values())).toBeLessThanOrEqual(bounds.maxSessionsPerSubject);
    expect([...perSubject.values()].reduce((sum, count) => sum + count, 0)).toBe(store.stats().sessions);

    time.advance(bounds.ttlMs);
    expect(store.stats()).toMatchObject({ sessions: 0, subjects: 0, pinnedRevisions: 0, pinnedContentBytes: 0 });
  });
});

describe("Tutor session configuration", () => {
  it("uses bounded defaults", () => {
    expect(parseTutorSessionConfig({}, MiB)).toEqual({
      ttlMs: 3_600_000,
      maxSessions: 1_000,
      maxSessionsPerSubject: 5,
      maxPinnedContentBytes: 64 * MiB,
    });
  });

  it.each([
    ["TUTOR_SESSION_TTL_MS", "59999"],
    ["TUTOR_SESSION_TTL_MS", "86400001"],
    ["TUTOR_SESSION_MAX_SESSIONS", "9"],
    ["TUTOR_SESSION_MAX_SESSIONS", "10001"],
    ["TUTOR_SESSION_MAX_PER_SUBJECT", "0"],
    ["TUTOR_SESSION_MAX_PER_SUBJECT", "51"],
    ["TUTOR_SESSION_MAX_PINNED_CONTENT_BYTES", String(MiB - 1)],
    ["TUTOR_SESSION_MAX_PINNED_CONTENT_BYTES", String(512 * MiB + 1)],
  ])("rejects %s=%s outside its range", (key, value) => {
    expect(() => parseTutorSessionConfig({ [key]: value }, MiB)).toThrow(key);
  });

  it("rejects a per-subject limit above the global limit", () => {
    expect(() => parseTutorSessionConfig({ TUTOR_SESSION_MAX_SESSIONS: "10", TUTOR_SESSION_MAX_PER_SUBJECT: "11" }, MiB))
      .toThrow("TUTOR_SESSION_MAX_PER_SUBJECT");
  });

  it("rejects a pinned-content budget that cannot hold one complete snapshot", () => {
    expect(() => parseTutorSessionConfig({ TUTOR_SESSION_MAX_PINNED_CONTENT_BYTES: String(2 * MiB) }, 3 * MiB))
      .toThrow("UNOSIM_EXAMPLES_MAX_TOTAL_BYTES");
  });
});
