/**
 * Tests for GET /api/status endpoint (registerStatusRoutes)
 *
 * Covers: pool stats, compile semaphore stats, timestamp, DOCKER_COMPILE_CONCURRENT env var.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

const mockPoolStats = {
  totalRunners: 4,
  minRunners: 2,
  maxRunners: 8,
  availableRunners: 2,
  inUseRunners: 2,
  queuedRequests: 1,
  initialized: true,
};

vi.mock("../../../server/services/sandbox-runner-pool", () => ({
  getSandboxRunnerPool: () => ({
    getStats: () => mockPoolStats,
  }),
}));

const mockSemaphore = {
  activeCount: 3,
  queueLength: 5,
};

vi.mock("../../../server/services/sandbox/docker-compile-semaphore", () => ({
  getDockerCompileSemaphore: () => mockSemaphore,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function listen(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

async function get(baseUrl: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/status", () => {
  let baseUrl: string;
  let server: http.Server;

  beforeEach(async () => {
    const app = express();
    const { registerStatusRoutes } = await import("../../../server/routes/status.routes");
    registerStatusRoutes(app);
    ({ baseUrl, server } = await listen(app));
  });

  afterEach(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => { err ? reject(err) : resolve(); });
    });
  });

  it("returns HTTP 200 with status ok", async () => {
    const { status, body } = await get(baseUrl, "/api/status");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("includes a timestamp in ISO 8601 format", async () => {
    const { body } = await get(baseUrl, "/api/status");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("returns pool stats from SandboxRunnerPool", async () => {
    const { body } = await get(baseUrl, "/api/status");
    expect(body.pool).toEqual({
      total: mockPoolStats.totalRunners,
      available: mockPoolStats.availableRunners,
      inUse: mockPoolStats.inUseRunners,
      queued: mockPoolStats.queuedRequests,
    });
  });

  it("returns compile semaphore stats from DockerCompileSemaphore", async () => {
    const { body } = await get(baseUrl, "/api/status");
    expect(body.compile).toMatchObject({
      active: mockSemaphore.activeCount,
      queued: mockSemaphore.queueLength,
      maxConcurrent: expect.any(Number),
    });
  });

  it("includes DOCKER_COMPILE_CONCURRENT in compile.maxConcurrent (defaults to 8)", async () => {
    delete process.env.DOCKER_COMPILE_CONCURRENT;
    const { body } = await get(baseUrl, "/api/status");
    expect(body.compile.maxConcurrent).toBe(8);
  });
});
