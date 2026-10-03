import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import type { ServerToClientWSMessage } from "@shared/schema";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
const servers: Server[] = [];
const clients: WebSocket[] = [];

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function createHarness(lastCompiled: Record<string, string>) {
  const runSketch = vi.fn(async () => false);
  const pool = {
    acquireRunner: vi.fn(async () => ({ runSketch, stop: vi.fn().mockResolvedValue(undefined) })),
    releaseRunner: vi.fn().mockResolvedValue(undefined),
    getRunnerIndex: vi.fn(() => 0),
    getStats: vi.fn(() => ({ availableRunners: 5, totalRunners: 5, maxRunners: 5, queuedRequests: 0 })),
  };
  const server = createServer();
  registerSimulationWebSocket(server, {
    SandboxRunner: class {} as typeof SandboxRunner,
    getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
    getSimulationAdmissionController: () => new SimulationAdmissionController(25),
    shouldSendSimulationEndMessage: () => true,
    getLastCompiledCode: (subject: string) => lastCompiled[subject] ?? null,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    runnerPool: pool as unknown as SandboxRunnerPool,
    trust: { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" },
    allowedWebSocketOrigins: [ORIGIN],
    disableRateLimit: true,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  async function connect(subject: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: ORIGIN, "X-UnoSim-Gateway-Secret": SECRET, "X-UnoSim-Subject": subject, "X-UnoSim-Roles": "user" },
    });
    clients.push(socket);
    const messages: ServerToClientWSMessage[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return { socket, messages };
  }

  return { connect, runSketch };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => new Promise<void>((resolve) => {
    if (client.readyState === WebSocket.CLOSED) return resolve();
    client.once("close", () => resolve());
    client.close();
  })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("start_simulation without code (legacy fallback)", () => {
  it("never runs code that another subject compiled", async () => {
    const harness = await createHarness({ alice: "void setup(){} void loop(){} // alice" });
    const bob = await harness.connect("bob");

    bob.socket.send(JSON.stringify({ type: "start_simulation" }));
    await waitFor(() => bob.messages.some((m) => m.type === "serial_output"), "missing-code message");

    expect(harness.runSketch).not.toHaveBeenCalled();
    expect(bob.messages).toContainEqual({ type: "serial_output", data: "[ERR] No compiled code available. Please compile first.\n" });
  });

  it("keeps the fallback to the same subject's last compiled code", async () => {
    const harness = await createHarness({ alice: "void setup(){} void loop(){} // alice" });
    const alice = await harness.connect("alice");

    alice.socket.send(JSON.stringify({ type: "start_simulation" }));
    await waitFor(() => harness.runSketch.mock.calls.length === 1, "alice run");

    expect(harness.runSketch).toHaveBeenCalledWith(expect.objectContaining({ code: "void setup(){} void loop(){} // alice" }));
  });
});
