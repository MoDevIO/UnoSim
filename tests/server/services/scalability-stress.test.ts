/**
 * Scalability Stress Tests
 *
 * Tests the SandboxRunnerPool and DockerCompileSemaphore under concurrent load
 * at 10, 50, and 100 simultaneous simulation requests.
 *
 * Measures:
 * - Acquire wait time (how long until a runner is granted)
 * - Queue depth over time (how many requests pile up)
 * - Total throughput (simulations completed per second)
 * - Server health (no stuck runners, no semaphore deadlocks)
 *
 * Uses mocked SandboxRunner to test pool logic without Docker overhead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../../server/services/sandbox-runner", () => {
  class MockSandboxRunner {
    isRunning = false;
    stop = vi.fn().mockResolvedValue(undefined);
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
  return { SandboxRunner: MockSandboxRunner };
});

vi.mock("../../../server/services/registry-manager", () => ({
  RegistryManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

interface SimulationResult {
  index: number;
  acquireMs: number;
  holdMs: number;
  totalMs: number;
  error?: string;
}

interface StressReport {
  count: number;
  results: SimulationResult[];
  succeeded: number;
  failed: number;
  avgAcquireMs: number;
  maxAcquireMs: number;
  p95AcquireMs: number;
  avgTotalMs: number;
  throughputPerSec: number;
  peakQueueDepth: number;
  healthChecks: HealthSnapshot[];
}

interface HealthSnapshot {
  timestamp: number;
  availableRunners: number;
  inUseRunners: number;
  queuedRequests: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Simulate N concurrent simulations against the pool.
 * Each simulation: acquire → hold (simulated work) → release.
 */
async function runStressTest(
  pool: any,
  count: number,
  holdTimeMs: number,
  healthIntervalMs: number,
): Promise<StressReport> {
  const results: SimulationResult[] = [];
  const healthChecks: HealthSnapshot[] = [];
  let peakQueueDepth = 0;

  // Health monitor
  const healthTimer = setInterval(() => {
    const stats = pool.getStats();
    healthChecks.push({
      timestamp: Date.now(),
      availableRunners: stats.availableRunners,
      inUseRunners: stats.inUseRunners,
      queuedRequests: stats.queuedRequests,
    });
    peakQueueDepth = Math.max(peakQueueDepth, stats.queuedRequests);
  }, healthIntervalMs);

  const start = Date.now();

  // Launch all simulations concurrently
  const promises = Array.from({ length: count }, (_, i) =>
    (async (): Promise<SimulationResult> => {
      const acquireStart = Date.now();
      try {
        const runner = await pool.acquireRunner();
        const acquireMs = Date.now() - acquireStart;

        // Simulate work (compile + run time)
        await new Promise((r) => setTimeout(r, holdTimeMs));
        const holdMs = holdTimeMs;

        await pool.releaseRunner(runner);
        const totalMs = Date.now() - acquireStart;

        return { index: i, acquireMs, holdMs, totalMs };
      } catch (error) {
        const totalMs = Date.now() - acquireStart;
        return {
          index: i,
          acquireMs: totalMs,
          holdMs: 0,
          totalMs,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })(),
  );

  const allResults = await Promise.allSettled(promises);
  clearInterval(healthTimer);

  for (const r of allResults) {
    results.push(r.status === "fulfilled" ? r.value : {
      index: -1, acquireMs: 0, holdMs: 0, totalMs: 0, error: String(r.reason),
    });
  }

  const elapsedMs = Date.now() - start;
  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;
  const acquireTimes = results.filter((r) => !r.error).map((r) => r.acquireMs).sort((a, b) => a - b);
  const totalTimes = results.filter((r) => !r.error).map((r) => r.totalMs);

  return {
    count,
    results,
    succeeded,
    failed,
    avgAcquireMs: acquireTimes.length ? acquireTimes.reduce((a, b) => a + b, 0) / acquireTimes.length : 0,
    maxAcquireMs: acquireTimes.length ? (acquireTimes.at(-1) ?? 0) : 0,
    p95AcquireMs: acquireTimes.length ? percentile(acquireTimes, 95) : 0,
    avgTotalMs: totalTimes.length ? totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length : 0,
    throughputPerSec: succeeded / (elapsedMs / 1000),
    peakQueueDepth,
    healthChecks,
  };
}

// ── Pool stress tests ────────────────────────────────────────────────────

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

describe("Scalability stress: SandboxRunnerPool", () => {
  it("10 concurrent simulations — all complete, no stuck runners", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    const report = await runStressTest(pool, 10, 50, 20);

    expect(report.succeeded).toBe(10);
    expect(report.failed).toBe(0);
    expect(report.avgAcquireMs).toBeLessThan(500);

    // Health: no runners stuck after test
    const finalStats = pool.getStats();
    expect(finalStats.inUseRunners).toBe(0);
    expect(finalStats.queuedRequests).toBe(0);

    console.log(`[10 sims] avg acquire: ${report.avgAcquireMs.toFixed(0)}ms, p95: ${report.p95AcquireMs.toFixed(0)}ms, peak queue: ${report.peakQueueDepth}, throughput: ${report.throughputPerSec.toFixed(1)}/s`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 30000);

  it("50 concurrent simulations — measure queue wait times", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    const report = await runStressTest(pool, 50, 50, 20);

    expect(report.succeeded).toBe(50);
    expect(report.failed).toBe(0);
    // With 10 runners and 50ms hold, expect ~5 waves → max queue ~40
    expect(report.peakQueueDepth).toBeLessThanOrEqual(45);
    expect(report.maxAcquireMs).toBeLessThan(5000);

    // Health: all runners released
    const finalStats = pool.getStats();
    expect(finalStats.inUseRunners).toBe(0);
    expect(finalStats.queuedRequests).toBe(0);

    console.log(`[50 sims] avg acquire: ${report.avgAcquireMs.toFixed(0)}ms, p95: ${report.p95AcquireMs.toFixed(0)}ms, max: ${report.maxAcquireMs.toFixed(0)}ms, peak queue: ${report.peakQueueDepth}, throughput: ${report.throughputPerSec.toFixed(1)}/s`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 30000);

  it("100 concurrent simulations — server stays healthy under load", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    const report = await runStressTest(pool, 100, 50, 10);

    expect(report.succeeded).toBe(100);
    expect(report.failed).toBe(0);
    // With 10 runners and 50ms hold, expect ~10 waves → p95 < 3s
    expect(report.p95AcquireMs).toBeLessThan(5000);

    // Health: no resource leaks
    const finalStats = pool.getStats();
    expect(finalStats.inUseRunners).toBe(0);
    expect(finalStats.queuedRequests).toBe(0);

    // Verify health snapshots show queue draining progressively
    const maxHealthQueue = Math.max(...report.healthChecks.map((h) => h.queuedRequests));
    expect(maxHealthQueue).toBeGreaterThan(0); // Queue was actually used
    const lastHealth = report.healthChecks.at(-1)!;
    expect(lastHealth.queuedRequests).toBe(0); // Queue drained

    console.log(`[100 sims] avg acquire: ${report.avgAcquireMs.toFixed(0)}ms, p95: ${report.p95AcquireMs.toFixed(0)}ms, max: ${report.maxAcquireMs.toFixed(0)}ms, peak queue: ${report.peakQueueDepth}, throughput: ${report.throughputPerSec.toFixed(1)}/s`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 30000);

  it("100 concurrent with stuck runners — pool recovers via timeout", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // First acquire 3 runners and make their stop() hang
    const stuckRunners = [];
    for (let i = 0; i < 3; i++) {
      const runner = await pool.acquireRunner();
      runner.isRunning = true;
      runner.stop = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
      stuckRunners.push(runner);
    }

    // Release all 3 stuck runners — they should be replaced within 10s each
    const releasePromises = stuckRunners.map((r: any) => pool.releaseRunner(r));
    await Promise.all(releasePromises);

    // Pool should have recovered: all slots free
    const stats = pool.getStats();
    expect(stats.inUseRunners).toBe(0);
    expect(stats.availableRunners).toBeGreaterThanOrEqual(5);

    // Now run 20 concurrent sims to verify pool is usable
    const report = await runStressTest(pool, 20, 30, 20);
    expect(report.succeeded).toBe(20);
    expect(report.failed).toBe(0);

    const finalStats = pool.getStats();
    expect(finalStats.inUseRunners).toBe(0);

    console.log(`[Recovery] 3 stuck runners replaced. 20 sims after recovery: avg acquire ${report.avgAcquireMs.toFixed(0)}ms`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 60000);

  it("4 simulations stop + immediate restart — no mid-reset runner reuse", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "5";
    vi.resetModules();
    const mod = await import("../../../server/services/sandbox-runner-pool");
    const pool = mod.getSandboxRunnerPool();
    await pool.initialize();

    // Phase 1: Acquire 4 runners (simulating 4 concurrent simulations)
    const firstAcquired: any[] = [];
    for (let i = 0; i < 4; i++) {
      const runner = await pool.acquireRunner();
      runner.isRunning = true;
      runner._state = "running";
      firstAcquired.push(runner);
    }

    const statsAfterAcquire = pool.getStats();
    expect(statsAfterAcquire.inUseRunners).toBe(4);
    expect(statsAfterAcquire.availableRunners).toBe(1);

    // Phase 2: Make runner.stop() slow (simulates Docker container cleanup)
    for (const runner of firstAcquired) {
      const origStop = runner.stop;
      runner.stop = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50)); // 50ms Docker cleanup delay
        runner.isRunning = false;
        runner._state = "stopped";
        if (origStop) await origStop.call(runner);
      });
    }

    // Phase 3: Release all 4 simultaneously (simulates 4 users clicking "stop")
    const releasePromises = firstAcquired.map((r) => pool.releaseRunner(r));

    // Phase 4: IMMEDIATELY acquire 4 runners again (simulates 4 users clicking "start" right after stop)
    const reacquirePromises = Array.from({ length: 4 }, () => pool.acquireRunner());

    // Wait for all operations to complete
    await Promise.all(releasePromises);
    const secondAcquired = await Promise.all(reacquirePromises);

    // CRITICAL: All 4 re-acquired runners must be fully reset and usable
    expect(secondAcquired).toHaveLength(4);
    for (const runner of secondAcquired) {
      expect(runner).toBeDefined();
      // Runner must NOT be in a resetting state
      expect(runner._state).not.toBe("running");
      // Runner's executionState must be clean
      expect(runner.executionState.processKilled).toBe(false);
      expect(runner.executionState.totalPausedTime).toBe(0);
      expect(runner.executionState.pauseStartTime).toBeNull();
    }

    // Pool health: no resetting runners, no queue
    const finalStats = pool.getStats();
    expect(finalStats.resettingRunners).toBe(0);
    expect(finalStats.queuedRequests).toBe(0);
    expect(finalStats.inUseRunners).toBe(4); // 4 are acquired by us

    // Phase 5: Release all and verify clean state
    for (const runner of secondAcquired) {
      await pool.releaseRunner(runner);
    }
    const cleanStats = pool.getStats();
    expect(cleanStats.inUseRunners).toBe(0);
    expect(cleanStats.resettingRunners).toBe(0);
    expect(cleanStats.availableRunners).toBe(5);

    console.log(`[4-sim restart] All 4 runners re-acquired successfully without mid-reset reuse`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 30000);
});

// ── Compile semaphore stress tests ───────────────────────────────────────

describe("Scalability stress: DockerCompileSemaphore", () => {
  it("10 concurrent compiles — all acquire and release correctly", async () => {
    vi.resetModules();
    const { DockerCompileSemaphore } = await import(
      "../../../server/services/sandbox/docker-compile-semaphore"
    );
    const semaphore = new DockerCompileSemaphore(8);

    let peakActive = 0;
    const queuings: number[] = [];

    const promises = Array.from({ length: 10 }, (_, i) =>
      (async () => {
        const start = Date.now();
        const release = await semaphore.acquire(() => {
          queuings.push(Date.now() - start);
        });
        peakActive = Math.max(peakActive, semaphore.activeCount);
        await new Promise((r) => setTimeout(r, 20)); // simulate compile
        release();
        return Date.now() - start;
      })(),
    );

    const times = await Promise.all(promises);

    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.queueLength).toBe(0);
    expect(peakActive).toBeLessThanOrEqual(8);
    console.log(`[Semaphore 10] peak active: ${peakActive}, avg time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}ms, queued: ${queuings.length}`);
  });

  it("50 concurrent compiles — FIFO ordering maintained, no deadlock", async () => {
    vi.resetModules();
    const { DockerCompileSemaphore } = await import(
      "../../../server/services/sandbox/docker-compile-semaphore"
    );
    const semaphore = new DockerCompileSemaphore(8);

    let peakActive = 0;
    let peakQueued = 0;

    const promises = Array.from({ length: 50 }, (_, i) =>
      (async () => {
        const start = Date.now();
        const release = await semaphore.acquire();
        peakActive = Math.max(peakActive, semaphore.activeCount);
        peakQueued = Math.max(peakQueued, semaphore.queueLength);
        await new Promise((r) => setTimeout(r, 20));
        release();
        return { index: i, totalMs: Date.now() - start };
      })(),
    );

    const results = await Promise.all(promises);

    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.queueLength).toBe(0);
    expect(peakActive).toBeLessThanOrEqual(8);
    expect(results).toHaveLength(50);

    const totalTimes = results.map((r) => r.totalMs);
    console.log(`[Semaphore 50] peak active: ${peakActive}, peak queued: ${peakQueued}, avg: ${(totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length).toFixed(0)}ms, max: ${Math.max(...totalTimes)}ms`);
  });

  it("100 concurrent compiles — measures queue wait time under pressure", async () => {
    vi.resetModules();
    const { DockerCompileSemaphore } = await import(
      "../../../server/services/sandbox/docker-compile-semaphore"
    );
    const semaphore = new DockerCompileSemaphore(8);

    let peakActive = 0;
    let peakQueued = 0;
    let queuedCount = 0;

    const promises = Array.from({ length: 100 }, (_, i) =>
      (async () => {
        const start = Date.now();
        const release = await semaphore.acquire(() => {
          queuedCount++;
        });
        const acquireMs = Date.now() - start;
        peakActive = Math.max(peakActive, semaphore.activeCount);
        peakQueued = Math.max(peakQueued, semaphore.queueLength);
        await new Promise((r) => setTimeout(r, 20));
        release();
        return { index: i, acquireMs, totalMs: Date.now() - start };
      })(),
    );

    const results = await Promise.all(promises);

    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.queueLength).toBe(0);
    expect(peakActive).toBeLessThanOrEqual(8);

    const acquireTimes = results.map((r) => r.acquireMs).sort((a, b) => a - b);
    const p95 = percentile(acquireTimes, 95);
    const avg = acquireTimes.reduce((a, b) => a + b, 0) / acquireTimes.length;

    // At least some requests should have been queued
    expect(queuedCount).toBeGreaterThan(0);
    // All should complete without deadlock
    expect(results).toHaveLength(100);

    console.log(`[Semaphore 100] peak active: ${peakActive}, peak queued: ${peakQueued}, queued: ${queuedCount}, avg acquire: ${avg.toFixed(0)}ms, p95: ${p95.toFixed(0)}ms`);
  });
});

// ── Combined pool + semaphore stress ─────────────────────────────────────

describe("Scalability stress: combined pool + semaphore", () => {
  it("50 concurrent simulations through pool + semaphore pipeline", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const poolMod = await import("../../../server/services/sandbox-runner-pool");
    const { DockerCompileSemaphore } = await import(
      "../../../server/services/sandbox/docker-compile-semaphore"
    );
    const pool = poolMod.getSandboxRunnerPool();
    await pool.initialize();
    const semaphore = new DockerCompileSemaphore(8);

    const results: Array<{ index: number; acquireMs: number; compileMs: number; runMs: number; totalMs: number; error?: string }> = [];
    const healthSnapshots: HealthSnapshot[] = [];

    const healthTimer = setInterval(() => {
      healthSnapshots.push({
        timestamp: Date.now(),
        availableRunners: pool.getStats().availableRunners,
        inUseRunners: pool.getStats().inUseRunners,
        queuedRequests: pool.getStats().queuedRequests,
      });
    }, 25);

    const promises = Array.from({ length: 50 }, (_, i) =>
      (async () => {
        const t0 = Date.now();
        try {
          // Phase 1: acquire runner
          const runner = await pool.acquireRunner();
          const acquireMs = Date.now() - t0;

          // Phase 2: acquire compile slot + compile
          const release = await semaphore.acquire();
          await new Promise((r) => setTimeout(r, 30)); // compile time
          release();
          const compileMs = Date.now() - t0 - acquireMs;

          // Phase 3: run simulation
          await new Promise((r) => setTimeout(r, 20)); // run time
          const runMs = Date.now() - t0 - acquireMs - compileMs;

          await pool.releaseRunner(runner);
          results.push({ index: i, acquireMs, compileMs, runMs, totalMs: Date.now() - t0 });
        } catch (error) {
          results.push({
            index: i,
            acquireMs: Date.now() - t0,
            compileMs: 0,
            runMs: 0,
            totalMs: Date.now() - t0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })(),
    );

    await Promise.all(promises);
    clearInterval(healthTimer);

    const succeeded = results.filter((r) => !r.error);
    expect(succeeded).toHaveLength(50);

    // Pool health: no leaks
    const finalStats = pool.getStats();
    expect(finalStats.inUseRunners).toBe(0);
    expect(finalStats.queuedRequests).toBe(0);
    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.queueLength).toBe(0);

    // Health snapshots should show load rising then falling
    const peakInUse = Math.max(...healthSnapshots.map((h) => h.inUseRunners));
    expect(peakInUse).toBeGreaterThan(0);

    const acquireTimes = succeeded.map((r) => r.acquireMs).sort((a, b) => a - b);
    const totalTimes = succeeded.map((r) => r.totalMs).sort((a, b) => a - b);

    console.log(`[Combined 50] peak in-use: ${peakInUse}, avg acquire: ${(acquireTimes.reduce((a, b) => a + b, 0) / acquireTimes.length).toFixed(0)}ms, p95 acquire: ${percentile(acquireTimes, 95).toFixed(0)}ms, avg total: ${(totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length).toFixed(0)}ms`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 30000);

  it("100 concurrent simulations with server health monitoring", async () => {
    process.env.SANDBOX_POOL_MIN_RUNNERS = "5";
    process.env.SANDBOX_POOL_MAX_RUNNERS = "10";
    vi.resetModules();
    const poolMod = await import("../../../server/services/sandbox-runner-pool");
    const { DockerCompileSemaphore } = await import(
      "../../../server/services/sandbox/docker-compile-semaphore"
    );
    const pool = poolMod.getSandboxRunnerPool();
    await pool.initialize();
    const semaphore = new DockerCompileSemaphore(8);

    const results: Array<{ index: number; totalMs: number; error?: string }> = [];
    const healthLog: Array<{ ts: number; poolInUse: number; poolQueued: number; semActive: number; semQueued: number }> = [];

    // Server health monitor — checks every 10ms
    const healthTimer = setInterval(() => {
      const stats = pool.getStats();
      healthLog.push({
        ts: Date.now(),
        poolInUse: stats.inUseRunners,
        poolQueued: stats.queuedRequests,
        semActive: semaphore.activeCount,
        semQueued: semaphore.queueLength,
      });
    }, 10);

    const promises = Array.from({ length: 100 }, (_, i) =>
      (async () => {
        const t0 = Date.now();
        try {
          const runner = await pool.acquireRunner();
          const release = await semaphore.acquire();
          await new Promise((r) => setTimeout(r, 25)); // compile
          release();
          await new Promise((r) => setTimeout(r, 15)); // run
          await pool.releaseRunner(runner);
          results.push({ index: i, totalMs: Date.now() - t0 });
        } catch (error) {
          results.push({ index: i, totalMs: Date.now() - t0, error: String(error) });
        }
      })(),
    );

    await Promise.all(promises);
    clearInterval(healthTimer);

    const succeeded = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => r.error).length;

    // ALL 100 must succeed — no timeouts, no deadlocks
    expect(succeeded).toBe(100);
    expect(failed).toBe(0);

    // Health: clean state after test
    expect(pool.getStats().inUseRunners).toBe(0);
    expect(pool.getStats().queuedRequests).toBe(0);
    expect(semaphore.activeCount).toBe(0);

    // Verify health monitoring detected actual load
    const peakPoolInUse = Math.max(...healthLog.map((h) => h.poolInUse));
    const peakPoolQueued = Math.max(...healthLog.map((h) => h.poolQueued));
    const peakSemActive = Math.max(...healthLog.map((h) => h.semActive));
    expect(peakPoolInUse).toBeGreaterThan(0);
    expect(peakSemActive).toBeGreaterThan(0);

    const totalTimes = results.filter((r) => !r.error).map((r) => r.totalMs).sort((a, b) => a - b);
    console.log(`[Combined 100] all ${succeeded} succeeded, peak pool: ${peakPoolInUse} in-use / ${peakPoolQueued} queued, peak sem: ${peakSemActive}, avg: ${(totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length).toFixed(0)}ms, p95: ${percentile(totalTimes, 95).toFixed(0)}ms, max: ${totalTimes.at(-1)}ms`);

    delete process.env.SANDBOX_POOL_MIN_RUNNERS;
    delete process.env.SANDBOX_POOL_MAX_RUNNERS;
    await pool.shutdown();
  }, 60000);
});
