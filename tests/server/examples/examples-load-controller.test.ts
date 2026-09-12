import { describe, expect, it } from "vitest";
import { ExamplesLoadController } from "../../../server/services/examples/examples-load-controller";

describe("external examples load controller", () => {
  it("admits four loads, queues 32, and rejects load 37", async () => {
    const controller = new ExamplesLoadController({
      maxConcurrentLoads: 4, maxLoadQueue: 32, maxOutboundFetches: 16, globalLoadStartsPerMinute: 120,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const admitted = Array.from({ length: 36 }, () => controller.runLoad(() => gate));
    await Promise.resolve();
    expect(controller.getStats().loads).toEqual({ active: 4, queued: 32 });
    await expect(controller.runLoad(async () => undefined)).rejects.toMatchObject({ code: "LOAD_CAPACITY_EXCEEDED" });
    release();
    await Promise.all(admitted);
  });

  it("enforces the global load-start rate without counting waiters early", async () => {
    let now = 10_000;
    const controller = new ExamplesLoadController({
      maxConcurrentLoads: 2, maxLoadQueue: 2, maxOutboundFetches: 2, globalLoadStartsPerMinute: 2, now: () => now,
    });
    await controller.runLoad(async () => undefined);
    await controller.runLoad(async () => undefined);
    await expect(controller.runLoad(async () => undefined)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    now += 60_001;
    await expect(controller.runLoad(async () => "ok")).resolves.toBe("ok");
  });

  it("releases an aborted queue position", async () => {
    const controller = new ExamplesLoadController({
      maxConcurrentLoads: 1, maxLoadQueue: 1, maxOutboundFetches: 1, globalLoadStartsPerMinute: 10,
    });
    let release!: () => void;
    const active = controller.runLoad(() => new Promise<void>((resolve) => { release = resolve; }));
    const abort = new AbortController();
    const queued = controller.runLoad(async () => undefined, abort.signal);
    abort.abort();
    await expect(queued).rejects.toBeDefined();
    expect(controller.getStats().loads.queued).toBe(0);
    release();
    await active;
  });

  it("caps outbound fetches across concurrent loads", async () => {
    const controller = new ExamplesLoadController({
      maxConcurrentLoads: 4, maxLoadQueue: 4, maxOutboundFetches: 2, globalLoadStartsPerMinute: 10,
    });
    let active = 0;
    let maximum = 0;
    const operations = Array.from({ length: 6 }, () => controller.runOutbound(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
    }));
    await Promise.all(operations);
    expect(maximum).toBe(2);
  });
});
