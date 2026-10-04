import express from "express";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const { compilerStats, gatekeeperStats } = vi.hoisted(() => ({
  compilerStats: { activeWorkers: 0, maxWorkers: 0, liveWorkers: 0, totalTasks: 0, completedTasks: 0, failedTasks: 0, avgCompileTimeMs: 0, queuedTasks: 0 },
  gatekeeperStats: { maxConcurrentCompiles: 7, activeCompiles: 2 },
}));

vi.mock("../../../server/services/compiler-with-fallback", () => ({
  getCompilerWithFallback: () => ({ getStats: () => compilerStats }),
}));
vi.mock("../../../server/services/unified-gatekeeper", () => ({
  getUnifiedGatekeeper: () => ({ getStats: () => gatekeeperStats }),
}));

import { registerStatusRoutes } from "../../../server/routes/status.routes";
import { getSandboxStartSemaphore } from "../../../server/services/sandbox/docker-compile-semaphore";

let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function status(): Promise<Record<string, any>> {
  const app = express();
  registerStatusRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/status`);
  return response.json() as Promise<Record<string, any>>;
}

describe("/api/status compile capacity", () => {
  it("retains sandbox-start queue alerts and aliases without inventing REST queue work", async () => {
    const queued = vi.spyOn(getSandboxStartSemaphore(), "queueLength", "get").mockReturnValue(2);
    Object.assign(compilerStats, { queuedTasks: 0 });
    Object.assign(gatekeeperStats, { queuedCompiles: 0 });
    try {
      const body = await status();
      expect(body.observabilityAlerts.map((alert: { code: string }) => alert.code)).toContain("compile_queue_nonempty");
      expect(body.compile.queued).toBe(2);
      expect(body.compileSlots.queued).toBe(2);
      expect(body.compileWorkerPool.queued).toBe(0);
    } finally {
      queued.mockRestore();
    }
  });

  it("does not alert on compile queues in an idle snapshot", async () => {
    Object.assign(compilerStats, { queuedTasks: 0 });
    Object.assign(gatekeeperStats, { queuedCompiles: 0 });
    const body = await status();
    expect(body.observabilityAlerts.map((alert: { code: string }) => alert.code)).not.toContain("compile_queue_nonempty");
  });

  it.each(["worker", "gatekeeper"])("alerts on queued REST compiles in the %s path without changing sandbox aliases", async (queue) => {
    Object.assign(compilerStats, { maxWorkers: queue === "worker" ? 3 : 0, liveWorkers: queue === "worker" ? 3 : 0, activeWorkers: 0, queuedTasks: queue === "worker" ? 1 : 0 });
    Object.assign(gatekeeperStats, { queuedCompiles: queue === "gatekeeper" ? 1 : 0 });
    try {
      const body = await status();
      expect(body.observabilityAlerts.map((alert: { code: string }) => alert.code)).toContain("compile_queue_nonempty");
      expect(body.compile.queued).toBe(0);
      expect(body.compileSlots.queued).toBe(0);
    } finally {
      Object.assign(compilerStats, { queuedTasks: 0 });
      Object.assign(gatekeeperStats, { queuedCompiles: 0 });
    }
  });

  it("reports the running compile workers when the worker pool serves compiles", async () => {
    Object.assign(compilerStats, { maxWorkers: 3, liveWorkers: 3, activeWorkers: 1 });

    const body = await status();

    expect(body.capacity.compile).toEqual({ maxConcurrent: 3, active: 1 });
    expect(body.compileWorkers).toBe(3);
    expect(body.compileWorkerPool).toMatchObject({ maxWorkers: 3, liveWorkers: 3 });
  });

  it("reports the gatekeeper when compiles run without workers", async () => {
    Object.assign(compilerStats, { maxWorkers: 0, liveWorkers: 0, activeWorkers: 0 });

    const body = await status();

    expect(body.capacity.compile).toEqual({ maxConcurrent: 7, active: 2 });
    expect(body.compileWorkers).toBe(0);
  });
});
