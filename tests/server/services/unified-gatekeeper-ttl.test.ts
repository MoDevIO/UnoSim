import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskPriority, UnifiedGatekeeper } from "../../../server/services/unified-gatekeeper";

describe("UnifiedGatekeeper TTL expiry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands an expired slot to the next queued request", async () => {
    vi.useFakeTimers();
    const gatekeeper = new UnifiedGatekeeper(1);
    await gatekeeper.acquireCompileSlot(TaskPriority.NORMAL, 1_000, "stuck-compile"); // never released

    let granted = false;
    const queued = gatekeeper.acquireCompileSlot(TaskPriority.NORMAL, 600_000, "waiting-compile").then((release) => {
      granted = true;
      return release;
    });
    expect(gatekeeper.getStats().queuedCompiles).toBe(1);

    await vi.advanceTimersByTimeAsync(70_000); // past the 60 s lock TTL and the next 5 s check

    expect(granted).toBe(true);
    expect(gatekeeper.getStats()).toMatchObject({ queuedCompiles: 0, activeCompiles: 1, availableSlots: 0 });
    (await queued)();
    expect(gatekeeper.getStats()).toMatchObject({ activeCompiles: 0, availableSlots: 1 });
    gatekeeper.stopLockMonitoring();
  });

  it("does not grant twice when the expired owner releases late", async () => {
    vi.useFakeTimers();
    const gatekeeper = new UnifiedGatekeeper(1);
    const lateRelease = await gatekeeper.acquireCompileSlot(TaskPriority.NORMAL, 1_000, "slow-compile");
    const next = gatekeeper.acquireCompileSlot(TaskPriority.NORMAL, 600_000, "next-compile");

    await vi.advanceTimersByTimeAsync(70_000);
    const releaseNext = await next;
    lateRelease();

    expect(gatekeeper.getStats()).toMatchObject({ activeCompiles: 1, availableSlots: 0 });
    releaseNext();
    expect(gatekeeper.getStats()).toMatchObject({ activeCompiles: 0, availableSlots: 1 });
    gatekeeper.stopLockMonitoring();
  });
});
