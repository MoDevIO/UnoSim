import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Emulator, buildSimulationImage, loadSimulationImage, systemClock } from "../src/index";

const tick = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

describe("systemClock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a MessageChannel where setImmediate is missing (Web Worker)", async () => {
    vi.stubGlobal("setImmediate", undefined);
    const clock = systemClock();
    const order: number[] = [];
    clock.postTask(() => order.push(1));
    clock.postTask(() => order.push(2))();
    clock.postTask(() => order.push(3));
    await tick(20);

    expect(order).toEqual([1, 3]);
  });

  it("falls back to setTimeout without MessageChannel", async () => {
    vi.stubGlobal("setImmediate", undefined);
    vi.stubGlobal("MessageChannel", undefined);
    const clock = systemClock();
    const order: number[] = [];
    clock.postTask(() => order.push(1));
    await tick(20);

    expect(order).toEqual([1]);
  });

  it("runs posted tasks in order and skips cancelled ones", async () => {
    const clock = systemClock();
    const order: number[] = [];
    clock.postTask(() => order.push(1));
    const cancel = clock.postTask(() => order.push(2));
    clock.postTask(() => order.push(3));
    cancel();
    await tick(20);

    expect(order).toEqual([1, 3]);
  });

  it("delays and cancels timers and reads a monotonic time", async () => {
    const clock = systemClock();
    const fired: string[] = [];
    const start = clock.now();
    clock.setTimeout(() => fired.push("a"), 5);
    clock.setTimeout(() => fired.push("b"), 5)();
    await tick(30);

    expect(fired).toEqual(["a"]);
    expect(clock.now()).toBeGreaterThan(start);
  });

  it("drives the emulator in real time", async () => {
    const hex = readFileSync(join(__dirname, "fixtures", "uno-tick_probe.hex"), "utf8");
    const emulator = new Emulator(loadSimulationImage(buildSimulationImage({ board: "uno", hex })), { clock: systemClock(), timeoutMs: 10_000 });
    emulator.start();
    await tick(60);
    emulator.stop();

    // A busy emulator must not starve timers: the await above returns on time.
    expect(emulator.simTimeMs).toBeGreaterThan(0);
    expect(emulator.simTimeMs).toBeLessThan(200);
  });
});
