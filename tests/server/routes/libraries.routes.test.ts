import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";
import { registerLibraryRoutes } from "../../../server/routes/libraries.routes";
import type { ProvidedLibrary } from "../../../server/services/libraries/library-service";

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

const AUNIT_SHA = "32ba9479d215b07b550703674ccd44575a58341340d143dc7e091bdaf99be796";
const PROVIDED: ProvidedLibrary[] = [{ name: "AUnit", version: "1.7.1", sha256: AUNIT_SHA, dir: "/libs/AUnit-1.7.1/AUnit" }];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function start(provided: ProvidedLibrary[]) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "student-a", roles: ["user"] };
    next();
  });
  const compile = vi.fn().mockResolvedValue({ success: true, output: "ok", errors: [], arduinoCliStatus: "success" });
  const hashCode = vi.fn(() => "hash");
  registerCompilerRoutes(app, {
    compiler: { compile },
    compilationCache: new Map(),
    hashCode,
    CACHE_TTL: 60_000,
    setLastCompiledCode: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    disableRateLimit: true,
    providedLibraries: async () => provided,
  });
  registerLibraryRoutes(app, { providedLibraries: async () => provided, builtInExampleIds: async () => new Map([["libraries/AUnit/AUnitMinimal/AUnitMinimal.ino", "builtin-libraries-AUnit-AUnitMinimal-AUnitMinimal-ino"]]) });
  const server = await new Promise<http.Server>((done) => {
    const listening = app.listen(0, "127.0.0.1", () => done(listening));
  });
  servers.push(server);
  const { port } = server.address() as { port: number };
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, compile, hashCode };
}

describe("POST /api/compile with project libraries (SSOT Libraries §10)", () => {
  it("compiles with the resolved packages and keys the result cache by them", async () => {
    const { request, compile, hashCode } = await start(PROVIDED);

    const response = await request("POST", "/api/compile", { code: "void setup(){}\nvoid loop(){}", board: "uno", libraries: [{ name: "AUnit", version: "1.7.1" }] });

    expect(response.status).toBe(200);
    expect(compile.mock.calls[0][3]).toEqual({ board: "uno", fqbn: "arduino:avr:uno", libraries: PROVIDED });
    expect(hashCode.mock.calls[0][2]).toMatchObject({ libraries: PROVIDED });
  });

  it("answers a package this server does not provide with a compile error, without compiling", async () => {
    const { request, compile } = await start([]);

    const response = await request("POST", "/api/compile", { code: "x", libraries: [{ name: "AUnit", version: "1.7.1" }] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: false,
      arduinoCliStatus: "error",
      errors: [{ file: "libraries", line: 0, type: "error", message: "AUnit 1.7.1 is not installed on this server" }],
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("does not substitute another version", async () => {
    const { request, compile } = await start(PROVIDED);

    const response = await request("POST", "/api/compile", { code: "x", libraries: [{ name: "AUnit", version: "1.7.0" }] });

    expect(response.body.errors[0].message).toBe("AUnit 1.7.0 is not available on this server");
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses ranges, wildcards and a name twice as an invalid request", async () => {
    const { request } = await start(PROVIDED);

    for (const libraries of [[{ name: "AUnit", version: "*" }], [{ name: "AUnit", version: "1.7.1" }, { name: "AUnit", version: "1.7.0" }]]) {
      expect((await request("POST", "/api/compile", { code: "x", libraries })).status).toBe(400);
    }
  });
});

describe("GET /api/libraries", () => {
  it("lists the catalog with availability and the id of each built-in example", async () => {
    const { request } = await start(PROVIDED);

    const response = await request("GET", "/api/libraries");

    expect(response.status).toBe(200);
    expect(response.body.packages[0]).toMatchObject({
      name: "AUnit",
      version: "1.7.1",
      available: true,
      examples: [{ title: "AUnit minimal example", path: "libraries/AUnit/AUnitMinimal/AUnitMinimal.ino", exampleId: "builtin-libraries-AUnit-AUnitMinimal-AUnitMinimal-ino" }],
    });
    expect(response.body.packages[0]).not.toHaveProperty("archive");
  });

  it("states that a package is missing on this deployment", async () => {
    const { request } = await start([]);

    expect((await request("GET", "/api/libraries")).body.packages[0]).toMatchObject({ available: false, unavailableReason: "AUnit 1.7.1 is not installed on this server" });
  });
});
