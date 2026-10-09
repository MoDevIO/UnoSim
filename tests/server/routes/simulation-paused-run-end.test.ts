import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { RunSketchOptions } from "../../../server/services/run-sketch-types";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

const SECRET = "a-secure-gateway-secret-with-32-characters";
const ORIGIN = "https://classroom.example";
let server: Server | undefined;
let socket: WebSocket | undefined;

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  socket?.terminate();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("a paused run that ends on its pause budget", () => {
  it("releases runner and admission and reports the stopped status", async () => {
    const admission = new SimulationAdmissionController(25);
    let runOptions: RunSketchOptions | undefined;
    const runner = {
      runSketch: vi.fn(async (options: RunSketchOptions) => { runOptions = options; return true; }),
      pause: vi.fn(() => true),
      resume: vi.fn(() => true),
      controlResult: Promise.resolve(true),
      stop: vi.fn().mockResolvedValue(undefined),
      setPinValue: vi.fn(),
      sendSerialInput: vi.fn(),
    };
    const pool = {
      acquireRunner: vi.fn(async () => runner),
      releaseRunner: vi.fn().mockResolvedValue(undefined),
      getRunnerIndex: vi.fn(() => 0),
      getStats: vi.fn(() => ({ availableRunners: 1, totalRunners: 1, maxRunners: 1, queuedRequests: 0 })),
    };
    server = createServer();
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
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`, {
      headers: { Origin: ORIGIN, "X-UnoSim-Gateway-Secret": SECRET, "X-UnoSim-Subject": "student", "X-UnoSim-Roles": "user" },
    });
    const statuses: string[] = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; status?: string };
      if (message.type === "simulation_status" && message.status) statuses.push(message.status);
    });
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });

    socket.send(JSON.stringify({ type: "start_simulation", code: "void setup(){} void loop(){}" }));
    await waitFor(() => statuses.includes("running"), "running");
    socket.send(JSON.stringify({ type: "pause_simulation" }));
    await waitFor(() => statuses.at(-1) === "paused", "paused");
    expect(admission.getStats().active).toBe(1);

    // The runner's pause budget ends the process; its exit reaches the session as onExit.
    runOptions!.onExit?.(137);

    await waitFor(() => statuses.at(-1) === "stopped", "stopped");
    await waitFor(() => admission.getStats().active === 0, "admission release");
    expect(runner.stop).toHaveBeenCalled();
    expect(pool.releaseRunner).toHaveBeenCalledWith(runner);
  });
});
