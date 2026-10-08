import { describe, expect, it } from "vitest";
import { SandboxStartSemaphore } from "../../../../server/services/sandbox/docker-compile-semaphore";

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** Records the order in which queued acquires obtain a slot. */
function tracker(semaphore: SandboxStartSemaphore) {
  const granted: string[] = [];
  const releases = new Map<string, () => void>();
  const request = (label: string, subject?: string) => {
    void semaphore.acquire(undefined, 60_000, undefined, subject).then((release) => {
      granted.push(label);
      releases.set(label, release);
    });
  };
  return { granted, releases, request };
}

describe("SandboxStartSemaphore subject fairness", () => {
  it("lets one subject use every free slot while nobody else waits", async () => {
    const semaphore = new SandboxStartSemaphore(4);
    const slots = tracker(semaphore);
    for (const label of ["a1", "a2", "a3", "a4"]) slots.request(label, "alice");
    await flush();

    expect(slots.granted).toEqual(["a1", "a2", "a3", "a4"]);
    expect(semaphore.activeCount).toBe(4);
  });

  it("gives a freed slot to a waiting subject below its share before an earlier waiter above it", async () => {
    const semaphore = new SandboxStartSemaphore(4);
    const slots = tracker(semaphore);
    for (const label of ["a1", "a2", "a3", "a4", "a5", "a6"]) slots.request(label, "alice");
    slots.request("b1", "bob");
    slots.request("c1", "carol");
    await flush();
    expect(slots.granted).toEqual(["a1", "a2", "a3", "a4"]);

    slots.releases.get("a1")?.();
    slots.releases.get("a2")?.();
    await flush();

    // Bob and Carol hold no slot; Alice already holds two of four.
    expect(slots.granted.slice(4)).toEqual(["b1", "c1"]);
    expect(semaphore.queueLength).toBe(2);
  });

  it("serves the over-share subject once no subject below its share waits, so nobody starves", async () => {
    const semaphore = new SandboxStartSemaphore(4);
    const slots = tracker(semaphore);
    for (const label of ["a1", "a2", "a3", "a4", "a5", "a6"]) slots.request(label, "alice");
    slots.request("b1", "bob");
    await flush();

    for (const label of ["a1", "a2", "a3"]) slots.releases.get(label)?.();
    await flush();

    expect(slots.granted.slice(4)).toEqual(["b1", "a5", "a6"]);
    expect(semaphore.queueLength).toBe(0);
  });

  it("keeps strict FIFO among waiters within their share and for callers without a subject", async () => {
    const semaphore = new SandboxStartSemaphore(2);
    const slots = tracker(semaphore);
    slots.request("x1");
    slots.request("x2");
    slots.request("x3");
    slots.request("b1", "bob");
    slots.request("c1", "carol");
    await flush();

    for (const label of ["x1", "x2", "x3"]) {
      slots.releases.get(label)?.();
      await flush();
    }

    expect(slots.granted).toEqual(["x1", "x2", "x3", "b1", "c1"]);
  });
});
