import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../../server/storage";

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() {}
    debug() {}
    warn() {}
    error() {}
  },
}));

const runnerPool = {
  shutdown: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../server/services/sandbox-runner-pool", () => ({
  getSandboxRunnerPool: () => runnerPool,
  initializeSandboxRunnerPool: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../server/services/compiler-with-fallback", () => ({
  getCompilerWithFallback: () => ({}),
}));
vi.mock("../../../server/routes/compiler.routes", () => ({
  registerCompilerRoutes: vi.fn(),
}));
vi.mock("../../../server/routes/status.routes", () => ({
  registerStatusRoutes: vi.fn(),
}));
vi.mock("../../../server/routes/config.routes", () => ({
  registerConfigRoutes: vi.fn(),
}));
vi.mock("../../../server/routes/test-reset.routes", () => ({
  registerTestResetRoute: vi.fn(),
}));
vi.mock("../../../server/routes/simulation.ws", () => ({
  registerSimulationWebSocket: () => ({
    wss: { close: (callback?: () => void) => callback?.() },
    stopAllRunnersAndNotify: vi.fn().mockResolvedValue({ cleanedUpCount: 0, cleanedTestRunIds: [] }),
  }),
}));

function listen(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

async function request(baseUrl: string, method: string, route: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("registerRoutes core HTTP behavior", () => {
  let server: http.Server;
  let baseUrl: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function startServer() {
    const app = express();
    app.use(express.json());
    const { registerRoutes } = await import("../../../server/routes");
    server = await registerRoutes(app);
    ({ baseUrl, server } = await listen(app));
  }

  it("serves health and returns a validated example catalog", async () => {
    await startServer();

    await expect(request(baseUrl, "GET", "/api/health")).resolves.toEqual({
      status: 200,
      body: { status: "ok" },
    });
    const examples = await request(baseUrl, "GET", "/api/examples");
    expect(examples.status).toBe(200);
    expect(examples.body).toMatchObject({ schemaVersion: 1, source: { status: "builtin" } });
    expect(Array.isArray((examples.body as { examples: unknown[] }).examples)).toBe(true);
    const first = (examples.body as { examples: Array<{ id: string; files: Array<{ name: string }> }> }).examples[0];
    expect(first.id).toMatch(/^builtin-/);
    expect(first.files.every((file) => file.name.endsWith(".ino") || file.name.endsWith(".h"))).toBe(true);

    const detail = await request(baseUrl, "GET", `/api/examples/${encodeURIComponent(first.id)}`);
    expect(detail.status).toBe(200);
    expect((detail.body as { files: Array<{ content: string }> }).files.every((file) => typeof file.content === "string")).toBe(true);
  });

  it("creates, reads, updates, lists, and deletes sketches through the public API", async () => {
    await startServer();

    const created = await request(baseUrl, "POST", "/api/sketches", {
      name: "routes-test.ino",
      content: "void setup(){} void loop(){}",
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    await expect(request(baseUrl, "GET", `/api/sketches/${id}`)).resolves.toMatchObject({ status: 200, body: { id } });
    await expect(request(baseUrl, "PUT", `/api/sketches/${id}`, { name: "updated.ino" })).resolves.toMatchObject({
      status: 200,
      body: { id, name: "updated.ino" },
    });
    expect((await request(baseUrl, "GET", "/api/sketches")).status).toBe(200);
    await expect(request(baseUrl, "DELETE", `/api/sketches/${id}`)).resolves.toMatchObject({ status: 204 });
    await expect(request(baseUrl, "GET", `/api/sketches/${id}`)).resolves.toEqual({
      status: 404,
      body: { error: "Sketch not found" },
    });
  });

  it("validates sketch payloads and maps missing resources to public status codes", async () => {
    await startServer();

    await expect(request(baseUrl, "POST", "/api/sketches", { name: 42 })).resolves.toEqual({
      status: 400,
      body: { error: "Invalid sketch data" },
    });
    await expect(request(baseUrl, "PUT", "/api/sketches/missing", { content: 42 })).resolves.toEqual({
      status: 400,
      body: { error: "Invalid sketch data" },
    });
    await expect(request(baseUrl, "GET", "/api/sketches/missing")).resolves.toEqual({
      status: 404,
      body: { error: "Sketch not found" },
    });
    await expect(request(baseUrl, "DELETE", "/api/sketches/missing")).resolves.toEqual({
      status: 404,
      body: { error: "Sketch not found" },
    });
  });

  it("maps storage failures to the documented error responses", async () => {
    await startServer();
    vi.spyOn(storage, "getAllSketches").mockRejectedValue(new Error("storage unavailable"));
    vi.spyOn(storage, "getSketch").mockRejectedValue(new Error("storage unavailable"));
    vi.spyOn(storage, "deleteSketch").mockRejectedValue(new Error("storage unavailable"));

    await expect(request(baseUrl, "GET", "/api/sketches")).resolves.toEqual({
      status: 500,
      body: { error: "Failed to fetch sketches" },
    });
    await expect(request(baseUrl, "GET", "/api/sketches/id")).resolves.toEqual({
      status: 500,
      body: { error: "Failed to fetch sketch" },
    });
    await expect(request(baseUrl, "DELETE", "/api/sketches/id")).resolves.toEqual({
      status: 500,
      body: { error: "Failed to delete sketch" },
    });
  });
});
