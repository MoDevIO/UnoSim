/**
 * Plan P2.5 / 4.10: `POST /api/compile` returns the flash image as `artifact`
 * for a successful build, only where the deployment may deliver it, and never
 * the HEX itself.
 */
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSimulationImage } from "@unosim/avr-emulator/image";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";

const HEX_FILE = readFileSync(join(__dirname, "../../../packages/avr-emulator/tests/fixtures/uno-blink.hex"));
const ARTIFACT = { ...buildSimulationImage({ board: "uno", hex: HEX_FILE.toString("utf8") }), buildId: "ab".repeat(32) };

let server: http.Server | undefined;

async function start(options: { artifactDelivery?: boolean; result?: Record<string, unknown> }) {
  const compile = vi.fn().mockResolvedValue({ success: true, output: "ok", errors: [], arduinoCliStatus: "success", binary: HEX_FILE, artifact: ARTIFACT, ...options.result });
  const compilationCache = new Map<string, { result: unknown; timestamp: number }>();
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
    next();
  });
  registerCompilerRoutes(app, {
    compiler: { compile },
    compilationCache: compilationCache as never,
    hashCode: (code: string) => `hash:${code}`,
    CACHE_TTL: 60_000,
    setLastCompiledCode: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    disableRateLimit: true,
    ...(options.artifactDelivery === undefined ? {} : { artifactDelivery: options.artifactDelivery }),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (code = "void setup(){} void loop(){}") =>
    (await fetch(`${baseUrl}/api/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })).json() as Promise<Record<string, unknown>>;
  return { post, compile, compilationCache };
}

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe("compile response artifact", () => {
  it("delivers the artifact of a successful build, fresh and from the result cache, and never the binary", async () => {
    const { post } = await start({ artifactDelivery: true });

    const fresh = await post();
    const cached = await post();

    expect(fresh.artifact).toEqual(ARTIFACT);
    expect(cached).toMatchObject({ cached: true, artifact: ARTIFACT });
    expect(fresh).not.toHaveProperty("binary");
    expect(cached).not.toHaveProperty("binary");
  });

  it("keeps the artifact once in the result cache and the binary out of it", async () => {
    const { post, compilationCache } = await start({ artifactDelivery: true });

    await post();

    const entries = [...compilationCache.values()].map((entry) => entry.result as Record<string, unknown>);
    expect(entries).toHaveLength(1);
    expect(entries[0].artifact).toEqual(ARTIFACT);
    expect(entries[0]).not.toHaveProperty("binary");
  });

  it("withholds the artifact where delivery is not allowed, also from the cache", async () => {
    const { post, compilationCache } = await start({ artifactDelivery: false });

    const fresh = await post();
    const cached = await post();

    expect(fresh).not.toHaveProperty("artifact");
    expect(cached).not.toHaveProperty("artifact");
    expect([...compilationCache.values()].every((entry) => !("artifact" in (entry.result as object)))).toBe(true);
  });

  it("withholds the artifact by default", async () => {
    const { post } = await start({});

    expect(await post()).not.toHaveProperty("artifact");
  });

  it("has no artifact in a failed result, even if the compiler returned one", async () => {
    const { post } = await start({ artifactDelivery: true, result: { success: false } });

    const response = await post();

    expect(response).toMatchObject({ success: false });
    expect(response).not.toHaveProperty("artifact");
  });

  it("leaves a successful result without artifact (board outside the catalog) as it is", async () => {
    const { post } = await start({ artifactDelivery: true, result: { artifact: undefined } });

    const response = await post();

    expect(response).toMatchObject({ success: true });
    expect(response).not.toHaveProperty("artifact");
  });
});
