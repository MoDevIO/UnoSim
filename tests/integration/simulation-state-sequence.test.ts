/**
 * Integration Tests: Simulation State Sequence
 *
 * Verifies the full state machine visible at the WebSocket level, which is the
 * single source of truth for the external postMessage API and the top-right
 * debug label.
 *
 * Expected lifecycle:
 *   idle
 *   → [simulation_status: queued]        ← only when pool is saturated
 *   → simulation_status: running
 *   → compilation_status gccStatus: compiling
 *   → [compilation_status gccStatus: queued]   ← only when compile slot is unavailable
 *   → compilation_status gccStatus: success
 *   → (serial output)
 *   → simulation_status: stopped
 *
 * If the user pauses:
 *   → simulation_status: paused
 *   → simulation_status: running          (after resume)
 *
 * Regression: Clients whose runner request was queued must eventually run —
 * they must NOT stay permanently "gray" (stopped/unknown) after resources free up.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import WebSocket from "ws";

// ── Configurable mock behaviour ──────────────────────────────────────────────
// Tests mutate this object before running clients so each scenario can control
// timing and callback firing without restarting the server.

interface MockBehavior {
  /** How long runSketch waits before calling onExit (ms). */
  runDurationMs: number;
  /** If true, runSketch calls onCompileQueued before onCompileSuccess. */
  callCompileQueued: boolean;
  /** If true, pause() / resume() return true (simulate a runner that supports pause). */
  supportsPause: boolean;
}

const mockBehavior: MockBehavior = {
  runDurationMs: 60,
  callCompileQueued: false,
  supportsPause: false,
};

interface WorkerMessage {
  type: string;
  status?: string;
  gccStatus?: string;
  data?: string;
}

function parseWorkerMessage(raw: WebSocket.RawData): WorkerMessage {
  let json: string;
  if (typeof raw === "string") {
    json = raw;
  } else if (Buffer.isBuffer(raw)) {
    json = Buffer.from(raw).toString("utf8");
  } else if (raw instanceof ArrayBuffer) {
    json = Buffer.from(raw).toString("utf8");
  } else if (
    Array.isArray(raw) &&
    raw.every((item): item is Buffer => Buffer.isBuffer(item))
  ) {
    json = Buffer.concat(raw).toString("utf8");
  } else {
    throw new Error("Unsupported WebSocket message data type");
  }
  return JSON.parse(json);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── MockSandboxRunner ────────────────────────────────────────────────────────

class MockSandboxRunner {
  isRunning = false;
  _state = "stopped";
  _isPaused = false;

  get state() {
    return this._state;
  }
  set state(v: string) {
    this._state = v;
    this.executionState.state = v;
  }

  executionState: {
    state: string;
    pauseStartTime: number | null;
    totalPausedTime: number;
    processKilled: boolean;
    pendingCleanup: boolean;
    pinStateBatcher: unknown;
    serialOutputBatcher: unknown;
    onOutputCallback: unknown;
    errorCallback: unknown;
    telemetryCallback: unknown;
    pinStateCallback: unknown;
    ioRegistryCallback: unknown;
    outputBuffer: string;
    outputBufferIndex: number;
    totalOutputBytes: number;
    isSendingOutput: boolean;
    messageQueue: unknown[];
    stderrFallbackBuffer: string;
    backpressurePaused: boolean;
    flushTimer: NodeJS.Timeout | null;
    dockerAvailable: boolean;
    dockerImageBuilt: boolean;
  } = {
    state: "stopped",
    pauseStartTime: null,
    totalPausedTime: 0,
    processKilled: false,
    pendingCleanup: false,
    pinStateBatcher: null,
    serialOutputBatcher: null,
    onOutputCallback: null,
    errorCallback: null,
    telemetryCallback: null,
    pinStateCallback: null,
    ioRegistryCallback: undefined,
    outputBuffer: "",
    outputBufferIndex: 0,
    totalOutputBytes: 0,
    isSendingOutput: false,
    messageQueue: [],
    stderrFallbackBuffer: "",
    backpressurePaused: false,
    flushTimer: null,
    dockerAvailable: false,
    dockerImageBuilt: false,
  };

  processController = null;
  registryManager = null;
  fileBuilder = null;
  timeoutManager = null;
  flushMessageQueue = vi.fn();
  _sketchDir: string | null = null;

  async runSketch(options: Record<string, unknown>): Promise<void> {
    this.isRunning = true;
    this._state = "running";

    const onCompileQueued = options.onCompileQueued as (() => void) | undefined;
    const onCompileSuccess = options.onCompileSuccess as
      | (() => void)
      | undefined;
    const onOutput = options.onOutput as
      | ((line: string, isComplete?: boolean) => void)
      | undefined;
    const onExit = options.onExit as
      | ((code: number | null) => void)
      | undefined;

    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        if (this._state !== "running") {
          resolve();
          return;
        }

        // Optionally simulate waiting for a compile slot
        if (mockBehavior.callCompileQueued) {
          onCompileQueued?.();
          await sleep(1);
        }

        onCompileSuccess?.();
        onOutput?.("LED ON", true);
        onOutput?.("LED OFF", true);

        // Wait runDurationMs before exit so tests can observe the running state
        setTimeout(() => {
          if (this._state === "stopped") {
            resolve();
            return;
          }
          this.isRunning = false;
          this._state = "stopped";
          onExit?.(0);
          resolve();
        }, mockBehavior.runDurationMs);
      }, 1);
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this._isPaused = false;
    this._state = "stopped";
  }

  pause(): boolean {
    if (!mockBehavior.supportsPause) return false;
    this._isPaused = true;
    this._state = "paused";
    return true;
  }

  resume(): boolean {
    if (!mockBehavior.supportsPause || !this._isPaused) return false;
    this._isPaused = false;
    this._state = "running";
    return true;
  }

  getSandboxStatus() {
    return {
      dockerAvailable: false,
      dockerImageBuilt: false,
      mode: "local-limited" as const,
    };
  }
  getSketchDir() {
    return this._sketchDir;
  }
  setRegistryFile() {
    /* no-op */
  }
  setPinValue() {
    /* no-op */
  }
  sendSerialInput() {
    /* no-op */
  }
}

// ── Vitest module mocks ──────────────────────────────────────────────────────

vi.mock("../../server/services/sandbox-runner", () => ({
  SandboxRunner: MockSandboxRunner,
}));

vi.mock("../../server/services/registry-manager", () => ({
  RegistryManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock("../../server/services/compiler-with-fallback", () => {
  class MockCompilerWithFallback {
    async compile() {
      return { success: true, firmware: "deadbeef", errors: [], parsed: [] };
    }
    async shutdown() {
      /* no-op */
    }
  }
  return {
    CompilerWithFallback: MockCompilerWithFallback,
    getCompilerWithFallback: () => new MockCompilerWithFallback(),
  };
});

vi.mock("../../server/services/compilation-worker-pool", () => ({
  CompilationWorkerPool: vi.fn(),
  getCompilationPool: () => ({ submit: vi.fn(), shutdown: vi.fn() }),
}));

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() {
      /* no-op */
    }
    debug() {
      /* no-op */
    }
    warn() {
      /* no-op */
    }
    error() {
      /* no-op */
    }
  },
}));

// ── Types ────────────────────────────────────────────────────────────────────

interface WsMessage {
  type: string;
  status?: string;
  gccStatus?: string;
  data?: string;
  timestamp: number;
}

interface ClientResult {
  index: number;
  wsMessages: WsMessage[];
  receivedStopped: boolean;
  timedOut: boolean;
  errors: string[];
}

// ── Test client helper ───────────────────────────────────────────────────────

/**
 * Opens a WebSocket connection, sends start_simulation, then collects ALL
 * messages until simulation_status:stopped or timeout.
 *
 * Returns the full ordered message log so individual tests can assert sequences.
 */
async function runClient(
  port: number,
  index: number,
  code: string,
  timeoutMs = 8_000,
): Promise<ClientResult> {
  return new Promise<ClientResult>((resolve) => {
    const result: ClientResult = {
      index,
      wsMessages: [],
      receivedStopped: false,
      timedOut: false,
      errors: [],
    };

    const overallTimer = setTimeout(() => {
      result.timedOut = true;
      result.errors.push(`timeout after ${timeoutMs}ms`);
      finish();
    }, timeoutMs);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let finished = false;
    let simulationStarted = false;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(overallTimer);
      if (ws.readyState <= WebSocket.OPEN) ws.close();
      resolve(result);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "start_simulation", code }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = parseWorkerMessage(raw);
        result.wsMessages.push({
          type: msg.type,
          status: msg.status,
          gccStatus: msg.gccStatus,
          data: msg.data,
          timestamp: Date.now(),
        });

        if (msg.type === "simulation_status" && msg.status === "running") {
          simulationStarted = true;
        }

        // Ignore the initial "stopped" sent on connection — only close after
        // the simulation has actually started (i.e., we saw a "running" first).
        if (
          msg.type === "simulation_status" &&
          msg.status === "stopped" &&
          simulationStarted
        ) {
          result.receivedStopped = true;
          // Give the serial batcher a moment to flush before closing
          setTimeout(finish, 1);
        }
      } catch {
        /* ignore parse errors */
      }
    });

    ws.on("error", (err) => {
      result.errors.push(`ws error: ${err.message}`);
      finish();
    });

    ws.on("close", finish);
  });
}

/** Extracts simulation_status values in the order they were received. */
function simStatuses(result: ClientResult): string[] {
  return result.wsMessages
    .filter((m) => m.type === "simulation_status")
    .map((m) => m.status ?? "");
}

/** Extracts gccStatus values in the order they were received. */
function gccStatuses(result: ClientResult): string[] {
  return result.wsMessages
    .filter((m) => m.type === "compilation_status" && m.gccStatus !== undefined)
    .map((m) => m.gccStatus ?? "");
}

// ── Shared sketch ────────────────────────────────────────────────────────────

const BLINK_SKETCH = `
void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH); Serial.println("LED ON"); delay(500);
  digitalWrite(13, LOW);  Serial.println("LED OFF"); delay(500);
}`.trim();

// ── Test suite ───────────────────────────────────────────────────────────────

describe("Simulation state sequence", () => {
  let server: ReturnType<typeof import("node:http").createServer> | null = null;
  let port: number;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    // Small pool so we can force queueing in a deterministic way
    process.env.SANDBOX_POOL_MIN_RUNNERS = "3";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "3";
    process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS = "60000";
    process.env.DISABLE_RATE_LIMIT = "true";

    const { _resetPoolSingleton } =
      await import("../../server/services/sandbox-runner-pool");
    _resetPoolSingleton();

    const express = (await import("express")).default;
    const { registerRoutes } = await import("../../server/routes");

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    server = await registerRoutes(app);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const addr = server?.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    const { _resetPoolSingleton } =
      await import("../../server/services/sandbox-runner-pool");
    _resetPoolSingleton();
  }, 10_000);

  beforeEach(() => {
    // Reset to safe defaults before every test
    mockBehavior.runDurationMs = 60;
    mockBehavior.callCompileQueued = false;
    mockBehavior.supportsPause = false;
  });

  // ─── 1: Normal sequence (pool not saturated) ────────────────────────────

  it("single client — receives running → compiling → success → stopped", async () => {
    const result = await runClient(port, 0, BLINK_SKETCH);

    expect(result.errors).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.receivedStopped).toBe(true);

    const simSeq = simStatuses(result);
    const gccSeq = gccStatuses(result);

    // Server sends "running" immediately after acquiring runner (no queue)
    expect(simSeq).not.toContain("queued");
    expect(simSeq).toContain("running");
    expect(simSeq).toContain("stopped");
    expect(simSeq.indexOf("running")).toBeLessThan(
      simSeq.lastIndexOf("stopped"),
    );

    // Compile phase: compiling → success
    expect(gccSeq).toContain("compiling");
    expect(gccSeq).toContain("success");
    expect(gccSeq.indexOf("compiling")).toBeLessThan(gccSeq.indexOf("success"));
  }, 15_000);

  it("rejects a malformed client message before it can start a simulation", async () => {
    const close = await new Promise<{ code: number; reason: string }>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("invalid WebSocket message was not rejected"));
        }, 2_000);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "start_simulation",
              unexpected: true,
            }),
          );
        });
        ws.on("close", (code, reason) => {
          clearTimeout(timeout);
          resolve({ code, reason: reason.toString() });
        });
        ws.on("error", reject);
      },
    );

    expect(close).toEqual({ code: 1008, reason: "Invalid message" });
  });

  it("closes an oversized WebSocket payload at the transport boundary", async () => {
    const close = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("oversized WebSocket payload was not rejected"));
      }, 2_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "serial_input",
            data: "x".repeat(256 * 1024),
          }),
        );
      });
      ws.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      ws.on("error", reject);
    });

    expect(close).toBe(1009);
  });

  // ─── 2: Pool saturated — client is queued_for_simulation ──────────────────

  it("pool saturated — extra client receives queued before running", async () => {
    // Pool has 3 runners. Start 4 clients simultaneously so the 4th must queue.
    mockBehavior.runDurationMs = 75; // long enough that the fourth client is queued

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        runClient(port, i, BLINK_SKETCH, 12_000),
      ),
    );

    // At least one client should have seen queued — the one that had to wait
    const queuedClients = results.filter((r) =>
      simStatuses(r).includes("queued"),
    );
    expect(queuedClients.length).toBeGreaterThanOrEqual(1);

    // ALL clients must eventually complete — no stuck-gray instances
    const stopped = results.filter((r) => r.receivedStopped);
    if (stopped.length < 4) {
      const stuck = results.filter((r) => !r.receivedStopped);
      const detail = stuck
        .map(
          (r) =>
            `#${r.index}: statuses=[${simStatuses(r).join(",")}] errors=[${r.errors.join(";")}]`,
        )
        .join(" | ");
      expect.fail(
        `Only ${stopped.length}/4 clients reached stopped. Stuck: ${detail}`,
      );
    }

    // Queued clients must eventually see running and stopped too
    for (const r of queuedClients) {
      const seq = simStatuses(r);
      expect(seq).toContain("running");
      expect(seq).toContain("stopped");
      expect(seq.indexOf("queued")).toBeLessThan(seq.indexOf("running"));
      expect(seq.indexOf("running")).toBeLessThan(seq.lastIndexOf("stopped"));
    }
  }, 20_000);

  // ─── 3: Queue drain regression — no permanently stuck clients ─────────────
  //
  // This is the direct regression test for the "30 run, 10 stay gray" bug.
  // Pool = 3 runners, 7 clients start simultaneously.
  // The first 3 hold runners for runDurationMs, then release.
  // Clients 4–7 must be picked up and complete — not stuck.

  it("queue drain — all queued clients eventually complete after pool frees up", async () => {
    mockBehavior.runDurationMs = 60;

    const N = 7;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runClient(port, i, BLINK_SKETCH, 15_000),
      ),
    );

    const stopped = results.filter((r) => r.receivedStopped);
    const timedOut = results.filter((r) => r.timedOut);
    const errored = results.filter((r) => !r.timedOut && r.errors.length > 0);

    if (stopped.length < N) {
      const failing = results.filter((r) => !r.receivedStopped);
      const summary = failing
        .map(
          (r) =>
            `#${r.index}: timedOut=${r.timedOut}, ` +
            `statuses=[${simStatuses(r).join(",")}], ` +
            `gcc=[${gccStatuses(r).join(",")}], ` +
            `errors=[${r.errors.join(";")}]`,
        )
        .join("\n  ");
      expect.fail(
        `Only ${stopped.length}/${N} clients reached stopped.\n  ${summary}`,
      );
    }

    expect(timedOut).toHaveLength(0);
    expect(errored).toHaveLength(0);
  }, 20_000);

  // ─── 4: Compile-queue state — gccStatus:queued emitted ────────────────────
  //
  // When the compile semaphore / gatekeeper has no free slots, the client
  // must receive gccStatus:"queued" (→ QUEUED_FOR_COMPILING in the external API).

  it("compile-queue state — gccStatus:queued emitted when compile slot is unavailable", async () => {
    mockBehavior.callCompileQueued = true; // MockRunner calls onCompileQueued

    const result = await runClient(port, 0, BLINK_SKETCH);

    expect(result.receivedStopped).toBe(true);
    expect(result.timedOut).toBe(false);

    const gcc = gccStatuses(result);
    expect(gcc).toContain("queued");

    // After queued, must still complete: compiling (the initial one) and success
    expect(gcc).toContain("compiling");
    expect(gcc).toContain("success");
    // queued must precede success
    expect(gcc.indexOf("queued")).toBeLessThan(gcc.indexOf("success"));
  }, 15_000);

  // ─── 5: Pause / resume state sequence ─────────────────────────────────────

  it("pause/resume — simulation_status transitions to paused then running", async () => {
    mockBehavior.supportsPause = true;
    mockBehavior.runDurationMs = 150; // long enough to pause and resume mid-run

    const clientPromise = new Promise<ClientResult>((resolve) => {
      const result: ClientResult = {
        index: 0,
        wsMessages: [],
        receivedStopped: false,
        timedOut: false,
        errors: [],
      };

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let finished = false;
      let pauseSent = false;
      let resumeSent = false;
      let simulationStarted = false;
      let safetyTimer: ReturnType<typeof setTimeout> | undefined;

      function finishPause() {
        if (finished) return;
        finished = true;
        if (safetyTimer !== undefined) clearTimeout(safetyTimer);
        if (ws.readyState <= WebSocket.OPEN) ws.close();
        resolve(result);
      }

      safetyTimer = setTimeout(() => {
        result.timedOut = true;
        result.errors.push("timeout");
        finishPause();
      }, 10_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({ type: "start_simulation", code: BLINK_SKETCH }),
        );
      });

      ws.on("message", (raw) => {
        const msg = parseWorkerMessage(raw);
        result.wsMessages.push({
          type: msg.type,
          status: msg.status,
          gccStatus: msg.gccStatus,
          data: msg.data,
          timestamp: Date.now(),
        });

        // Send pause shortly after compile success
        if (
          !pauseSent &&
          msg.type === "compilation_status" &&
          msg.gccStatus === "success"
        ) {
          pauseSent = true;
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "pause_simulation" }));
          }, 1);
        }

        // Send resume after receiving paused
        if (
          !resumeSent &&
          msg.type === "simulation_status" &&
          msg.status === "paused"
        ) {
          resumeSent = true;
          setTimeout(() => {
            // prettier-ignore
            ws.send(JSON.stringify({ type: "resume_simulation" }));
          }, 1);
        }

        if (msg.type === "simulation_status" && msg.status === "running") {
          simulationStarted = true;
        }

        // Only close when stopped arrives after the simulation has actually run.
        if (
          msg.type === "simulation_status" &&
          msg.status === "stopped" &&
          simulationStarted
        ) {
          result.receivedStopped = true;
          setTimeout(finishPause, 1);
        }
      });

      ws.on("error", (err) => {
        result.errors.push(`ws: ${err.message}`);
        finishPause();
      });
      ws.on("close", finishPause);
    });

    const result = await clientPromise;

    expect(result.errors).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.receivedStopped).toBe(true);

    const seq = simStatuses(result);
    expect(seq).toContain("paused");
    expect(seq).toContain("running");
    expect(seq).toContain("stopped");

    // Must have: running → paused → running → stopped
    const firstRunning = seq.indexOf("running");
    const pausedIdx = seq.indexOf("paused");
    const lastRunning = seq.lastIndexOf("running");
    const stoppedIdx = seq.lastIndexOf("stopped");

    expect(firstRunning).toBeGreaterThanOrEqual(0);
    expect(pausedIdx).toBeGreaterThan(firstRunning);
    expect(lastRunning).toBeGreaterThan(pausedIdx);
    expect(stoppedIdx).toBeGreaterThan(lastRunning);
  }, 20_000);

  // ─── 6: Stop simulation aborts a running instance ─────────────────────────

  it("stop simulation — simulation_status:stopped emitted after stop command", async () => {
    mockBehavior.runDurationMs = 100; // long enough to issue stop after compile
    let stopSent = false;

    const clientPromise = new Promise<ClientResult>((resolve) => {
      const result: ClientResult = {
        index: 0,
        wsMessages: [],
        receivedStopped: false,
        timedOut: false,
        errors: [],
      };
      const timer = setTimeout(() => {
        result.timedOut = true;
        finishStop();
      }, 8_000);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let finished = false;
      let simStarted = false;

      function finishStop() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (ws.readyState <= WebSocket.OPEN) ws.close();
        resolve(result);
      }

      ws.on("open", () => {
        ws.send(
          JSON.stringify({ type: "start_simulation", code: BLINK_SKETCH }),
        );
      });

      ws.on("message", (raw) => {
        const msg = parseWorkerMessage(raw);
        result.wsMessages.push({
          type: msg.type,
          status: msg.status,
          gccStatus: msg.gccStatus,
          data: msg.data,
          timestamp: Date.now(),
        });

        if (msg.type === "simulation_status" && msg.status === "running") {
          simStarted = true;
        }

        // Send stop after compile succeeds
        if (
          !stopSent &&
          msg.type === "compilation_status" &&
          msg.gccStatus === "success"
        ) {
          stopSent = true;
          setTimeout(
            () => ws.send(JSON.stringify({ type: "stop_simulation" })),
            1,
          );
        }

        // Only close after the simulation has run (ignore initial stopped-on-connect).
        if (
          msg.type === "simulation_status" &&
          msg.status === "stopped" &&
          simStarted
        ) {
          result.receivedStopped = true;
          setTimeout(finishStop, 1);
        }
      });

      ws.on("error", (err) => {
        result.errors.push(`ws: ${err.message}`);
        finishStop();
      });
      ws.on("close", finishStop);
    });

    const result = await clientPromise;

    expect(result.errors).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.receivedStopped).toBe(true);

    const seq = simStatuses(result);
    expect(seq).toContain("running");
    expect(seq).toContain("stopped");
    expect(seq.indexOf("running")).toBeLessThan(seq.lastIndexOf("stopped"));
  }, 15_000);

  // ─── 7: Large concurrent burst — pool-sized batch + overflow all complete ──
  //
  // 12 clients with pool of 3 runners: verifies the queue handles large bursts
  // without any client being silently dropped.

  it("large burst (12 clients, pool=3) — all 12 complete, none stuck", async () => {
    mockBehavior.runDurationMs = 60;

    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runClient(port, i, BLINK_SKETCH, 30_000),
      ),
    );

    const stopped = results.filter((r) => r.receivedStopped);

    if (stopped.length < N) {
      const failing = results.filter((r) => !r.receivedStopped);
      const summary = failing
        .map(
          (r) =>
            `#${r.index}: timedOut=${r.timedOut}, ` +
            `statuses=[${simStatuses(r).join(",")}], ` +
            `errors=[${r.errors.join(";")}]`,
        )
        .join("\n  ");
      expect.fail(`Only ${stopped.length}/${N} completed.\n  ${summary}`);
    }

    // Every client must have received a valid compile sequence
    for (const r of results) {
      const gcc = gccStatuses(r);
      expect(gcc).toContain("compiling");
      expect(gcc).toContain("success");
    }
  }, 40_000);
});

// ── Unit tests: external API state consistency ───────────────────────────────
//
// Verifies that the state returned by GET_SIMULATION_STATE (deriveClientState in
// useArduinoSimulatorPage) stays consistent with the states emitted via
// SIMULATION_STATE_EVENT (emitSimulationStateEvent in useWebSocketHandler).
//
// Mapping table tested here:
//   simulationStatus | compilationStatus → deriveClientState() → emitted event
//   queued           | *                 → QUEUED_FOR_SIMULATION
//   running          | *                 → RUNNING
//   paused           | *                 → PAUSED
//   idle             | compiling         → COMPILING
//   idle             | error             → ERROR          (only in sim-cockpit, NOT in API — bug!)
//   idle             | *                 → IDLE

/**
 * Mirror of deriveClientState in useArduinoSimulatorPage.tsx.
 * If that function changes, update both places and this test.
 */
function deriveApiState(
  simulationStatus: string,
  compilationStatus: string,
): string {
  if (simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
  if (simulationStatus === "running") return "RUNNING";
  if (simulationStatus === "paused") return "PAUSED";
  if (compilationStatus === "compiling") return "COMPILING";
  return "IDLE";
}

describe("External API state consistency (unit)", () => {
  /**
   * States that useWebSocketHandler emits via emitSimulationStateEvent.
   * Cross-reference with useWebSocketHandler.ts handleSimulationStatus +
   * handleCompilationStatus.
   */
  const wsEventToApiState: Record<string, string> = {
    // simulation_status messages
    "sim:queued": "QUEUED_FOR_SIMULATION",
    "sim:running": "RUNNING",
    "sim:paused": "PAUSED",
    "sim:stopped": "IDLE",
    // compilation_status gccStatus messages
    "gcc:queued": "QUEUED_FOR_COMPILING",
    "gcc:compiling": "COMPILING",
    "gcc:success": "RUNNING", // re-emits RUNNING after compile phase ends
  };

  it("QUEUED_FOR_SIMULATION: simulation_status=queued → API returns QUEUED_FOR_SIMULATION", () => {
    expect(deriveApiState("queued", "ready")).toBe("QUEUED_FOR_SIMULATION");
  });

  it("RUNNING: simulation_status=running → API returns RUNNING", () => {
    expect(deriveApiState("running", "success")).toBe("RUNNING");
  });

  it("PAUSED: simulation_status=paused → API returns PAUSED", () => {
    expect(deriveApiState("paused", "success")).toBe("PAUSED");
  });

  it("COMPILING: simulation_status=idle + compilationStatus=compiling → API returns COMPILING", () => {
    expect(deriveApiState("idle", "compiling")).toBe("COMPILING");
  });

  it("IDLE: simulation_status=idle + compilationStatus=ready → API returns IDLE", () => {
    expect(deriveApiState("idle", "ready")).toBe("IDLE");
  });

  it("all wsEventToApiState values are valid ClientState values", () => {
    const validClientStates = new Set([
      "IDLE",
      "QUEUED_FOR_COMPILING",
      "COMPILING",
      "QUEUED_FOR_SIMULATION",
      "RUNNING",
      "PAUSED",
      "ERROR",
    ]);
    for (const [event, state] of Object.entries(wsEventToApiState)) {
      expect(
        validClientStates.has(state),
        `Event ${event} maps to unknown state: ${state}`,
      ).toBe(true);
    }
  });

  it("sim:running event maps to same state as deriveApiState(running, *)", () => {
    // The SIMULATION_STATE_EVENT RUNNING must match what GET_SIMULATION_STATE returns
    expect(wsEventToApiState["sim:running"]).toBe(
      deriveApiState("running", "success"),
    );
  });

  it("sim:paused event maps to same state as deriveApiState(paused, *)", () => {
    expect(wsEventToApiState["sim:paused"]).toBe(
      deriveApiState("paused", "success"),
    );
  });

  it("sim:stopped event maps to same state as deriveApiState(idle, ready)", () => {
    expect(wsEventToApiState["sim:stopped"]).toBe(
      deriveApiState("idle", "ready"),
    );
  });

  it("gcc:compiling event maps to same state as deriveApiState(idle, compiling)", () => {
    expect(wsEventToApiState["gcc:compiling"]).toBe(
      deriveApiState("idle", "compiling"),
    );
  });

  it("gcc:success re-emits RUNNING — consistent with running state after compile phase", () => {
    // After gccStatus:success the simulation is executing its loop()
    // → RUNNING is the correct external API state
    expect(wsEventToApiState["gcc:success"]).toBe("RUNNING");
    expect(wsEventToApiState["gcc:success"]).toBe(
      deriveApiState("running", "success"),
    );
  });

  it("ERROR state: API does not expose ERROR (known gap — only shown in UI label)", () => {
    // deriveClientState in useArduinoSimulatorPage lacks compilationStatus=error → ERROR
    // It returns IDLE, while sim-cockpit.tsx returns ERROR for the same state.
    // This is a known inconsistency: the external API hides compile errors.
    // If this test starts failing it means the bug was fixed — update this test.
    expect(deriveApiState("idle", "error")).toBe("IDLE");
  });
});
