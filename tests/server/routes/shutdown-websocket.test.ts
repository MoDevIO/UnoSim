import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const runnerPool = {
  shutdown: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() {}
    debug() {}
    warn() {}
    error() {}
  },
}));

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
vi.mock("../../../server/routes/examples.routes", () => ({
  registerExamplesRoutes: vi.fn(),
}));
vi.mock("../../../server/routes/tutor.routes", () => ({
  registerTutorRoutes: vi.fn(),
}));
vi.mock("../../../server/services/examples/examples-repository", () => ({
  ExamplesRepository: class {},
}));

describe("shutdown with an active WebSocket client", () => {
  let server: Server | undefined;
  let client: WebSocket | undefined;
  let shutdownPromise: Promise<void> | undefined;

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        client!.once("close", () => resolve());
        client!.close();
      });
    }

    await shutdownPromise;

    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }

    client = undefined;
    server = undefined;
    shutdownPromise = undefined;
    runnerPool.shutdown.mockClear();
  });

  it("closes an active client before completing shutdown", async () => {
    const app = express();
    const { registerRoutes } = await import("../../../server/routes");

    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const { port } = server.address() as AddressInfo;
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      client!.once("open", resolve);
      client!.once("error", reject);
    });

    const shutdownServices = (server as Server & {
      shutdownServices?: () => Promise<void>;
    }).shutdownServices;
    if (!shutdownServices) throw new Error("shutdownServices was not registered");

    shutdownPromise = shutdownServices();
    const completed = await Promise.race([
      shutdownPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(completed).toBe(true);
    if (client.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => client!.once("close", () => resolve()));
    }
    expect(client.readyState).toBe(WebSocket.CLOSED);
    expect(runnerPool.shutdown).toHaveBeenCalledOnce();
  });
});
