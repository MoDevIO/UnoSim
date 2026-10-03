import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";

const BINARY = Buffer.from(":100000000C9434000C9446000C9446000C944600A2\n");

describe("compile response payload", () => {
  let server: http.Server;
  let baseUrl: string;
  let compilationCache: Map<string, { result: unknown; timestamp: number }>;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
      next();
    });
    compilationCache = new Map();
    registerCompilerRoutes(app, {
      compiler: { compile: vi.fn().mockResolvedValue({ success: true, output: "ok", errors: [], arduinoCliStatus: "success", binary: BINARY }) },
      compilationCache: compilationCache as never,
      hashCode: (code: string) => `hash:${code}`,
      CACHE_TTL: 60_000,
      setLastCompiledCode: vi.fn(),
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function compile() {
    const response = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "void setup(){} void loop(){}" }),
    });
    return response.json() as Promise<Record<string, unknown>>;
  }

  it("does not send the compiled binary to the client, fresh or cached", async () => {
    const fresh = await compile();
    const cached = await compile();

    expect(fresh).toMatchObject({ success: true, output: "ok" });
    expect(fresh).not.toHaveProperty("binary");
    expect(cached).toMatchObject({ success: true, cached: true });
    expect(cached).not.toHaveProperty("binary");
  });

  it("does not keep the binary in the in-memory result cache", async () => {
    await compile();

    expect([...compilationCache.values()]).toEqual([
      expect.objectContaining({ result: expect.not.objectContaining({ binary: expect.anything() }) }),
    ]);
  });
});
