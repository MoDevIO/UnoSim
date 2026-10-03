import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type ClientOptions } from "ws";
import type { Logger } from "@shared/logger";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
const servers: Server[] = [];
const clients: WebSocket[] = [];

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function createHarness() {
  const admission = new SimulationAdmissionController(25);
  const runner = {
    runSketch: vi.fn(async () => true),
    stop: vi.fn().mockResolvedValue(undefined),
    setPinValue: vi.fn(),
    sendSerialInput: vi.fn(),
  };
  const pool = {
    acquireRunner: vi.fn(async () => runner),
    releaseRunner: vi.fn().mockResolvedValue(undefined),
    getRunnerIndex: vi.fn(() => 0),
    getStats: vi.fn(() => ({ availableRunners: 5, totalRunners: 5, maxRunners: 5, queuedRequests: 0 })),
  };
  const server = createServer();
  registerSimulationWebSocket(server, {
    SandboxRunner: class {} as typeof SandboxRunner,
    getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
    getSimulationAdmissionController: () => admission,
    shouldSendSimulationEndMessage: () => true,
    getLastCompiledCode: () => null,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    runnerPool: pool as unknown as SandboxRunnerPool,
    trust: { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" },
    allowedWebSocketOrigins: [ORIGIN],
    disableRateLimit: true,
    heartbeatIntervalMs: 50,
    inboundMessageLimit: { perSecond: 20, burst: 20 },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  async function connect(subject: string, options: ClientOptions = {}) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      ...options,
      headers: { Origin: ORIGIN, "X-UnoSim-Gateway-Secret": SECRET, "X-UnoSim-Subject": subject, "X-UnoSim-Roles": "user" },
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return socket;
  }

  async function startRunning(socket: WebSocket) {
    socket.send(JSON.stringify({ type: "start_simulation", code: "void setup(){} void loop(){}" }));
    await waitFor(() => runner.runSketch.mock.calls.length > 0 && admission.getStats().active === 1, "running simulation");
  }

  return { admission, connect, pool, runner, startRunning };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => new Promise<void>((resolve) => {
    if (client.readyState === WebSocket.CLOSED) return resolve();
    client.once("close", () => resolve());
    client.terminate();
  })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("simulation WebSocket connection lifecycle", () => {
  it("drops a connection that stops answering pings and frees its simulation", async () => {
    const harness = await createHarness();
    const silent = await harness.connect("silent", { autoPong: false });
    await harness.startRunning(silent);

    await waitFor(() => silent.readyState === WebSocket.CLOSED, "server-side termination");
    await waitFor(() => harness.admission.getStats().active === 0, "released reservation");
    expect(harness.runner.stop).toHaveBeenCalled();
    expect(harness.pool.releaseRunner).toHaveBeenCalled();
  });

  it("keeps a connection that answers pings", async () => {
    const harness = await createHarness();
    const responsive = await harness.connect("responsive");

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    expect(responsive.readyState).toBe(WebSocket.OPEN);
  });

  it("drops inbound messages beyond the per-connection rate and keeps the connection", async () => {
    const harness = await createHarness();
    const socket = await harness.connect("flooding");
    await harness.startRunning(socket);

    for (let value = 0; value < 200; value += 1) {
      socket.send(JSON.stringify({ type: "set_pin_value", pin: 3, value: value % 2 }));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(harness.runner.setPinValue.mock.calls.length).toBeGreaterThan(0);
    expect(harness.runner.setPinValue.mock.calls.length).toBeLessThanOrEqual(25);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});
