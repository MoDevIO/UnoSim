import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import type { RunSketchOptions } from "../../../server/services/run-sketch-types";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
let server: Server | undefined;
let socket: WebSocket | undefined;

afterEach(async () => {
  socket?.terminate();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("simulation runtime diagnostics", () => {
  it("does not write a log entry per runtime diagnostic line", async () => {
    const logged: string[] = [];
    const record = (message: unknown) => logged.push(String(message));
    const logger = { debug: vi.fn(), info: vi.fn(record), warn: vi.fn(record), error: vi.fn(record) } as unknown as Logger;
    let runOptions: RunSketchOptions | undefined;
    const runSketch = vi.fn(async (options: RunSketchOptions) => {
      runOptions = options;
      return true;
    });
    server = createServer();
    registerSimulationWebSocket(server, {
      SandboxRunner: class {} as typeof SandboxRunner,
      getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
      getSimulationAdmissionController: () => new SimulationAdmissionController(25),
      shouldSendSimulationEndMessage: () => true,
      getLastCompiledCode: () => null,
      logger,
      runnerPool: {
        acquireRunner: vi.fn(async () => ({ runSketch, stop: vi.fn().mockResolvedValue(undefined) })),
        releaseRunner: vi.fn().mockResolvedValue(undefined),
        getRunnerIndex: vi.fn(() => 0),
        getStats: vi.fn(() => ({ availableRunners: 1, totalRunners: 1, maxRunners: 1, queuedRequests: 0 })),
      } as unknown as SandboxRunnerPool,
      trust: { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" },
      allowedWebSocketOrigins: [ORIGIN],
      disableRateLimit: true,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`, {
      headers: { Origin: ORIGIN, "X-UnoSim-Gateway-Secret": SECRET, "X-UnoSim-Subject": "student", "X-UnoSim-Roles": "user" },
    });
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
    socket.send(JSON.stringify({ type: "start_simulation", code: "void setup(){} void loop(){}" }));
    const deadline = Date.now() + 2_000;
    while (!runOptions && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    expect(runOptions).toBeDefined();
    logged.length = 0;

    for (let index = 0; index < 10_000; index++) runOptions!.onError("diagnostic line");

    // Without aggregation each diagnostic line produced its own warning.
    expect(logged.length).toBeLessThan(10);
  });
});
