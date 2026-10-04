import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";
import { CompileCapacityError } from "../../../server/services/compilation-worker-pool";

let server: http.Server | undefined;

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe("/api/compile at compile capacity", () => {
  it("answers 503 SYSTEM_BUSY with Retry-After instead of a generic failure", async () => {
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
      next();
    });
    registerCompilerRoutes(app, {
      compiler: { compile: vi.fn().mockRejectedValue(new CompileCapacityError("Compile queue full")), tracksCompileMetrics: true },
      compilationCache: new Map(),
      hashCode: (code: string) => code,
      CACHE_TTL: 0,
      setLastCompiledCode: vi.fn(),
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));

    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "void setup(){} void loop(){}" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({ error: { code: "SYSTEM_BUSY", retryAfter: 5 } });
  });
});
