/**
 * Plan P2.2: the board in the compile request. The route resolves the board
 * against the offered boards and hands the board's FQBN to the compiler.
 */
import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_CATALOG, enabledBoards } from "../../../shared/boards";
import { registerCompilerRoutes } from "../../../server/routes/compiler.routes";

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

async function postCompile(baseUrl: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/compile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("compiler.routes - board selection", () => {
  let server: http.Server;
  let baseUrl: string;
  let compile: ReturnType<typeof vi.fn>;
  let offered = enabledBoards();

  beforeEach(async () => {
    offered = enabledBoards();
    compile = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.unosimIdentity = { subject: "student", roles: ["user"] };
      next();
    });
    registerCompilerRoutes(app, {
      compiler: { compile },
      compilationCache: new Map(),
      hashCode: vi.fn((code: string) => `hash_${code}`),
      CACHE_TTL: 1000,
      setLastCompiledCode: vi.fn(),
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      disableRateLimit: true,
      offeredBoards: () => offered,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("compiles for the FQBN of the selected board and tells the compiler which board", async () => {
    const result = await postCompile(baseUrl, { code: "uno", board: "uno" });

    expect(result.status).toBe(200);
    expect(compile.mock.calls[0][3]).toEqual({ board: "uno", fqbn: "arduino:avr:uno", libraries: undefined });
  });

  it("leaves the options alone when the request names neither board nor fqbn", async () => {
    await postCompile(baseUrl, { code: "plain" });

    expect(compile.mock.calls[0][3]).toEqual({ libraries: undefined });
  });

  it("keeps passing a deprecated fqbn of an offered board as it is", async () => {
    await postCompile(baseUrl, { code: "legacy", fqbn: "arduino:avr:uno" });

    expect(compile.mock.calls[0][3]).toEqual({ fqbn: "arduino:avr:uno", libraries: undefined });
  });

  it("refuses a board the deployment does not offer", async () => {
    const result = await postCompile(baseUrl, { code: "x", board: "mega2560" });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("Board mega2560 is not available");
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses the deprecated fqbn of a board that is not offered", async () => {
    const result = await postCompile(baseUrl, { code: "x", fqbn: "arduino:avr:mega:cpu=atmega2560" });

    expect(result.status).toBe(400);
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses an unknown board, an unknown fqbn and a board with the fqbn of another", async () => {
    for (const body of [{ code: "x", board: "esp32" }, { code: "x", fqbn: "esp32:esp32:esp32" }, { code: "x", board: "uno", fqbn: "arduino:avr:nano:cpu=atmega328" }]) {
      expect((await postCompile(baseUrl, body)).status).toBe(400);
    }
    expect(compile).not.toHaveBeenCalled();
  });

  it("compiles for any board of the catalog once the deployment offers it", async () => {
    offered = BOARD_CATALOG;

    for (const board of BOARD_CATALOG) {
      expect((await postCompile(baseUrl, { code: board.id, board: board.id })).status).toBe(200);
    }

    expect(compile.mock.calls.map((call) => call[3].fqbn)).toEqual(BOARD_CATALOG.map((board) => board.fqbn));
  });
});
