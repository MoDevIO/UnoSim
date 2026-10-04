import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
const MARKER = "SKETCH_SOURCE_MARKER_7d1e";
let server: Server | undefined;
let socket: WebSocket | undefined;

afterEach(async () => {
  socket?.terminate();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("simulation logging", () => {
  it("never writes sketch source to the log, also at debug level", async () => {
    const logged: string[] = [];
    const record = (message: unknown) => logged.push(String(message));
    const logger = { debug: vi.fn(record), info: vi.fn(record), warn: vi.fn(record), error: vi.fn(record) } as unknown as Logger;
    const runSketch = vi.fn(async () => true);
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

    socket.send(JSON.stringify({ type: "start_simulation", code: `void setup(){} void loop(){} // ${MARKER}` }));
    const deadline = Date.now() + 2_000;
    while (runSketch.mock.calls.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));

    expect(runSketch).toHaveBeenCalled();
    expect(logged.filter((message) => message.includes(MARKER))).toEqual([]);
  });
});
