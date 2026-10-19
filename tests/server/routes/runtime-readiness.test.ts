/**
 * Plan 4.11, P2.6: /api/readiness is ready when every configured backend is,
 * and /api/status names the backends.
 */
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolStats = { totalRunners: 0, minRunners: 0, maxRunners: 1, maxQueueSize: 0, availableRunners: 0, inUseRunners: 0, resettingRunners: 0, queuedRequests: 0, initialized: false, sandboxReady: false };
vi.mock("../../../server/services/sandbox-runner-pool", () => ({ getSandboxRunnerPool: () => ({ getStats: () => poolStats }) }));

import { config } from "../../../server/config";
import { registerStatusRoutes } from "../../../server/routes/status.routes";

const runtime = config.runtime as { backends: string[]; defaultRuntime: string };
const original = { backends: [...runtime.backends], defaultRuntime: runtime.defaultRuntime };
let server: http.Server;

async function get(path: string): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

beforeEach(async () => {
  const app = express();
  registerStatusRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
});

afterEach(async () => {
  runtime.backends = original.backends;
  runtime.defaultRuntime = original.defaultRuntime;
  Object.assign(poolStats, { initialized: false, sandboxReady: false });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("readiness by backend", () => {
  it("waits for the runner pool while the host mock is offered", async () => {
    runtime.backends = ["browser", "host-mock"];

    expect((await get("/api/readiness")).status).toBe(503);

    Object.assign(poolStats, { initialized: true, sandboxReady: true });
    expect(await get("/api/readiness")).toEqual({ status: 200, body: { status: "ready" } });
  });

  it("is ready without a runner pool when only the browser backend is offered", async () => {
    runtime.backends = ["browser"];

    expect(await get("/api/readiness")).toEqual({ status: 200, body: { status: "ready" } });
  });

  it("names the backends in /api/status, with the host mock's readiness only when it is offered", async () => {
    runtime.backends = ["browser", "host-mock"];
    runtime.defaultRuntime = "host-mock";
    const both = (await get("/api/status")).body.runtime;

    runtime.backends = ["browser"];
    runtime.defaultRuntime = "browser";
    const browserOnly = (await get("/api/status")).body.runtime;

    expect(both).toEqual({ backends: ["browser", "host-mock"], default: "host-mock", hostMock: { ready: false } });
    expect(browserOnly).toEqual({ backends: ["browser"], default: "browser", hostMock: null });
  });
});
