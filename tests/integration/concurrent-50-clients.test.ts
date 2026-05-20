/**
 * 50 Concurrent Client Integration Test
 *
 * Verifies that 50 simultaneous clients can each:
 *   1. POST /api/compile   → receive a success response
 *   2. WS start_simulation → receive compilation_status + serial_output
 *
 * Uses a real Express server with the full route stack but mocked
 * SandboxRunner (no Docker) so the test runs fast in CI.
 *
 * Exposes the per-client isolation bug: `lastCompiledCode` is a global
 * singleton so all clients share the same compiled code.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import WebSocket from "ws";

interface MockExecutionState {
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
}

function parseWebSocketMessage(raw: WebSocket.RawData): Record<string, unknown> {
  const text =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
      ? Buffer.from(raw).toString("utf8")
      : raw instanceof ArrayBuffer
      ? Buffer.from(raw).toString("utf8")
      : Array.isArray(raw) && raw.every((item): item is Buffer => Buffer.isBuffer(item))
      ? Buffer.concat(raw).toString("utf8")
      : (() => { throw new Error("Unsupported WebSocket message data type"); })();

  return JSON.parse(text);
}

// ── Heavy mocks (must be hoisted before any server import) ──────────────

class MockSandboxRunner {
  isRunning = false;
  _state = "stopped";
  get state() { return this._state; }
  set state(v: string) { this._state = v; this.executionState.state = v; }
  executionState: MockExecutionState = {
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
  /** The code that was last passed to runSketch */
  lastSketchCode: string | null = null;
  flushMessageQueue = vi.fn();
  _sketchDir: string | null = null;

  async runSketch(options: Record<string, unknown>): Promise<void> {
    this.isRunning = true;
    this._state = "running";
    this.lastSketchCode = typeof options.code === "string" ? options.code : null;

    const onCompileSuccess = typeof options.onCompileSuccess === "function" ? options.onCompileSuccess as () => void : undefined;
    const onOutput = typeof options.onOutput === "function" ? options.onOutput as (line: string, isComplete?: boolean) => void : undefined;
    const onExit = typeof options.onExit === "function" ? options.onExit as (code: number | null) => void : undefined;

    // Extract a marker from the code for per-client verification.
    // If the code contains CLIENT_<N>, echo that marker so the test can check isolation.
    const markerMatch = /CLIENT_(\d+)/.exec(this.lastSketchCode ?? "");
    const marker = markerMatch ? `CLIENT_${markerMatch[1]}` : "LED ON";

    // Simulate a short compile + output cycle — the gap between output
    // and exit must be large enough for the 50ms serial batcher to flush.
    const delay = 20 + (this.lastSketchCode?.length ?? 0) % 20; // deterministic per-code jitter
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this._state !== "running") { resolve(); return; }
        onCompileSuccess?.();
        onOutput?.(marker, true);
        onOutput?.("LED OFF", true);
        // Wait 120ms so the batch timer (50ms) fires before onExit
        setTimeout(() => {
          this.isRunning = false;
          this._state = "stopped";
          onExit?.(0);
          resolve();
        }, 120);
      }, delay);
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this._state = "stopped";
  }

  pause(): boolean { return false; }
  resume(): boolean { return false; }
  getSandboxStatus() {
    return { dockerAvailable: false, dockerImageBuilt: false, mode: "local-limited" as const };
  }
  getSketchDir() { return this._sketchDir; }
  setRegistryFile() { /* no-op */ }
  setPinValue() { /* no-op */ }
}

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
    async compile(code: string) {
      return { success: true, firmware: "deadbeef", errors: [], parsed: [] };
    }
    async shutdown() { /* no-op */ }
  }
  return {
    CompilerWithFallback: MockCompilerWithFallback,
    getCompilerWithFallback: () => new MockCompilerWithFallback(),
  };
});

vi.mock("../../server/services/compilation-worker-pool", () => ({
  CompilationWorkerPool: vi.fn(),
  getCompilationPool: () => ({
    submit: vi.fn(),
    shutdown: vi.fn(),
  }),
}));

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

// ── Test helpers ────────────────────────────────────────────────────────

interface ClientResult {
  index: number;
  compiled: boolean;
  compileError?: string;
  wsConnected: boolean;
  receivedCompilationStatus: boolean;
  receivedSerialOutput: boolean;
  serialData: string;
  receivedSimulationStopped: boolean;
  codeUsedByRunner: string | null;
  errors: string[];
}

async function createWsClient(
  port: number,
  index: number,
  code: string,
): Promise<ClientResult> {
  const result: ClientResult = {
    index,
    compiled: false,
    wsConnected: false,
    receivedCompilationStatus: false,
    receivedSerialOutput: false,
    serialData: "",
    receivedSimulationStopped: false,
    codeUsedByRunner: null,
    errors: [],
  };

  // Step 1: compile via REST
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json() as Record<string, unknown>;
    result.compiled = json.success === true;
    if (!result.compiled) {
      result.compileError = JSON.stringify(json.error ?? json.errors ?? "unknown");
      return result;
    }
  } catch (err) {
    result.errors.push(`compile fetch error: ${err instanceof Error ? err.message : "unknown"}`);
    return result;
  }

  // Step 2: open WebSocket + start simulation
  return new Promise<ClientResult>((resolve) => {
    const overallTimeout = setTimeout(() => {
      result.errors.push("overall timeout (15 s)");
      done();
    }, 15_000);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let resolved = false;

    function done() {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimeout);
      if (ws.readyState <= WebSocket.OPEN) ws.close();
      resolve(result);
    }

    ws.on("open", () => {
      result.wsConnected = true;
      ws.send(JSON.stringify({ type: "start_simulation", code }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = parseWebSocketMessage(raw);

        if (msg.type === "compilation_status" && msg.gccStatus === "success") {
          result.receivedCompilationStatus = true;
        }

        if (msg.type === "serial_output" && typeof msg.data === "string") {
          result.receivedSerialOutput = true;
          result.serialData += msg.data;
        }

        if (msg.type === "simulation_status" && msg.status === "stopped") {
          result.receivedSimulationStopped = true;
          // Allow time for serial batches to flush (50ms batcher + network delay)
          setTimeout(done, 500);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on("error", (err) => {
      result.errors.push(`ws error: ${err.message}`);
      done();
    });

    ws.on("close", done);
  });
}

// ── Test suite ──────────────────────────────────────────────────────────

describe("50 concurrent clients — compile + simulate + output", () => {
  let server: ReturnType<typeof import("node:http").createServer> | null = null;
  let port: number;

  beforeAll(async () => {
    // Configure pool for 50 concurrent runners
    process.env.NODE_ENV = "test";
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "55";
    process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS = "60000";
    process.env.DISABLE_RATE_LIMIT = "true";

    // Reset the pool singleton so our env vars take effect even if
    // a previously-run test file already initialized the pool.
    const { _resetPoolSingleton } = await import("../../server/services/sandbox-runner-pool");
    _resetPoolSingleton();

    // Dynamically import after mocks are in place
    const express = (await import("express")).default;
    const { registerRoutes } = await import("../../server/routes");

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    server = await registerRoutes(app);

    // Listen on random port
    await new Promise<void>((resolve) => {
      const httpServer = server;
      if (!httpServer) throw new Error("server not created");
      httpServer.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    if (server) {
      const s = server;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    // Reset pool so subsequent test files get a fresh singleton
    const { _resetPoolSingleton } = await import("../../server/services/sandbox-runner-pool");
    _resetPoolSingleton();
  }, 10_000);

  // ─── Core test: 50 clients with SAME code ─────────────────────────────

  it("all 50 clients compile, start, and receive serial output", async () => {
    const SKETCH = `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); Serial.println("LED ON"); delay(500); digitalWrite(13, LOW); Serial.println("LED OFF"); delay(500); }`;

    const N = 50;

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => createWsClient(port, i, SKETCH)),
    );

    // Collect stats
    const compiled = results.filter((r) => r.compiled);
    const connected = results.filter((r) => r.wsConnected);
    const gotOutput = results.filter((r) => r.receivedSerialOutput);
    const gotStopped = results.filter((r) => r.receivedSimulationStopped);
    const errored = results.filter((r) => r.errors.length > 0);

    // All must compile
    expect(compiled.length).toBe(N);

    // All must connect via WS
    expect(connected.length).toBe(N);

    // All must receive serial output (the key user-visible requirement)
    if (gotOutput.length < N) {
      const missing = results.filter((r) => !r.receivedSerialOutput);
      const summary = missing.slice(0, 5).map((r) => `#${r.index}: errors=[${r.errors.join("; ")}]`);
      expect.fail(
        `Only ${gotOutput.length}/${N} clients received serial output. ` +
        `Missing examples: ${summary.join(" | ")}`,
      );
    }

    // All must see simulation end
    expect(gotStopped.length).toBe(N);

    // No errors
    expect(errored.length).toBe(0);
  }, 30_000);

  // ─── Per-client isolation: different code per client ───────────────────

  it("each client receives output from its OWN code (not another client's code)", async () => {
    const N = 10; // smaller N to keep runtime manageable

    const sketches = Array.from({ length: N }, (_, i) => ({
      index: i,
      code: `void setup() { Serial.begin(9600); } void loop() { Serial.println("CLIENT_${i}"); delay(100); }`,
      expectedMarker: `CLIENT_${i}`,
    }));

    const results = await Promise.all(
      sketches.map((s) => createWsClient(port, s.index, s.code)),
    );

    // All should compile and receive output
    const gotOutput = results.filter((r) => r.compiled && r.receivedSerialOutput);
    expect(gotOutput.length).toBe(N);

    // Each client MUST see its own marker in the serial output.
    // This fails if the server uses a global shared lastCompiledCode
    // because the runner would receive whichever code was compiled last.
    for (const r of results) {
      const expected = sketches[r.index].expectedMarker;
      expect(r.serialData).toContain(expected);
    }
  }, 30_000);
});
