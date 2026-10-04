import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ProcessExecutor } from "../../../server/services/process-executor";

type TestChild = ChildProcess & { kill: ReturnType<typeof vi.fn> };
const children: TestChild[] = [];

function child(pid: number): TestChild {
  const proc = new EventEmitter() as TestChild;
  Object.assign(proc, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  children.push(proc);
  return proc;
}

async function start(
  executor: ProcessExecutor,
  proc: TestChild,
  options: Parameters<ProcessExecutor["execute"]>[2] = {},
) {
  spawnMock.mockReturnValueOnce(proc);
  let notifySpawned!: () => void;
  const spawned = new Promise<void>((resolve) => { notifySpawned = resolve; });
  const result = executor.execute("echo", [], { timeout: 200, ...options, onProcess: notifySpawned });
  await spawned;
  return { result };
}

describe("ProcessExecutor concurrent ownership", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const proc of children.splice(0)) proc.emit("close", 0);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the second deadline when the first child closes", async () => {
    const executor = new ProcessExecutor();
    const first = child(101);
    const second = child(102);
    const a = await start(executor, first, { timeout: 100 });
    const b = await start(executor, second);

    first.emit("close", 0);
    expect((await a.result).code).toBe(0);
    await vi.advanceTimersByTimeAsync(200);

    expect(second.kill).toHaveBeenCalledWith("SIGKILL");
    expect(first.kill).not.toHaveBeenCalled();
    second.emit("close", null);
    expect((await b.result).error?.message).toContain("timeout after 200ms");
    expect(executor.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an execution requested before kill even if it has not spawned yet", async () => {
    const proc = child(103);
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => proc.emit("close", 0));
      return proc;
    });
    const executor = new ProcessExecutor();
    const result = executor.execute("echo", [], { timeout: 200 });
    executor.kill();

    expect(await result).toMatchObject({ code: -1, error: expect.any(Error) });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(executor.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const nextChild = child(104);
    const next = await start(executor, nextChild);
    nextChild.emit("close", 0);
    expect((await next.result).code).toBe(0);
  });

  it("remains busy and can kill the sibling after an error followed by close", async () => {
    const executor = new ProcessExecutor();
    const first = child(201);
    const second = child(202);
    const a = await start(executor, first);
    const b = await start(executor, second);

    first.emit("error", new Error("synthetic spawn failure"));
    first.emit("close", -1);
    expect((await a.result).code).toBe(-1);
    expect(executor.isBusy).toBe(true);
    executor.kill();
    expect(second.kill).toHaveBeenCalledWith("SIGKILL");
    expect(first.kill).not.toHaveBeenCalled();
    second.emit("close", null);
    await b.result;
    expect(executor.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills each owned child using its own detached setting", async () => {
    const signalGroup = vi.spyOn(process, "kill").mockReturnValue(true);
    const executor = new ProcessExecutor();
    const detached = child(301);
    const attached = child(302);
    const a = await start(executor, detached, { detached: true });
    const b = await start(executor, attached);

    executor.kill("SIGTERM");
    expect(signalGroup).toHaveBeenCalledWith(-301, "SIGTERM");
    expect(attached.kill).toHaveBeenCalledWith("SIGTERM");
    expect(detached.kill).not.toHaveBeenCalled();
    detached.emit("close", null);
    attached.emit("close", null);
    await Promise.all([a.result, b.result]);
    expect(executor.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds combined output and terminates only the overflowing execution", async () => {
    const executor = new ProcessExecutor();
    const noisy = child(401);
    const quiet = child(402);
    const forwarded: string[] = [];
    const a = await start(executor, noisy, {
      maxOutputBytes: 6,
      onData: (data) => forwarded.push(data.toString()),
    });
    const b = await start(executor, quiet, { maxOutputBytes: 6 });
    noisy.stdout?.emit("data", Buffer.from("abc"));
    noisy.stderr?.emit("data", Buffer.from("def"));
    expect(noisy.kill).not.toHaveBeenCalled();
    noisy.stdout?.emit("data", Buffer.from("overflow"));

    expect(noisy.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(quiet.kill).not.toHaveBeenCalled();
    noisy.emit("close", 0);
    const result = await a.result;
    expect(result.code).not.toBe(0);
    expect(result.error?.message).toContain("output limit");
    expect(result.stdout).toBe("abc");
    expect(result.stderr).toBe("def");
    noisy.stdout?.emit("data", Buffer.from("late"));
    expect(forwarded).toEqual(["abc", "def"]);
    quiet.stdout?.emit("data", Buffer.from("ok"));
    quiet.emit("close", 0);
    expect(await b.result).toMatchObject({ code: 0, stdout: "ok" });
    expect(executor.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts UTF-8 bytes rather than characters and releases output listeners", async () => {
    const executor = new ProcessExecutor();
    const proc = child(501);
    const a = await start(executor, proc, { maxOutputBytes: 4 });
    proc.stdout?.emit("data", Buffer.from("éé"));
    expect(proc.kill).not.toHaveBeenCalled();
    proc.stderr?.emit("data", Buffer.from("€"));
    expect(proc.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    proc.emit("close", null);
    const result = await a.result;
    expect(result.stdout).toBe("éé");
    expect(result.stderr).toBe("");
    expect(proc.stdout?.listenerCount("data")).toBe(0);
    expect(proc.stderr?.listenerCount("data")).toBe(0);
  });

  it("retains a bounded diagnostic prefix when the first chunk exceeds the budget", async () => {
    const proc = child(601);
    const a = await start(new ProcessExecutor(), proc, { maxOutputBytes: 6 });
    proc.stderr?.emit("data", Buffer.from("diagnostic-too-long"));
    proc.emit("close", 0);
    expect(await a.result).toMatchObject({ stderr: "diagno", code: 1 });
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, 1.5])("rejects invalid output budget %s before spawning", async (maxOutputBytes) => {
    await expect(new ProcessExecutor().execute("echo", [], { maxOutputBytes })).rejects.toThrow("maxOutputBytes");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
