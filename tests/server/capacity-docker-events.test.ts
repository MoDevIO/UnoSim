import { describe, expect, it } from "vitest";
import { createDockerLifecycleTracker } from "../../scripts/capacity-docker-events";

const runId = "capacity-test-run";

function event(Action: string, id: string, eventRunId = runId): string {
  return JSON.stringify({
    Type: "container",
    Action,
    Actor: {
      ID: id,
      Attributes: {
        "unosim.capacity-test-run-id": eventRunId,
      },
    },
  });
}

describe("Docker lifecycle event tracker", () => {
  it("recognizes create, start, die, and destroy actions", () => {
    const tracker = createDockerLifecycleTracker(runId);

    tracker.consume(event("create", "one"));
    tracker.consume(event("start", "one"));
    tracker.consume(event("die", "one"));
    tracker.consume(event("destroy", "one"));

    expect(tracker.peak).toBe(1);
    expect(tracker.activeCount).toBe(0);
  });

  it("ignores unrelated actions and malformed input", () => {
    const tracker = createDockerLifecycleTracker(runId);

    tracker.consume(event("attach", "one"));
    tracker.consume("{not-json");
    tracker.consume(JSON.stringify({ Action: "start" }));

    expect(tracker.peak).toBe(0);
    expect(tracker.activeCount).toBe(0);
  });

  it("excludes events from unrelated capacity runs", () => {
    const tracker = createDockerLifecycleTracker(runId);

    tracker.consume(event("start", "other", "different-run"));
    tracker.consume(event("start", "one"));

    expect(tracker.peak).toBe(1);
    expect(tracker.activeCount).toBe(1);
  });

  it("reconstructs peak concurrency and returns to zero after cleanup", () => {
    const tracker = createDockerLifecycleTracker(runId);

    tracker.consume(event("start", "one"));
    tracker.consume(event("start", "two"));
    tracker.consume(event("start", "two"));
    tracker.consume(event("die", "one"));
    tracker.consume(event("destroy", "two"));

    expect(tracker.peak).toBe(2);
    expect(tracker.activeCount).toBe(0);
  });
});
