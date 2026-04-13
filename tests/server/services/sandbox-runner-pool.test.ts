/**
 * Tests for SandboxRunnerPool
 *
 * Covers: initialization, acquire, release, queue, stats, shutdown,
 * edge cases (double-release, unknown runner release), reset logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock SandboxRunner  
vi.mock("../../../server/services/sandbox-runner", () => {
  class MockSandboxRunner {
    isRunning = false;
    stop = vi.fn().mockResolvedValue(undefined);
    // The real SandboxRunner uses a getter/setter that delegates to executionState.state
    _state = "stopped";
    get state() { return this._state; }
    set state(v: string) { this._state = v; this.executionState.state = v; }
    executionState = {
      state: "stopped" as string,
      pauseStartTime: null as number | null,
      totalPausedTime: 0,
      processKilled: false,
      pendingCleanup: false,
      pinStateBatcher: null as unknown,
      serialOutputBatcher: null as unknown,
      onOutputCallback: null as unknown,
      errorCallback: null as unknown,
      telemetryCallback: null as unknown,
      pinStateCallback: null as unknown,
      ioRegistryCallback: undefined as unknown,
      outputBuffer: "",
      outputBufferIndex: 0,
      totalOutputBytes: 0,
      isSendingOutput: false,
      messageQueue: [] as unknown[],
      stderrFallbackBuffer: "",
      backpressurePaused: false,
      flushTimer: null as NodeJS.Timeout | null,
    };
    processController = null;
    registryManager = null;
    fileBuilder = null;
    timeoutManager = null;
    flushMessageQueue = vi.fn();
  }
  return {
    SandboxRunner: MockSandboxRunner,
  };
  /* original mock kept for reference:
  return {
    SandboxRunner: vi.fn().mockImplementation(() => ({
      isRunning: false,
      stop: vi.fn().mockResolvedValue(undefined),
      // Properties accessed during resetRunnerState
      state: "stopped",
      processKilled: false,
      executionState: { pauseStartTime: null },
      totalPausedTime: 0,
      lastPauseTimestamp: null,
      pinStateBatcher: null,
      serialOutputBatcher: null,
      onOutputCallback: null,
      outputCallback: null,
      errorCallback: null,
      telemetryCallback: null,
      pinStateCallback: null,
      ioRegistryCallback: null,
      outputBuffer: "",
      errorBuffer: "",
      totalOutputBytes: 0,
      isSendingOutput: false,
      pendingCleanup: false,
      cleanupRetries: new Map(),
      messageQueue: [],
      flushTimer: null,
      processController: null,
      registryManager: null,
      fileBuilder: null,
      timeoutManager: null,
      flushMessageQueue: vi.fn(),
    })),
  }; */
});

// Mock RegistryManager
vi.mock("../../../server/services/registry-manager", () => ({
  RegistryManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    reset: vi.fn(),
  })),
}));

// Suppress logger output
vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

let getSandboxRunnerPool: () => any;
let initializeSandboxRunnerPool: () => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../../server/services/sandbox-runner-pool");
  getSandboxRunnerPool = mod.getSandboxRunnerPool;
  initializeSandboxRunnerPool = mod.initializeSandboxRunnerPool;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SandboxRunnerPool", () => {
  it("getSandboxRunnerPool returns same instance", () => {
    const a = getSandboxRunnerPool();
    const b = getSandboxRunnerPool();
    expect(a).toBe(b);
  });

  it("acquireRunner throws if not initialized", async () => {
    const pool = getSandboxRunnerPool();
    await expect(pool.acquireRunner()).rejects.toThrow("not initialized");
  });

  it("initializes pool with runners", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();
    const stats = pool.getStats();
    expect(stats.totalRunners).toBe(5);
    expect(stats.availableRunners).toBe(5);
    expect(stats.inUseRunners).toBe(0);
    expect(stats.initialized).toBe(true);
  });

  it("initialize is idempotent", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();
    await pool.initialize(); // second call should be no-op
    expect(pool.getStats().totalRunners).toBe(5);
  });

  it("initializeSandboxRunnerPool convenience function", async () => {
    await initializeSandboxRunnerPool();
    const pool = getSandboxRunnerPool();
    expect(pool.getStats().initialized).toBe(true);
  });

  it("acquires and releases a runner", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    expect(runner).toBeDefined();
    expect(pool.getStats().availableRunners).toBe(4);
    expect(pool.getStats().inUseRunners).toBe(1);

    await pool.releaseRunner(runner);
    expect(pool.getStats().availableRunners).toBe(5);
    expect(pool.getStats().inUseRunners).toBe(0);
  });

  it("queues requests when all runners are in use", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    // Acquire all 5 runners
    const runners = [];
    for (let i = 0; i < 5; i++) {
      runners.push(await pool.acquireRunner());
    }

    expect(pool.getStats().availableRunners).toBe(0);
    expect(pool.getStats().queuedRequests).toBe(0);

    // 6th acquire should queue
    const pendingAcquire = pool.acquireRunner();
    expect(pool.getStats().queuedRequests).toBe(1);

    // Release one → queued request should be fulfilled
    await pool.releaseRunner(runners[0]);

    const queuedRunner = await pendingAcquire;
    expect(queuedRunner).toBeDefined();
    expect(pool.getStats().queuedRequests).toBe(0);
  });

  it("handles release of unknown runner", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const fakeRunner = {} as any;
    // Should not throw, just warn
    await expect(pool.releaseRunner(fakeRunner)).resolves.toBeUndefined();
  });

  it("handles release of already-released runner", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    await pool.releaseRunner(runner);
    // Double release
    await expect(pool.releaseRunner(runner)).resolves.toBeUndefined();
    expect(pool.getStats().availableRunners).toBe(5);
  });

  it("acquire timeout rejects if no runner available", async () => {
    vi.useFakeTimers();
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    // Acquire all runners
    for (let i = 0; i < 5; i++) {
      await pool.acquireRunner();
    }

    const pendingAcquire = pool.acquireRunner();

    // Advance past timeout (60s)
    vi.advanceTimersByTime(61000);

    await expect(pendingAcquire).rejects.toThrow("acquire timeout");

    vi.useRealTimers();
  });

  it("getStats returns correct snapshot", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner1 = await pool.acquireRunner();
    await pool.acquireRunner();

    const stats = pool.getStats();
    expect(stats.totalRunners).toBe(5);
    expect(stats.availableRunners).toBe(3);
    expect(stats.inUseRunners).toBe(2);
    expect(stats.queuedRequests).toBe(0);

    await pool.releaseRunner(runner1);
    expect(pool.getStats().inUseRunners).toBe(1);
  });

  it("shutdown stops all runners and rejects queued requests", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    // Acquire all and queue one
    const runners = [];
    for (let i = 0; i < 5; i++) {
      runners.push(await pool.acquireRunner());
    }

    // Make one runner appear as running
    runners[0].isRunning = true;

    const pendingAcquire = pool.acquireRunner();

    await pool.shutdown();

    // Queued request should be rejected
    await expect(pendingAcquire).rejects.toThrow("shutting down");
    // Running runner should have stop() called
    expect(runners[0].stop).toHaveBeenCalled();
  });

  it("resets runner state on release", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    
    // Simulate runner had been used — set executionState fields
    runner.executionState.outputBuffer = "some output";
    runner.executionState.totalOutputBytes = 1000;
    runner.executionState.processKilled = true;
    runner.executionState.pendingCleanup = true;

    await pool.releaseRunner(runner);

    // After release, executionState fields should be cleaned
    expect(runner.state).toBe("stopped");
    expect(runner.executionState.outputBuffer).toBe("");
    expect(runner.executionState.totalOutputBytes).toBe(0);
    expect(runner.executionState.processKilled).toBe(false);
    expect(runner.executionState.pendingCleanup).toBe(false);
  });

  it("resets executionState.processKilled on release (regression: pool used ad-hoc property)", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();

    // Simulate a simulation that was stopped (processKilled = true)
    runner.executionState.processKilled = true;
    runner.executionState.pendingCleanup = true;
    runner.executionState.isSendingOutput = true;
    runner.executionState.totalOutputBytes = 5000;
    runner.executionState.messageQueue = [{ type: "stale" }];

    await pool.releaseRunner(runner);

    // Critical: processKilled must be reset on executionState, not as ad-hoc property
    expect(runner.executionState.processKilled).toBe(false);
    expect(runner.executionState.pendingCleanup).toBe(false);
    expect(runner.executionState.isSendingOutput).toBe(false);
    expect(runner.executionState.totalOutputBytes).toBe(0);
    expect(runner.executionState.messageQueue).toEqual([]);
  });

  it("handles runner with running state during release", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    runner.isRunning = true;

    await pool.releaseRunner(runner);
    expect(runner.stop).toHaveBeenCalled();
  });

  it("handles error during runner reset gracefully", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    // Make stop throw
    runner.stop = vi.fn().mockRejectedValue(new Error("stop failed"));
    runner.isRunning = true;

    // Should not throw
    await expect(pool.releaseRunner(runner)).resolves.toBeUndefined();
  });

  it("calls registryManager.reset() during runner release", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    const mockRegistryManager = { destroy: vi.fn(), reset: vi.fn(), removeAllListeners: vi.fn() };
    runner.registryManager = mockRegistryManager;

    await pool.releaseRunner(runner);

    expect(mockRegistryManager.reset).toHaveBeenCalledOnce();
  });

  it("handles registryManager.reset() failure gracefully during release", async () => {
    const pool = getSandboxRunnerPool();
    await pool.initialize();

    const runner = await pool.acquireRunner();
    const mockRegistryManager = {
      destroy: vi.fn(),
      reset: vi.fn().mockImplementation(() => { throw new Error("reset failed"); }),
      removeAllListeners: vi.fn(),
    };
    runner.registryManager = mockRegistryManager;

    // Should not throw even when reset() fails
    await expect(pool.releaseRunner(runner)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 1.1 – Env-var configuration & on-demand runner creation
// ---------------------------------------------------------------------------
describe("SandboxRunnerPool – env-var configuration", () => {
  afterEach(() => {
    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    delete process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS;
  });

  it("uses SANDBOX_POOL_MIN_RUNNERS env var for initial pool size", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "3";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();
    const stats = pool.getStats();
    expect(stats.totalRunners).toBe(3);
    await pool.shutdown();
  });

  it("uses SANDBOX_POOL_MAX_RUNNERS env var to cap on-demand creation", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "1";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "3";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // Acquire min+1 (on-demand) and max concurrently
    const r1 = await pool.acquireRunner();
    const r2 = await pool.acquireRunner();
    const r3 = await pool.acquireRunner();
    expect(pool.getStats().totalRunners).toBe(3);
    expect(pool.getStats().inUseRunners).toBe(3);

    // 4th acquire must queue (maxRunners=3 reached)
    let resolved = false;
    const pending = pool.acquireRunner().then((r) => { resolved = true; return r; });
    // Must not resolve yet
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(pool.getStats().queuedRequests).toBe(1);

    // Release one → queued resolves
    await pool.releaseRunner(r1);
    const r4 = await pending;
    expect(r4).toBeDefined();
    expect(resolved).toBe(true);

    await pool.releaseRunner(r2);
    await pool.releaseRunner(r3);
    await pool.releaseRunner(r4);
    await pool.shutdown();
  });

  it("creates runners on-demand beyond minRunners when needed", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "1";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    expect(pool.getStats().totalRunners).toBe(1);

    // Acquiring a 2nd runner should create it on-demand
    const r1 = await pool.acquireRunner();
    const r2 = await pool.acquireRunner(); // on-demand
    expect(pool.getStats().totalRunners).toBe(2);
    expect(pool.getStats().inUseRunners).toBe(2);

    await pool.releaseRunner(r1);
    await pool.releaseRunner(r2);
    await pool.shutdown();
  });

  it("getStats exposes maxRunners and minRunners", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "2";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "50";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();
    const stats = pool.getStats();
    expect(stats.maxRunners).toBe(50);
    expect(stats.minRunners).toBe(2);
    await pool.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase 2.3 – Idle runner cleanup after timeout
// ---------------------------------------------------------------------------
describe("SandboxRunnerPool – idle runner cleanup", () => {
  afterEach(() => {
    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    delete process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS;
    vi.useRealTimers();
  });

  it("destroys on-demand runners after idle timeout when above minRunners", async () => {
    vi.useFakeTimers();
    process.env.SANDBOX_POOL_MIN_RUNNERS = "1";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "5";
    process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS = "5000";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // Create an on-demand runner by acquiring 2 (minRunners=1)
    const r1 = await pool.acquireRunner();
    const r2 = await pool.acquireRunner(); // on-demand
    expect(pool.getStats().totalRunners).toBe(2);

    // Release both – r2 is above minRunners, should be scheduled for idle removal
    await pool.releaseRunner(r1);
    await pool.releaseRunner(r2);
    expect(pool.getStats().totalRunners).toBe(2); // still 2 immediately after release

    // Advance past idle timeout – r2 (the on-demand one above min) should be removed
    vi.advanceTimersByTime(6000);
    expect(pool.getStats().totalRunners).toBe(1); // back to minRunners

    await pool.shutdown();
  });

  it("does NOT destroy warm runners (minRunners floor) even after idle timeout", async () => {
    vi.useFakeTimers();
    process.env.SANDBOX_POOL_MIN_RUNNERS = "2";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "5";
    process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS = "5000";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // Acquire and release both warm runners
    const r1 = await pool.acquireRunner();
    const r2 = await pool.acquireRunner();
    await pool.releaseRunner(r1);
    await pool.releaseRunner(r2);

    vi.advanceTimersByTime(10000);
    // Should remain at minRunners (2)
    expect(pool.getStats().totalRunners).toBe(2);

    await pool.shutdown();
  });

  it("cancels idle timer if runner is re-acquired before timeout", async () => {
    vi.useFakeTimers();
    process.env.SANDBOX_POOL_MIN_RUNNERS = "1";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "5";
    process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS = "5000";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // Acquire warm runner (index 0) to force on-demand creation
    const warm = await pool.acquireRunner(); // warm in-use
    const onDemand = await pool.acquireRunner(); // on-demand created

    // Release on-demand while warm is still in use → idle timer starts
    await pool.releaseRunner(onDemand);
    expect(pool.getStats().totalRunners).toBe(2);

    // Advance halfway through timeout
    vi.advanceTimersByTime(2500);
    expect(pool.getStats().totalRunners).toBe(2);

    // Re-acquire – only onDemand is available → timer must be cancelled
    const r3 = await pool.acquireRunner();
    expect(pool.getStats().inUseRunners).toBe(2); // warm + onDemand in-use

    // Advance past original timer deadline – timer was cancelled, so no removal
    vi.advanceTimersByTime(5000);
    expect(pool.getStats().totalRunners).toBe(2); // still 2

    // Release both; on-demand is now free again – new idle timer starts
    await pool.releaseRunner(warm);
    await pool.releaseRunner(r3);

    // Advance full idle period from last release
    vi.advanceTimersByTime(6000);
    // warm (index 0) is below minRunners floor, not removed
    // onDemand (index 1) is above floor and idle → removed
    expect(pool.getStats().totalRunners).toBe(1);

    await pool.shutdown();
  });
});
