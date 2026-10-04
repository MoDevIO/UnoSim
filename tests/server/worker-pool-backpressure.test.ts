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

import { CompilationWorkerPool, CompileCapacityError } from "../../server/services/compilation-worker-pool";

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

describe("CompilationWorkerPool backpressure", () => {
  const pools: CompilationWorkerPool[] = [];

  beforeEach(() => {
    fakeWorkers.length = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
  });

  function createPool(options: { maxQueue?: number; queueTimeoutMs?: number }): CompilationWorkerPool {
    const pool = new CompilationWorkerPool(1, options);
    pools.push(pool);
    ready(0);
    return pool;
  }

  it("rejects a compile beyond the queue limit with a capacity error", async () => {
    const pool = createPool({ maxQueue: 1, queueTimeoutMs: 60_000 });
    const running = pool.compile({ code: "running" });
    const queued = pool.compile({ code: "queued" });

    await expect(pool.compile({ code: "overflow" })).rejects.toBeInstanceOf(CompileCapacityError);
    expect(pool.getStats().queuedTasks).toBe(1);

    succeed(0);
    await expect(running).resolves.toEqual(successfulResult);
    succeed(0);
    await expect(queued).resolves.toEqual(successfulResult);
  });

  it("rejects a compile that waited longer than the queue timeout and never sends it", async () => {
    vi.useFakeTimers();
    const pool = createPool({ maxQueue: 10, queueTimeoutMs: 1_000 });
    const running = pool.compile({ code: "running" });
    const waiting = pool.compile({ code: "waiting" });
    const outcome = waiting.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_001);
    expect(await outcome).toBeInstanceOf(CompileCapacityError);
    expect(pool.getStats().queuedTasks).toBe(0);

    succeed(0);
    await expect(running).resolves.toEqual(successfulResult);
    expect(worker(0).postMessage).toHaveBeenCalledTimes(1);
  });
});
