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

describe("CompilationWorkerPool", () => {
  const pools: CompilationWorkerPool[] = [];

  beforeEach(() => {
    fakeWorkers.length = 0;
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
  });

  function createPool(workerCount: number): CompilationWorkerPool {
    const pool = new CompilationWorkerPool(workerCount);
    pools.push(pool);
    expect(fakeWorkers).toHaveLength(workerCount);
    for (let index = 0; index < workerCount; index++) ready(index);
    return pool;
  }

  it("processes queued compiles in FIFO order", async () => {
    const pool = createPool(1);

    const first = pool.compile({ code: "first" });
    const second = pool.compile({ code: "second" });

    expect(worker(0).postMessage).toHaveBeenCalledTimes(1);
    expect(worker(0).postMessage.mock.calls[0][0].payload.code).toBe("first");
    expect(pool.getStats()).toMatchObject({ activeWorkers: 1, queuedTasks: 1 });

    succeed(0);
    await expect(first).resolves.toEqual(successfulResult);
    expect(worker(0).postMessage).toHaveBeenCalledTimes(2);
    expect(worker(0).postMessage.mock.calls[1][0].payload.code).toBe("second");

    succeed(0);
    await expect(second).resolves.toEqual(successfulResult);
    expect(pool.getStats()).toMatchObject({
      totalTasks: 2,
      completedTasks: 2,
      failedTasks: 0,
      activeWorkers: 0,
      queuedTasks: 0,
    });
  });

  it("uses all workers before applying backpressure", async () => {
    const pool = createPool(2);

    const first = pool.compile({ code: "first" });
    const second = pool.compile({ code: "second" });
    const third = pool.compile({ code: "third" });

    expect(worker(0).postMessage).toHaveBeenCalledTimes(1);
    expect(worker(1).postMessage).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toMatchObject({ activeWorkers: 2, queuedTasks: 1 });

    succeed(0);
    await first;
    expect(worker(0).postMessage).toHaveBeenCalledTimes(2);
    expect(worker(0).postMessage.mock.calls[1][0].payload.code).toBe("third");

    succeed(1);
    succeed(0);
    await expect(Promise.all([second, third])).resolves.toHaveLength(2);
  });

  it("rejects structured and malformed worker responses", async () => {
    const pool = createPool(1);
    const failed = pool.compile({ code: "invalid" });
    const failedExpectation = expect(failed).rejects.toThrow("compile failed");

    worker(0).emit("message", {
      type: "compile_result",
      payload: { error: { message: "compile failed" } },
    });
    await failedExpectation;

    const malformed = pool.compile({ code: "malformed" });
    const malformedExpectation =
      expect(malformed).rejects.toThrow("malformed response");
    worker(0).emit("message", {
      type: "compile_result",
      payload: {},
    });
    await malformedExpectation;

    expect(pool.getStats()).toMatchObject({
      totalTasks: 2,
      completedTasks: 0,
      failedTasks: 2,
      activeWorkers: 0,
    });
  });

  it("rejects active and queued compiles when the last worker crashes", async () => {
    const pool = createPool(1);
    const active = pool.compile({ code: "active" });
    const queued = pool.compile({ code: "queued" });
    const activeExpectation = expect(active).rejects.toThrow("worker crashed");
    const queuedExpectation = expect(queued).rejects.toThrow(
      "no operational workers",
    );

    worker(0).emit("error", new Error("worker crashed"));

    await Promise.all([activeExpectation, queuedExpectation]);
    expect(pool.isOperational()).toBe(false);
    expect(pool.getStats()).toMatchObject({
      failedTasks: 2,
      activeWorkers: 0,
      queuedTasks: 0,
    });
  });

  it("rejects active and queued work during shutdown", async () => {
    const pool = createPool(1);
    const active = pool.compile({ code: "active" });
    const queued = pool.compile({ code: "queued" });
    const activeExpectation = expect(active).rejects.toThrow("shutting down");
    const queuedExpectation = expect(queued).rejects.toThrow("shutting down");

    await pool.shutdown();
    pools.splice(pools.indexOf(pool), 1);

    await Promise.all([activeExpectation, queuedExpectation]);
    expect(worker(0).terminate).toHaveBeenCalledOnce();
    expect(pool.isOperational()).toBe(false);
  });
});
