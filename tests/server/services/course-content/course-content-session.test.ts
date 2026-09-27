import { describe, expect, it, vi } from "vitest";
import { TutorCourseContentSessionStore } from "../../../../server/services/course-content/course-content-session";

describe("Course Content Tutor progression session", () => {
  it("keeps progression state attached to the pinned immutable revision", () => {
    const store = new TutorCourseContentSessionStore(60_000, vi.fn(() => 1_000));
    const content = {
      repository: "owner/repo" as const,
      ref: "main" as const,
      revision: "a".repeat(40) as `${string}`,
      tutor: { status: "absent" as const },
    };
    const handle = store.create("identity", content);
    const first = store.get("identity", handle);
    expect(first?.revision).toBe(content.revision);
    first!.progressionState!.activeTopicId = "arrays";
    expect(store.get("identity", handle)?.progressionState?.activeTopicId).toBe("arrays");
    expect(store.get("other", handle)).toBeNull();
  });

  it("fails safely after TTL expiry instead of switching revision", () => {
    let now = 1_000;
    const store = new TutorCourseContentSessionStore(10, () => now);
    const handle = store.create("identity", {
      repository: "owner/repo" as const,
      ref: "main" as const,
      revision: "b".repeat(40) as `${string}`,
      tutor: { status: "absent" as const },
    });
    now = 1_011;
    expect(store.get("identity", handle)).toBeNull();
  });
});
