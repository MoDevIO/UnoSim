/**
 * Tests for compiler.routes.ts
 *
 * Covers: /api/compile route - validation, cache hit/miss/expiry,
 * test-run-id header, error handling, compilation result caching.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";

// Suppress logger output
vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

/** Start the express app on a random port and return base URL + close fn */
function listen(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

/** Simple fetch-like helper using node:http */
async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 200,
            body: data ? JSON.parse(data) : undefined,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function createMockDeps(overrides: Partial<any> = {}): any {
  return {
    compiler: {
      compile: vi.fn().mockResolvedValue({
        success: true,
        output: "compiled hex",
      }),
    },
    compilationCache: new Map(),
    hashCode: vi.fn((code: string) => `hash_${code.slice(0, 10)}`),
    CACHE_TTL: 5 * 60 * 1000,
    setLastCompiledCode: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("compiler.routes - /api/compile", () => {
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createMockDeps>;
  let baseUrl: string;
  let server: http.Server;

  beforeEach(async () => {
    app = createApp();
    deps = createMockDeps();
    registerCompilerRoutes(app, deps);
    const s = await listen(app);
    baseUrl = s.baseUrl;
    server = s.server;
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("rejects request without code", async () => {
    const res = await post(baseUrl, "/api/compile", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Code is required");
  });

  it("rejects request with non-string code", async () => {
    const res = await post(baseUrl, "/api/compile", { code: 123 });
    expect(res.status).toBe(400);
  });

  it("compiles code successfully", async () => {
    const res = await post(baseUrl, "/api/compile", { code: "void setup(){}" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deps.compiler.compile).toHaveBeenCalledWith(
      "void setup(){}",
      undefined,
      undefined,
      { fqbn: undefined, libraries: undefined },
    );
    expect(deps.setLastCompiledCode).toHaveBeenCalledWith("void setup(){}");
  });

  it("returns cached result for same code", async () => {
    await post(baseUrl, "/api/compile", { code: "cached_code" });
    const res = await post(baseUrl, "/api/compile", { code: "cached_code" });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(deps.compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("evicts expired cache entries", async () => {
    deps.compilationCache.set("hash_expired_co", {
      result: { success: true },
      timestamp: Date.now() - 10 * 60 * 1000,
    });

    const res = await post(baseUrl, "/api/compile", { code: "expired_code" });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBeUndefined();
    expect(deps.compiler.compile).toHaveBeenCalled();
  });

  it("passes x-test-run-id header to compiler", async () => {
    const res = await post(
      baseUrl,
      "/api/compile",
      { code: "test code" },
      { "x-test-run-id": "test-abc" },
    );
    expect(res.status).toBe(200);
    const callArgs = deps.compiler.compile.mock.calls[0];
    expect(callArgs[2]).toContain("test-abc");
  });

  it("passes fqbn and libraries to compiler", async () => {
    await post(baseUrl, "/api/compile", {
      code: "code",
      fqbn: "arduino:avr:uno",
      libraries: ["Servo"],
    });
    const callArgs = deps.compiler.compile.mock.calls[0];
    expect(callArgs[3]).toEqual({ fqbn: "arduino:avr:uno", libraries: ["Servo"] });
  });

  it("does not cache failed compilations", async () => {
    deps.compiler.compile.mockResolvedValueOnce({
      success: false,
      error: "syntax error",
    });
    await post(baseUrl, "/api/compile", { code: "bad_code" });
    expect(deps.compilationCache.size).toBe(0);
    expect(deps.setLastCompiledCode).not.toHaveBeenCalled();
  });

  it("handles compiler exceptions", async () => {
    deps.compiler.compile.mockRejectedValueOnce(new Error("Compiler crashed"));
    const res = await post(baseUrl, "/api/compile", { code: "crash_code" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Compilation failed");
  });

  it("passes headers in compilation request", async () => {
    const headers = [{ name: "helper.h", content: "int x;" }];
    await post(baseUrl, "/api/compile", { code: "code_with_headers", headers });
    const callArgs = deps.compiler.compile.mock.calls[0];
    expect(callArgs[1]).toEqual(headers);
  });
});
