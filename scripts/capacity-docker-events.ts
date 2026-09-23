export type DockerLifecycleEvent = {
  Type?: unknown;
  Action?: unknown;
  Actor?: {
    ID?: unknown;
    Attributes?: Record<string, unknown>;
  };
};

export type DockerLifecycleTracker = {
  readonly peak: number;
  readonly activeCount: number;
  consume(line: string): void;
};

const CAPACITY_RUN_LABEL = "unosim.capacity-test-run-id";
const TRACKED_ACTIONS = new Set(["create", "start", "die", "stop", "destroy"]);

function parseEvent(line: string): { action: string; id: string; runId: unknown } | null {
  try {
    const event = JSON.parse(line) as DockerLifecycleEvent;
    if (event.Type !== undefined && event.Type !== "container") return null;

    const action = typeof event.Action === "string" ? event.Action.trim().toLowerCase() : "";
    const id =
      typeof event.Actor?.ID === "string"
        ? event.Actor.ID
        : typeof (event as { id?: unknown }).id === "string"
          ? (event as { id: string }).id
          : typeof (event as { ID?: unknown }).ID === "string"
            ? (event as { ID: string }).ID
            : "";
    if (!TRACKED_ACTIONS.has(action) || !id) return null;

    return {
      action,
      id,
      runId: event.Actor?.Attributes?.[CAPACITY_RUN_LABEL],
    };
  } catch {
    return null;
  }
}
export function createDockerLifecycleTracker(runId: string): DockerLifecycleTracker {
  const active = new Set<string>();
  let peak = 0;

  return {
    get peak() {
      return peak;
    },
    get activeCount() {
      return active.size;
    },
    consume(line: string) {
      const parsed = parseEvent(line);
      if (!parsed || parsed.runId !== runId) return;

      if (parsed.action === "start") {
        active.add(parsed.id);
      } else if (parsed.action !== "create") {
        active.delete(parsed.id);
      }
      peak = Math.max(peak, active.size);
    },
  };
}
