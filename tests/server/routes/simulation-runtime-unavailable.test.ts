import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

/** Plan P2.6: a server without the host mock refuses start_simulation with RUNTIME_UNAVAILABLE. */
const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
let server: Server | undefined;
let socket: WebSocket | undefined;

afterEach(async () => {
  socket?.terminate();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function connect(runtimeBackends: string[]) {
  const acquireRunner = vi.fn(async () => ({ runSketch: vi.fn(async () => true), stop: vi.fn().mockResolvedValue(undefined) }));
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  server = createServer();
  registerSimulationWebSocket(server, {
    SandboxRunner: class {} as typeof SandboxRunner,
    getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
    getSimulationAdmissionController: () => new SimulationAdmissionController(25),
    shouldSendSimulationEndMessage: () => true,
    getLastCompiledCode: () => null,
    logger,
    runnerPool: {
      acquireRunner,
      releaseRunner: vi.fn().mockResolvedValue(undefined),
      getRunnerIndex: vi.fn(() => 0),
      getStats: vi.fn(() => ({ availableRunners: 1, totalRunners: 1, maxRunners: 1, queuedRequests: 0 })),
    } as unknown as SandboxRunnerPool,
    trust: { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" },
    allowedWebSocketOrigins: [ORIGIN],
    disableRateLimit: true,
    runtimeBackends,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`, {
    headers: { Origin: ORIGIN, "X-UnoSim-Gateway-Secret": SECRET, "X-UnoSim-Subject": "student", "X-UnoSim-Roles": "user" },
  });
  const messages: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
  return { messages, acquireRunner };
}

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 2_000;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("start_simulation without the host mock", () => {
  it("answers with RUNTIME_UNAVAILABLE and a stopped status, and takes no runner", async () => {
    const { messages, acquireRunner } = await connect(["browser"]);

    socket!.send(JSON.stringify({ type: "start_simulation", code: "void setup(){} void loop(){}" }));
    await until(() => messages.some((m) => m.type === "operation_error"));

    expect(messages).toContainEqual(expect.objectContaining({ type: "operation_error", operation: "start_simulation", code: "RUNTIME_UNAVAILABLE" }));
    expect(messages).toContainEqual({ type: "simulation_status", status: "stopped" });
    expect(acquireRunner).not.toHaveBeenCalled();
  });

  it("starts as usual when the host mock is offered", async () => {
    const { messages, acquireRunner } = await connect(["browser", "host-mock"]);

    socket!.send(JSON.stringify({ type: "start_simulation", code: "void setup(){} void loop(){}" }));
    await until(() => acquireRunner.mock.calls.length > 0);

    expect(acquireRunner).toHaveBeenCalled();
    expect(messages.some((m) => m.code === "RUNTIME_UNAVAILABLE")).toBe(false);
  });
});
