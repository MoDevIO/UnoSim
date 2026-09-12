import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerExamplesRoutes } from "../../../server/routes/examples.routes";
import { IdentityRateLimiter } from "../../../server/services/rate-limiter";

const revision = "a".repeat(40);
const gateway = { mode: "gateway" as const, gatewaySecret: "s".repeat(32), trustedProxy: "127.0.0.1" };
const authHeaders = {
  "x-unosim-gateway-secret": gateway.gatewaySecret,
  "x-unosim-subject": "teacher",
  "x-unosim-roles": "user",
};

function request(baseUrl: string, method: string, route: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method,
      headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), headers: res.headers }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("request-scoped examples routes", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  });

  async function start(validateMax = 5, overrideMax = 60) {
    const validate = vi.fn(async (selection) => ({
      selection: "browser-override" as const, mode: "repository-ref" as const, ...selection,
      revision, status: "remote" as const, stale: false,
    }));
    const getCatalog = vi.fn(async (selection) => ({
      schemaVersion: 1 as const,
      source: selection.kind === "default"
        ? { selection: "default" as const, mode: "builtin" as const, repository: null, ref: null, revision: null, status: "builtin" as const, stale: false as const }
        : { selection: "browser-override" as const, mode: "repository-ref" as const, repository: selection.repository, ref: selection.ref, revision, status: "cache" as const, stale: false },
      examples: [],
    }));
    const getExample = vi.fn(async (_repository, requestedRevision, id) => id === "missing" ? null : ({
      schemaVersion: 1 as const, id, title: "Example", category: "Test", main: "main.ino", source: "external" as const,
      revision: requestedRevision ?? null, files: [{ name: "main.ino", path: "main.ino", content: "code" }],
    }));
    const app = express();
    app.use(express.json());
    registerExamplesRoutes(app, { validate, getCatalog, getExample }, {
      trust: gateway,
      validateRateLimiter: new IdentityRateLimiter("test validate", { maxRequests: validateMax, windowMs: 60_000, blockDurationMs: 60_000 }),
      overrideRateLimiter: new IdentityRateLimiter("test override", { maxRequests: overrideMax, windowMs: 60_000, blockDurationMs: 30_000 }),
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address() as { port: number };
    return { baseUrl: `http://127.0.0.1:${address.port}`, validate, getCatalog, getExample };
  }

  it("supports validate and request-scoped catalog with private no-store", async () => {
    const { baseUrl, validate, getCatalog } = await start();
    const body = { schemaVersion: 1, selection: { repository: "owner/repo", ref: "main" } };
    const validated = await request(baseUrl, "POST", "/api/examples/validate", body, authHeaders);
    expect(validated).toMatchObject({ status: 200, body: { valid: true, source: { repository: "owner/repo", ref: "main", revision } } });
    expect(validated.headers["cache-control"]).toBe("private, no-store");
    expect(validate).toHaveBeenCalledWith(body.selection, expect.objectContaining({ identity: "teacher" }));

    const catalog = await request(baseUrl, "GET", "/api/examples?repository=owner%2Frepo&ref=main", undefined, authHeaders);
    expect(catalog.status).toBe(200);
    expect(catalog.headers["cache-control"]).toBe("private, no-store");
    expect(getCatalog).toHaveBeenCalledWith(
      { kind: "browser-override", repository: "owner/repo", ref: "main" },
      expect.objectContaining({ identity: "teacher" }),
    );
  });

  it("rejects partial, duplicate, unknown, invalid repository and invalid revision parameters", async () => {
    const { baseUrl } = await start();
    expect((await request(baseUrl, "GET", "/api/examples?repository=owner%2Frepo", undefined, authHeaders)).status).toBe(400);
    expect((await request(baseUrl, "POST", "/api/examples/validate", {
      schemaVersion: 1, selection: { repository: "owner/repo" },
    }, authHeaders)).body.error.code).toBe("INVALID_SELECTION");
    expect((await request(baseUrl, "GET", "/api/examples?repository=owner%2Frepo&repository=other%2Frepo&ref=main", undefined, authHeaders)).status).toBe(400);
    expect((await request(baseUrl, "GET", "/api/examples?unknown=x")).status).toBe(400);
    expect((await request(baseUrl, "GET", "/api/examples?repository=owner%2Frepo&ref=feature%2Fbranch", undefined, authHeaders)).body.error.code).toBe("INVALID_REF");
    expect((await request(baseUrl, "POST", "/api/examples/validate", {
      schemaVersion: 1, selection: { repository: "owner/repo", ref: "feature/branch" },
    }, authHeaders)).body.error.code).toBe("INVALID_REF");
    expect((await request(baseUrl, "GET", `/api/examples/example?repository=Owner%2FRepo&revision=${revision}`, undefined, authHeaders)).body.error.code).toBe("INVALID_SELECTION");
    const invalid = await request(baseUrl, "GET", "/api/examples/example?repository=owner%2Frepo&revision=main", undefined, authHeaders);
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: "INVALID_REVISION" } } });
  });

  it("passes exact repository and catalog revision to detail and maps missing examples", async () => {
    const { baseUrl, getExample } = await start();
    const route = `/api/examples/example?repository=owner%2Frepo&revision=${revision}`;
    const detail = await request(baseUrl, "GET", route, undefined, authHeaders);
    expect(detail.body.revision).toBe(revision);
    expect(getExample).toHaveBeenCalledWith("owner/repo", revision, "example", expect.anything());
    const missing = await request(baseUrl, "GET", `/api/examples/missing?repository=owner%2Frepo&revision=${revision}`, undefined, authHeaders);
    expect(missing).toMatchObject({ status: 404, body: { error: { code: "EXAMPLE_NOT_FOUND" } } });
  });

  it("rate-limits validate and override reads per trusted identity", async () => {
    const { baseUrl } = await start(1, 1);
    const body = { schemaVersion: 1, selection: { repository: "owner/repo", ref: "main" } };
    expect((await request(baseUrl, "POST", "/api/examples/validate", body, authHeaders)).status).toBe(200);
    expect((await request(baseUrl, "POST", "/api/examples/validate", body, authHeaders)).status).toBe(429);
    const route = "/api/examples?repository=owner%2Frepo&ref=main";
    expect((await request(baseUrl, "GET", route, undefined, authHeaders)).status).toBe(200);
    expect((await request(baseUrl, "GET", route, undefined, authHeaders)).status).toBe(429);
  });

  it("keeps anonymous gateway default reads but rejects anonymous overrides", async () => {
    const { baseUrl } = await start();
    expect((await request(baseUrl, "GET", "/api/examples")).status).toBe(200);
    expect((await request(baseUrl, "GET", "/api/examples?repository=owner%2Frepo&ref=main")).status).toBe(401);
    expect((await request(baseUrl, "GET", `/api/examples/example?repository=owner%2Frepo&revision=${revision}`)).status).toBe(401);
  });
});
