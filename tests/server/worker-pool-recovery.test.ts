import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompilationResult } from "../../server/services/arduino-compiler";

const { FakeWorker, fakeWorkers } = vi.hoisted(() => {
  type Handler = (value: unknown) => void;
  const instances: FakeWorkerControl[] = [];

  class FakeWorker {
    private readonly handlers = new Map<string, Set<Handler>>();
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn().mockResolvedValue(0);

    constructor() {
      instances.push(this);
    }

    on(event: string, handler: Handler): this {
      const handlers = this.handlers.get(event) ?? new Set<Handler>();
      handlers.add(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    off(event: string, handler: Handler): this {
      this.handlers.get(event)?.delete(handler);
      return this;
    }

    emit(event: string, value: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        handler(value);
      }
    }
  }

  return { FakeWorker, fakeWorkers: instances };
});

vi.mock("node:worker_threads", () => ({
  Worker: FakeWorker,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: () => true,
    default: { ...actual, existsSync: () => true },
  };
});

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() {}
    debug() {}
    warn() {}
    error() {}
  },
}));

import { CompilationWorkerPool } from "../../server/services/compilation-worker-pool";

const successfulResult: CompilationResult = {
  success: true,
  output: "compiled",
  errors: [],
  arduinoCliStatus: "success",
};

interface FakeWorkerControl {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  emit: (event: string, value: unknown) => void;
}

function worker(workerIndex: number): FakeWorkerControl {
  const control = fakeWorkers[workerIndex];
  if (!control) throw new Error(`Fake worker ${workerIndex} was not created`);
  return control;
}

function ready(workerIndex: number): void {
  worker(workerIndex).emit("message", { type: "ready" });
}

function succeed(workerIndex: number): void {
  worker(workerIndex).emit("message", {
    type: "compile_result",
    payload: { result: successfulResult },
  });
}

describe("CompilationWorkerPool worker recovery", () => {
  const pools: CompilationWorkerPool[] = [];

  beforeEach(() => {
    fakeWorkers.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
    vi.useRealTimers();
  });

  function createPool(workerCount: number): CompilationWorkerPool {
    const pool = new CompilationWorkerPool(workerCount);
    pools.push(pool);
    for (let index = 0; index < workerCount; index++) ready(index);
    return pool;
  }

  it("restarts a crashed worker and uses it again", async () => {
    const pool = createPool(1);
    worker(0).emit("exit", 1);
    expect(pool.isOperational()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakeWorkers).toHaveLength(2);
    ready(1);
    expect(pool.isOperational()).toBe(true);

    const compiled = pool.compile({ code: "after-restart" });
    expect(worker(1).postMessage).toHaveBeenCalledOnce();
    succeed(1);
    await expect(compiled).resolves.toEqual(successfulResult);
  });

  it("restarts once for a crash reported as both error and exit, with growing backoff", async () => {
    createPool(1);
    worker(0).emit("error", new Error("boom"));
    worker(0).emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakeWorkers).toHaveLength(2);

    worker(1).emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakeWorkers).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakeWorkers).toHaveLength(3);
  });

  it("ignores late events of a replaced worker", async () => {
    const pool = createPool(1);
    worker(0).emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    ready(1);

    worker(0).emit("exit", 1);
    expect(pool.isOperational()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fakeWorkers).toHaveLength(2);
  });

  it("does not restart workers during shutdown", async () => {
    const pool = createPool(1);
    await pool.shutdown();
    pools.splice(0);
    worker(0).emit("exit", 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fakeWorkers).toHaveLength(1);
  });

  it("reports the number of workers it actually runs", () => {
    const pool = createPool(3);
    expect(pool.getStats()).toMatchObject({ maxWorkers: 3, liveWorkers: 3 });
    worker(2).emit("exit", 1);
    expect(pool.getStats()).toMatchObject({ maxWorkers: 3, liveWorkers: 2 });
  });
});
