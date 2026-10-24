/**
 * Plan E15: the route's result cache answers before the compiler, so its key carries the compiler's
 * build environment (toolchain, libraries, build options, artifact format). A changed environment misses it.
 */
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";

let server: http.Server | undefined;

async function start(environment?: () => Promise<string>) {
  const compile = vi.fn().mockResolvedValue({ success: true, output: "ok", errors: [], arduinoCliStatus: "success" });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
    next();
  });
  registerCompilerRoutes(app, {
    compiler: { compile, ...(environment ? { buildEnvironmentId: environment } : {}) },
    compilationCache: new Map() as never,
    hashCode: (code: string) => `hash:${code}`,
    CACHE_TTL: 60_000,
    setLastCompiledCode: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    disableRateLimit: true,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async () =>
    (await fetch(`${baseUrl}/api/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "void setup(){} void loop(){}" }) })).json() as Promise<Record<string, unknown>>;
  return { post, compile };
}

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe("compile result cache and build environment", () => {
  it("serves a cached result only under the build environment it was built under", async () => {
    let environment = "toolchain-a";
    const { post, compile } = await start(async () => environment);

    await post();
    expect(await post()).toMatchObject({ cached: true });
    expect(compile).toHaveBeenCalledTimes(1);

    environment = "toolchain-b"; // e.g. a library installed or a new compile sandbox image
    expect(await post()).not.toHaveProperty("cached");
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("keys by the request alone for a compiler without build environment", async () => {
    const { post, compile } = await start();

    await post();
    expect(await post()).toMatchObject({ cached: true });
    expect(compile).toHaveBeenCalledTimes(1);
  });
});
