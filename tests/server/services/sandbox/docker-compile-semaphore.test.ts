/**
 * Docker Compile Semaphore - TDD Tests
 *
 * Tests for the semaphore that limits simultaneous Docker compile slots,
 * preventing CPU starvation when many students start simulations at once.
 */

import { describe, it, expect, vi } from "vitest";
import { DockerCompileSemaphore } from "../../../../server/services/sandbox/docker-compile-semaphore";

describe("DockerCompileSemaphore", () => {
  it("allows up to max concurrent acquisitions without queuing", async () => {
    const sem = new DockerCompileSemaphore(3);

    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();

    expect(sem.activeCount).toBe(3);
    expect(sem.queueLength).toBe(0);

    r1();
    r2();
    r3();
  });

  it("queues acquisitions beyond max and calls onQueued", async () => {
    const sem = new DockerCompileSemaphore(2);
    const onQueued = vi.fn();

    // Fill slots
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.activeCount).toBe(2);

    // Third acquisition must wait
    let r3Released = false;
    const p3 = sem.acquire(onQueued).then((release) => {
      r3Released = true;
      return release;
    });

    // Give the promise microtask queue time to settle (it should still be pending)
    await Promise.resolve();
    expect(r3Released).toBe(false);
    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(sem.queueLength).toBe(1);

    // Release one slot – r3 should now acquire
    r1();
    const r3 = await p3;
    expect(r3Released).toBe(true);
    expect(sem.activeCount).toBe(2);
    expect(sem.queueLength).toBe(0);

    r2();
    r3();
  });

  it("onQueued is called exactly once even across retries", async () => {
    const sem = new DockerCompileSemaphore(1);
    const onQueued = vi.fn();

    const r1 = await sem.acquire();

    // Two waiters competing
    const p2 = sem.acquire(onQueued);
    const p3 = sem.acquire(onQueued);
    await Promise.resolve();

    expect(sem.queueLength).toBe(2);
    expect(onQueued).toHaveBeenCalledTimes(2); // once per waiter

    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();

    // onQueued must NOT have been called again after slot was obtained
    expect(onQueued).toHaveBeenCalledTimes(2);
  });

  it("releases correctly and serves queued items in order (FIFO)", async () => {
    const sem = new DockerCompileSemaphore(1);
    const order: number[] = [];

    const r1 = await sem.acquire();

    const p2 = sem.acquire().then((release) => { order.push(2); return release; });
    const p3 = sem.acquire().then((release) => { order.push(3); return release; });
    const p4 = sem.acquire().then((release) => { order.push(4); return release; });

    await Promise.resolve();
    expect(order).toEqual([]); // none acquired yet

    r1();
    const r2 = await p2;
    expect(order).toEqual([2]);

    r2();
    const r3 = await p3;
    expect(order).toEqual([2, 3]);

    r3();
    const r4 = await p4;
    expect(order).toEqual([2, 3, 4]);

    r4();
    expect(sem.activeCount).toBe(0);
    expect(sem.queueLength).toBe(0);
  });

  it("reports activeCount and queueLength correctly", async () => {
    const sem = new DockerCompileSemaphore(2);

    expect(sem.activeCount).toBe(0);
    expect(sem.queueLength).toBe(0);

    const r1 = await sem.acquire();
    expect(sem.activeCount).toBe(1);

    const r2 = await sem.acquire();
    expect(sem.activeCount).toBe(2);

    // Queue one more
    let resolvedR3: (() => void) | undefined;
    sem.acquire().then((r) => { resolvedR3 = r; });
    await Promise.resolve();
    expect(sem.queueLength).toBe(1);

    r1(); // frees a slot for the queued item
    await Promise.resolve();
    expect(sem.queueLength).toBe(0);
    expect(sem.activeCount).toBe(2);

    r2();
    resolvedR3?.();
    expect(sem.activeCount).toBe(0);
  });

  it("handles release idempotency gracefully (no double-decrement)", () => {
    const sem = new DockerCompileSemaphore(1);
    // Test that calling release twice doesn't decrement below zero
    sem.acquire().then((release) => {
      release();
      // Calling release again should not crash and should not corrupt state
      expect(() => release()).not.toThrow();
    });
  });
});
