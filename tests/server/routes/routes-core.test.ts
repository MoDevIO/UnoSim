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
vi.mock("../../../server/services/examples/examples-repository", () => ({
  ExamplesRepository: class {
    async validate() { throw new Error("not used"); }
    async getCatalog() {
      return {
        schemaVersion: 1,
        source: { selection: "default", mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false },
        examples: [{
          id: "builtin-core", title: "Core", category: "Test", main: "main.ino", source: "builtin",
          files: [{ name: "main.ino", path: "main.ino" }],
        }],
      };
    }
    async getExample(_repository: undefined, _revision: undefined, id: string) {
      return id === "builtin-core" ? {
        schemaVersion: 1, id, title: "Core", category: "Test", main: "main.ino", source: "builtin", revision: null,
        files: [{ name: "main.ino", path: "main.ino", content: "void setup() {}" }],
      } : null;
    }
  },
}));

function listen(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

async function request(baseUrl: string, method: string, route: string, body?: unknown, cookie?: string) {
  const { setCookie: _setCookie, ...response } = await sessionRequest(baseUrl, method, route, body, cookie);
  return response;
}

async function sessionRequest(baseUrl: string, method: string, route: string, body?: unknown, cookie?: string) {
  return new Promise<{ status: number; body: unknown; setCookie?: string[] }>((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"];
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), ...(setCookie ? { setCookie } : {}) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data, ...(setCookie ? { setCookie } : {}) }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("registerRoutes core HTTP behavior", () => {
  let server: http.Server | undefined;
  let baseUrl: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    const activeServer = server;
    server = undefined;
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
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

  it("serves the default sketch read-only through the public API", async () => {
    await startServer();

    const list = await request(baseUrl, "GET", "/api/sketches");
    expect(list.status).toBe(200);
    const [seed] = list.body as Array<{ id: string; name: string }>;
    expect(seed).toMatchObject({ name: "sketch.ino" });
    await expect(request(baseUrl, "GET", `/api/sketches/${seed.id}`)).resolves.toMatchObject({ status: 200, body: { id: seed.id } });
    await expect(request(baseUrl, "GET", "/api/sketches/missing")).resolves.toEqual({
      status: 404,
      body: { error: "Sketch not found" },
    });
    for (const [method, route] of [["POST", "/api/sketches"], ["PUT", `/api/sketches/${seed.id}`], ["DELETE", `/api/sketches/${seed.id}`]]) {
      expect((await request(baseUrl, method, route, method === "DELETE" ? undefined : { name: "x.ino", content: "x" })).status).toBe(404);
    }
    expect((await request(baseUrl, "GET", "/api/sketches")).body).toHaveLength(1);
  });

  it("maps storage failures to the documented error responses", async () => {
    await startServer();
    vi.spyOn(storage, "getAllSketches").mockRejectedValue(new Error("storage unavailable"));
    vi.spyOn(storage, "getSketch").mockRejectedValue(new Error("storage unavailable"));

    await expect(request(baseUrl, "GET", "/api/sketches")).resolves.toEqual({
      status: 500,
      body: { error: "Failed to fetch sketches" },
    });
    await expect(request(baseUrl, "GET", "/api/sketches/id")).resolves.toEqual({
      status: 500,
      body: { error: "Failed to fetch sketch" },
    });
  });
});
