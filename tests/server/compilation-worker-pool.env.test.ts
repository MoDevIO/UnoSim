/**
 * Tests: CompilationWorkerPool respects WORKER_COUNT env var
 * Phase 1.3 + 1.4 – configurable worker count, per-worker temp dirs
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import { join } from "node:path";

// vi.hoisted ensures WorkerMock is defined before vi.mock factory runs
const { WorkerMock } = vi.hoisted(() => {
  const instances: any[] = [];
  const mock = vi.fn().mockImplementation(() => {
    const inst = { on: vi.fn(), postMessage: vi.fn(), terminate: vi.fn().mockResolvedValue(undefined) };
    instances.push(inst);
    return inst;
  });
  (mock as any).__instances = instances;
  return { WorkerMock: mock };
});

vi.mock("node:worker_threads", () => ({
  Worker: WorkerMock,
  default: { Worker: WorkerMock },
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: { ...actual, existsSync: () => true }, existsSync: () => true };
});
vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

import { CompilationWorkerPool } from "../../server/services/compilation-worker-pool";

describe("CompilationWorkerPool – env-var configuration", () => {
  beforeEach(() => {
    WorkerMock.mockClear();
    (WorkerMock as any).__instances.length = 0;
  });

  afterEach(() => {
    delete process.env.WORKER_COUNT;
  });

  it("uses WORKER_COUNT env var to set worker thread count", () => {
    process.env.WORKER_COUNT = "6";
    const pool = new CompilationWorkerPool();
    expect((pool as any).numWorkers).toBe(6);
  });

  it("caps WORKER_COUNT at MAX_SAFE_WORKERS (8)", () => {
    process.env.WORKER_COUNT = "20";
    const pool = new CompilationWorkerPool();
    expect((pool as any).numWorkers).toBeLessThanOrEqual(8);
  });

  it("passes unique tempRoot per worker in workerData", () => {
    process.env.WORKER_COUNT = "3";
      const _pool = new CompilationWorkerPool();

    const tempRoots = WorkerMock.mock.calls.map((c: any[]) => c[1]?.workerData?.tempRoot as string);
    expect(tempRoots[0]).toBeDefined();
    expect(tempRoots[1]).toBeDefined();
    expect(tempRoots[2]).toBeDefined();
    // All tempRoots must be unique
    expect(new Set(tempRoots).size).toBe(3);
    // Format: <tmpdir>/unosim-worker-<index>
    expect(tempRoots[0]).toBe(join(os.tmpdir(), "unosim-worker-0"));
    expect(tempRoots[1]).toBe(join(os.tmpdir(), "unosim-worker-1"));
    expect(tempRoots[2]).toBe(join(os.tmpdir(), "unosim-worker-2"));
  });
});

