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

type RunCallbacks = {
  onExit?: (code: number | null) => void;
  onCompileError?: (error: string) => void;
};

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function gatewayHeaders(subject: string): Record<string, string> {
  return {
    Origin: ORIGIN,
    "X-UnoSim-Gateway-Secret": SECRET,
    "X-UnoSim-Subject": subject,
    "X-UnoSim-Roles": "user",
  };
}

async function createHarness(options: {
  maxAdmissions?: number;
  gateway?: boolean;
  rateResult?: { allowed: boolean; retryAfter?: number };
  runSketch?: (callbacks: RunCallbacks) => Promise<void>;
} = {}) {
  const admission = new SimulationAdmissionController(options.maxAdmissions ?? 25);
  const callbacks: RunCallbacks[] = [];
  const runners: Array<{
    runSketch: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const pool = {
    acquireRunner: vi.fn(async () => {
      const runner = {
        pause: vi.fn(() => true),
        resume: vi.fn(() => true),
        sendSerialInput: vi.fn(),
        setPinValue: vi.fn(),
        runSketch: vi.fn(async (runCallbacks: RunCallbacks) => {
          callbacks.push(runCallbacks);
          await options.runSketch?.(runCallbacks);
        }),
        getSandboxStatus: vi.fn(() => ({ mode: "local-limited" })),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      runners.push(runner);
      return runner;
    }),
    releaseRunner: vi.fn().mockResolvedValue(undefined),
    getRunnerIndex: vi.fn(() => 0),
    getStats: vi.fn(() => ({
      availableRunners: 5,
      totalRunners: 5,
      maxRunners: 5,
      queuedRequests: 0,
    })),
  };
  const server = createServer();
  const api = registerSimulationWebSocket(server, {
    SandboxRunner: class {} as typeof SandboxRunner,
    getSimulationRateLimiter: () => ({
      checkLimit: () => options.rateResult ?? { allowed: true },
    }),
    getSimulationAdmissionController: () => admission,
    shouldSendSimulationEndMessage: () => true,
    getLastCompiledCode: () => null,
    logger: logger(),
    runnerPool: pool as unknown as SandboxRunnerPool,
    trust: options.gateway
      ? { mode: "gateway", gatewaySecret: SECRET, trustedProxy: "127.0.0.1" }
      : { mode: "local" },
    allowedWebSocketOrigins: options.gateway ? [ORIGIN] : [],
    disableRateLimit: false,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  async function connect(subject?: string) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      subject ? { headers: gatewayHeaders(subject) } : undefined,
    );
    clients.push(socket);
    const messages: ServerToClientWSMessage[] = [];
    socket.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return { socket, messages };
  }

  return { admission, api, callbacks, connect, pool, runners };
}

function start(client: { socket: WebSocket }): void {
  client.socket.send(JSON.stringify({
    type: "start_simulation",
    code: "void setup() {} void loop() {}",
  }));
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => new Promise<void>((resolve) => {
    if (client.readyState === WebSocket.CLOSED) return resolve();
    client.once("close", () => resolve());
    client.close();
  })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("simulation admission through /ws", () => {
  it("applies the simulation-start rate limit with structured retry semantics", async () => {
    const harness = await createHarness({
      rateResult: { allowed: false, retryAfter: 4 },
    });
    const client = await harness.connect();

    start(client);
    await waitFor(
      () => client.messages.some((message) => message.type === "operation_error"),
      "rate-limit error",
    );

    expect(client.messages).toContainEqual({
      type: "operation_error",
      operation: "start_simulation",
      code: "RATE_LIMITED",
      message: "Simulation start rate limit exceeded. Please wait 4 seconds before starting again.",
      retryAfter: 4,
    });
    expect(harness.pool.acquireRunner).not.toHaveBeenCalled();
  });

  it("rejects a second socket with the same authenticated gateway subject", async () => {
    const harness = await createHarness({ gateway: true });
    const first = await harness.connect("student-a");
    const second = await harness.connect("student-a");
    start(first);
    await waitFor(() => harness.admission.getStats().active === 1, "first admission");

    start(second);
    await waitFor(
      () => second.messages.some(
        (message) => message.type === "operation_error" &&
          message.code === "SIMULATION_ALREADY_ACTIVE",
      ),
      "same-subject rejection",
    );

    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("admits different gateway subjects independently", async () => {
    const harness = await createHarness({ gateway: true });
    const first = await harness.connect("student-a");
    const second = await harness.connect("student-b");

    start(first);
    start(second);
    await waitFor(() => harness.admission.getStats().active === 2, "two admissions");

    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(2);
  });

  it("does not collapse direct local/test WebSocket clients into one identity", async () => {
    const harness = await createHarness();
    const first = await harness.connect();
    const second = await harness.connect();

    start(first);
    start(second);
    await waitFor(() => harness.admission.getStats().active === 2, "local admissions");

    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(2);
  });

  it("fails fast with SYSTEM_BUSY at the global admission limit", async () => {
    const harness = await createHarness({ gateway: true, maxAdmissions: 1 });
    const first = await harness.connect("student-a");
    const second = await harness.connect("student-b");
    start(first);
    await waitFor(() => harness.admission.getStats().active === 1, "full admission");

    start(second);
    await waitFor(
      () => second.messages.some(
        (message) => message.type === "operation_error" && message.code === "SYSTEM_BUSY",
      ),
      "SYSTEM_BUSY",
    );

    expect(second.messages).toContainEqual({
      type: "operation_error",
      operation: "start_simulation",
      code: "SYSTEM_BUSY",
      message: "Der Simulator ist momentan ausgelastet. Bitte in wenigen Sekunden erneut versuchen.",
      retryAfter: 5,
    });
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("releases reservations on stop and disconnect", async () => {
    const harness = await createHarness();
    const stopped = await harness.connect();
    start(stopped);
    await waitFor(() => harness.admission.getStats().active === 1, "running admission");
    stopped.socket.send(JSON.stringify({ type: "stop_simulation" }));
    await waitFor(() => harness.admission.getStats().active === 0, "stop release");

    const disconnected = await harness.connect();
    start(disconnected);
    await waitFor(() => harness.admission.getStats().active === 1, "second admission");
    disconnected.socket.close();
    await waitFor(() => harness.admission.getStats().active === 0, "disconnect release");
    expect(harness.admission.getStats().active).toBe(0);
  });

  it("releases reservations after a start error and timeout exit", async () => {
    const failed = await createHarness({
      runSketch: async () => {
        throw new Error("start failed");
      },
    });
    const failedClient = await failed.connect();
    start(failedClient);
    await waitFor(
      () => failedClient.messages.some(
        (message) => message.type === "operation_error" &&
          message.code === "SIMULATION_START_FAILED",
      ),
      "start failure",
    );
    expect(failed.admission.getStats().active).toBe(0);

    const timedOut = await createHarness();
    const timedOutClient = await timedOut.connect();
    start(timedOutClient);
    await waitFor(() => timedOut.callbacks.length === 1, "run callbacks");
    timedOut.callbacks[0].onExit?.(null);
    await waitFor(() => timedOut.admission.getStats().active === 0, "timeout release");
  });

  it("releases reservations on compile error and administrative cleanup", async () => {
    const harness = await createHarness();
    const compileErrorClient = await harness.connect();
    start(compileErrorClient);
    await waitFor(() => harness.callbacks.length === 1, "compile callbacks");
    harness.callbacks[0].onCompileError?.("compile failed");
    await waitFor(() => harness.admission.getStats().active === 0, "compile-error release");

    const cleanupClient = await harness.connect();
    start(cleanupClient);
    await waitFor(() => harness.admission.getStats().active === 1, "cleanup admission");
    await harness.api.stopAllRunnersAndNotify();
    expect(harness.admission.getStats().active).toBe(0);
  });
});
