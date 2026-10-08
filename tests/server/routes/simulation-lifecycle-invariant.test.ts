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

/**
 * Invariant: a WebSocket connection owns at most one simulation lifecycle, and
 * every lifecycle returns its admission and runner exactly once, whatever the
 * interleaving of start, stop, pause, disconnect and runner events.
 */

const servers: Server[] = [];
const sockets: WebSocket[] = [];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type RunOptions = { onExit?: (code: number | null) => void };

type FakeRunner = {
  id: number;
  runSketch: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  sendSerialInput: ReturnType<typeof vi.fn>;
  setPinValue: ReturnType<typeof vi.fn>;
  run?: RunOptions;
};

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

async function createHarness() {
  const admission = new SimulationAdmissionController(25);
  const runners: FakeRunner[] = [];
  /** Optional hooks a test sets before the corresponding call happens. */
  const control = {
    acquire: [] as Array<Deferred<void> & { ignoreAbort?: boolean }>,
    acquireError: null as Error | null,
    stop: new Map<number, Deferred<void>>(),
    runSketch: new Map<number, Deferred<boolean>>(),
  };
  const pool = {
    acquireRunner: vi.fn(async (signal?: AbortSignal) => {
      const gate = control.acquire.shift();
      if (gate) {
        if (!gate.ignoreAbort) {
          signal?.addEventListener("abort", () => gate.reject(new Error("Runner acquire cancelled")), { once: true });
        }
        await gate.promise;
      }
      if (control.acquireError) throw control.acquireError;
      const id = runners.length + 1;
      const runner: FakeRunner = {
        id,
        runSketch: vi.fn(async (options: RunOptions) => {
          runner.run = options;
          return control.runSketch.get(id)?.promise ?? true;
        }),
        stop: vi.fn(async () => {
          await control.stop.get(id)?.promise;
        }),
        pause: vi.fn(() => true),
        resume: vi.fn(() => true),
        sendSerialInput: vi.fn(),
        setPinValue: vi.fn(),
      };
      runners.push(runner);
      return runner;
    }),
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
    trust: { mode: "local" },
    allowedWebSocketOrigins: [],
    disableRateLimit: false,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(socket);
    const messages: ServerToClientWSMessage[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const send = (type: string, payload: Record<string, unknown> = {}) =>
      socket.send(JSON.stringify({ type, ...payload }));
    return {
      socket,
      messages,
      start: () => send("start_simulation", { code: "void setup() {} void loop() {}" }),
      stop: () => send("stop_simulation"),
      pause: () => send("pause_simulation"),
      statuses: () => messages.flatMap((message) =>
        message.type === "simulation_status" ? [message.status] : []),
      errors: () => messages.flatMap((message) =>
        message.type === "operation_error" ? [message.code] : []),
    };
  }

  const releasedCount = (runner: FakeRunner) =>
    pool.releaseRunner.mock.calls.filter(([released]) => released === runner).length;

  /** Nothing is held: no admission, every acquired runner returned exactly once. */
  async function expectQuiescent(): Promise<void> {
    await waitFor(() => admission.getStats().active === 0, "admission released");
    await waitFor(() => runners.every((runner) => releasedCount(runner) === 1), "runners returned");
    await settle();
    expect(admission.getStats().active).toBe(0);
    for (const runner of runners) expect(releasedCount(runner)).toBe(1);
  }

  return { admission, pool, runners, control, connect, expectQuiescent, releasedCount };
}

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", () => resolve());
    socket.close();
  })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("one simulation lifecycle per WebSocket connection", () => {
  it("rejects a second start while the first run is active and leaks nothing", async () => {
    const harness = await createHarness();
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "first run");

    client.start();
    await waitFor(() => client.errors().includes("SIMULATION_ALREADY_ACTIVE"), "rejection");
    expect(client.statuses().at(-1)).toBe("running");
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
    expect(harness.admission.getStats().active).toBe(1);

    client.stop();
    await harness.expectQuiescent();
  });

  it.each([false, true])("leaves no admission or runner behind after start, start, stop (paused: %s)", async (paused) => {
    const harness = await createHarness();
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "first run");
    if (paused) {
      client.pause();
      await waitFor(() => client.statuses().at(-1) === "paused", "pause");
    }

    client.start();
    await settle();
    client.stop();
    await harness.expectQuiescent();
    for (const runner of harness.runners) expect(runner.stop).toHaveBeenCalled();
  });

  it("rejects a second start while the first waits for a runner", async () => {
    const harness = await createHarness();
    const gate = deferred<void>();
    harness.control.acquire.push(gate);
    const client = await harness.connect();
    client.start();
    await waitFor(() => harness.pool.acquireRunner.mock.calls.length === 1, "queued acquire");

    client.start();
    await waitFor(() => client.errors().includes("SIMULATION_ALREADY_ACTIVE"), "rejection");
    expect(client.statuses().at(-1)).toBe("queued");
    expect(harness.admission.getStats().active).toBe(1);

    gate.resolve();
    await waitFor(() => client.statuses().includes("running"), "first run");
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
    client.stop();
    await harness.expectQuiescent();
  });

  it("lets a start sent right after stop wait for the release instead of overlapping it", async () => {
    const harness = await createHarness();
    const slowStop = deferred<void>();
    harness.control.stop.set(1, slowStop);
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "first run");

    client.stop();
    client.start();
    await settle();
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
    expect(harness.admission.getStats().active).toBe(1);

    slowStop.resolve();
    await waitFor(() => harness.runners.length === 2, "second runner");
    await waitFor(() => client.statuses().at(-1) === "running", "second run");
    expect(client.errors()).toEqual([]);
    expect(harness.releasedCount(harness.runners[0])).toBe(1);
    expect(harness.admission.getStats().active).toBe(1);

    client.socket.close();
    await harness.expectQuiescent();
  });

  it("keeps a paused run and rejects a new start until it is stopped", async () => {
    const harness = await createHarness();
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "run");
    client.pause();
    await waitFor(() => client.statuses().at(-1) === "paused", "pause");

    client.start();
    await waitFor(() => client.errors().includes("SIMULATION_ALREADY_ACTIVE"), "rejection");
    expect(client.statuses().at(-1)).toBe("paused");
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);

    client.stop();
    await harness.expectQuiescent();
    expect(harness.runners[0].stop).toHaveBeenCalled();
  });

  it("cancels a start that waits for the release when the socket disconnects", async () => {
    const harness = await createHarness();
    const slowStop = deferred<void>();
    harness.control.stop.set(1, slowStop);
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "run");

    client.stop();
    client.start();
    await settle();
    client.socket.close();
    await settle();
    slowStop.resolve();

    await harness.expectQuiescent();
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
  });

  it("cancels a start that waits for the release when another stop follows", async () => {
    const harness = await createHarness();
    const slowStop = deferred<void>();
    harness.control.stop.set(1, slowStop);
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "run");

    client.stop();
    client.start();
    client.stop();
    await settle();
    slowStop.resolve();

    await harness.expectQuiescent();
    expect(harness.pool.acquireRunner).toHaveBeenCalledTimes(1);
    expect(client.statuses().at(-1)).toBe("stopped");
  });

  it("disconnects while queued without leaking the reservation", async () => {
    const harness = await createHarness();
    harness.control.acquire.push(deferred<void>());
    const client = await harness.connect();
    client.start();
    await waitFor(() => harness.pool.acquireRunner.mock.calls.length === 1, "queued acquire");

    client.socket.close();
    await harness.expectQuiescent();
  });

  it("returns a runner granted after the lifecycle already ended", async () => {
    const harness = await createHarness();
    const lateGrant = Object.assign(deferred<void>(), { ignoreAbort: true });
    harness.control.acquire.push(lateGrant);
    const client = await harness.connect();
    client.start();
    await waitFor(() => harness.pool.acquireRunner.mock.calls.length === 1, "queued acquire");

    client.stop();
    await waitFor(() => harness.admission.getStats().active === 0, "stop release");
    lateGrant.resolve();
    await waitFor(() => harness.runners.length === 1, "late runner");

    await harness.expectQuiescent();
    expect(harness.runners[0].runSketch).not.toHaveBeenCalled();
    expect(client.statuses()).not.toContain("running");
  });

  it("never reports running for a run stopped during startup", async () => {
    const harness = await createHarness();
    const startup = deferred<boolean>();
    harness.control.runSketch.set(1, startup);
    const client = await harness.connect();
    client.start();
    await waitFor(() => harness.runners[0]?.runSketch.mock.calls.length === 1, "startup");

    client.stop();
    await waitFor(() => harness.admission.getStats().active === 0, "stop release");
    startup.resolve(true);

    await harness.expectQuiescent();
    expect(client.statuses()).not.toContain("running");
    expect(client.statuses().at(-1)).toBe("stopped");
  });

  it("does not report a start failure twice for a run stopped during startup", async () => {
    const harness = await createHarness();
    const startup = deferred<boolean>();
    harness.control.runSketch.set(1, startup);
    const client = await harness.connect();
    client.start();
    await waitFor(() => harness.runners[0]?.runSketch.mock.calls.length === 1, "startup");

    client.stop();
    await waitFor(() => harness.admission.getStats().active === 0, "stop release");
    startup.reject(new Error("killed"));

    await harness.expectQuiescent();
    expect(client.errors()).toEqual([]);
  });

  it("releases the reservation after a failed runner acquire and admits the next start", async () => {
    const harness = await createHarness();
    harness.control.acquireError = new Error("pool exhausted");
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.errors().includes("SYSTEM_BUSY"), "acquire failure");
    expect(harness.admission.getStats().active).toBe(0);

    harness.control.acquireError = null;
    client.start();
    await waitFor(() => client.statuses().at(-1) === "running", "retry run");
    client.socket.close();
    await harness.expectQuiescent();
  });

  it("releases the reservation of a run that ended on its own and admits the next start", async () => {
    const harness = await createHarness();
    const client = await harness.connect();
    client.start();
    await waitFor(() => client.statuses().includes("running"), "run");

    harness.runners[0].run?.onExit?.(0);
    await waitFor(() => harness.admission.getStats().active === 0, "exit release");
    client.start();
    await waitFor(() => harness.runners.length === 2, "second run");
    await waitFor(() => client.statuses().at(-1) === "running", "second running");

    client.stop();
    await harness.expectQuiescent();
  });

  it("still runs separate connections in parallel", async () => {
    const harness = await createHarness();
    const first = await harness.connect();
    const second = await harness.connect();
    first.start();
    second.start();
    await waitFor(() => harness.admission.getStats().active === 2, "two runs");
    expect(first.errors()).toEqual([]);
    expect(second.errors()).toEqual([]);

    first.socket.close();
    second.stop();
    await harness.expectQuiescent();
  });
});
