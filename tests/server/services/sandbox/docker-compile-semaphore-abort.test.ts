import { describe, expect, it } from "vitest";
import { SandboxStartSemaphore } from "../../../../server/services/sandbox/docker-compile-semaphore";

describe("SandboxStartSemaphore cancellation", () => {
  it("removes an aborted waiter so the slot goes to the next one", async () => {
    const semaphore = new SandboxStartSemaphore(1);
    const release = await semaphore.acquire();
    const abort = new AbortController();

    const cancelled = semaphore.acquire(undefined, 60_000, abort.signal);
    const next = semaphore.acquire(undefined, 60_000);
    expect(semaphore.queueLength).toBe(2);

    abort.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    expect(semaphore.queueLength).toBe(1);

    release();
    const releaseNext = await next;
    expect(semaphore.activeCount).toBe(1);
    releaseNext();
    expect(semaphore.activeCount).toBe(0);
  });

  it("rejects immediately for an already aborted signal without taking a slot", async () => {
    const semaphore = new SandboxStartSemaphore(1);
    const abort = new AbortController();
    abort.abort();

    await expect(semaphore.acquire(undefined, 60_000, abort.signal)).rejects.toThrow(/cancelled/);
    expect(semaphore.activeCount).toBe(0);
  });
});
