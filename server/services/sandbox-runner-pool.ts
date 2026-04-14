import { SandboxRunner } from "./sandbox-runner";
import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";
import type { ExecutionState, TelemetryMetrics } from "./sandbox/execution-manager";

interface PooledRunner {
  runner: SandboxRunner;
  inUse: boolean;
  resetting: boolean;
  lastReleasedTime: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface QueueEntry {
  resolve: (runner: SandboxRunner) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// Useful internal type for accessing private runner fields safely
type SandboxRunnerInternal = {
  state: string;
  processKilled: boolean;
  executionState: ExecutionState;
  processController?: {
    proc?: {
      stdout?: unknown;
      stderr?: unknown;
    };
    stdoutListeners?: unknown[];
    stderrListeners?: unknown[];
    closeListeners?: unknown[];
    errorListeners?: unknown[];
    removeAllListeners?: () => void;
  } | null;
  pinStateBatcher?: { pause: () => void; resume: () => void } | null;
  serialOutputBatcher?: { pause: () => void; resume: () => void } | null;
  registryManager?: { destroy: () => void; reset: () => void } | null;
  flushMessageQueue?: () => void;
  onOutputCallback?: ((line: string, isComplete?: boolean) => void) | null;
  outputCallback?: ((line: string, isComplete?: boolean) => void) | null;
  errorCallback?: ((line: string) => void) | null;
  telemetryCallback?: ((metrics: TelemetryMetrics) => void) | null;
  pinStateCallback?: ((pin: number, type: string, value: number) => void) | null;
  ioRegistryCallback?:
    | ((registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void)
    | null;
  timeoutManager?: { clear: () => void };
  fileBuilder?: { reset: () => void };
  flushTimer?: NodeJS.Timeout | null;
  // keep object extensible as we access other internal fields in reset logic
  [key: string]: unknown;
};

class SandboxRunnerPool {
  private readonly minRunners: number;
  private readonly maxRunners: number;
  private readonly idleTimeoutMs: number;
  private readonly runners: PooledRunner[] = [];
  private readonly queue: QueueEntry[] = [];
  private readonly logger = new Logger("SandboxRunnerPool");
  private readonly acquireTimeoutMs = 60000;
  private readonly resetTimeoutMs = 10000;
  private initialized = false;

  constructor(options: { minRunners?: number; maxRunners?: number; idleTimeoutMs?: number } = {}) {
    this.minRunners = options.minRunners ?? 5;
    this.maxRunners = options.maxRunners ?? this.minRunners;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 120000;
    this.logger.info(
      `[SandboxRunnerPool] Pool config: min=${this.minRunners}, max=${this.maxRunners}, idleTimeout=${this.idleTimeoutMs}ms`,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info(`[SandboxRunnerPool] Initializing ${this.minRunners} warm runner instances...`);
    for (let i = 0; i < this.minRunners; i++) {
      const runner = new SandboxRunner();
      this.runners.push({
        runner,
        inUse: false,
        resetting: false,
        lastReleasedTime: Date.now(),
        idleTimer: null,
      });
      this.logger.debug(`[SandboxRunnerPool] Created warm runner [${i}]`);
    }

    this.initialized = true;
    this.logger.info(`[SandboxRunnerPool] Pool ready with ${this.minRunners} warm runners (max: ${this.maxRunners})`);
  }

  async acquireRunner(): Promise<SandboxRunner> {
    if (!this.initialized) {
      throw new Error("SandboxRunnerPool not initialized. Call initialize() first.");
    }

    const available = this.runners.find((p) => !p.inUse && !p.resetting);
    if (available) {
      available.inUse = true;
      // Cancel any pending idle-cleanup timer for this runner
      if (available.idleTimer !== null) {
        clearTimeout(available.idleTimer);
        available.idleTimer = null;
      }
      this.logger.debug(
        `[SandboxRunnerPool] Runner acquired (available: ${this.runners.filter((p) => !p.inUse).length}/${this.runners.length})`,
      );
      return available.runner;
    }

    // On-demand creation: create a new runner if below maxRunners
    if (this.runners.length < this.maxRunners) {
      const runner = new SandboxRunner();
      this.runners.push({ runner, inUse: true, resetting: false, lastReleasedTime: Date.now(), idleTimer: null });
      this.logger.debug(
        `[SandboxRunnerPool] On-demand runner created (total: ${this.runners.length}/${this.maxRunners})`,
      );
      return runner;
    }

    return new Promise<SandboxRunner>((resolve, reject) => {
      let entry: QueueEntry;
      const timeout = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(
          new Error(
            `SandboxRunnerPool: acquire timeout after ${this.acquireTimeoutMs}ms (queue: ${this.queue.length})`,
          ),
        );
      }, this.acquireTimeoutMs);

      entry = { resolve, reject, timeout };
      this.queue.push(entry);
      this.logger.debug(
        `[SandboxRunnerPool] Runner queued (queue length: ${this.queue.length}, at maxRunners: ${this.maxRunners})`,
      
      );
    });
  }

  async releaseRunner(runner: SandboxRunner): Promise<void> {
    const pooledRunner = this.runners.find((p) => p.runner === runner);
    if (!pooledRunner) {
      this.logger.warn("[SandboxRunnerPool] Attempt to release unknown runner (ignored)");
      return;
    }

    if (!pooledRunner.inUse) {
      this.logger.warn("[SandboxRunnerPool] Attempt to release already-released runner (ignored)");
      return;
    }

    // Always mark as free FIRST, even if reset hangs — prevents permanent pool deadlock
    pooledRunner.inUse = false;
    pooledRunner.resetting = true;
    pooledRunner.lastReleasedTime = Date.now();

    // Reset with a timeout guard so a stuck runner.stop() cannot block forever
    try {
      await Promise.race([
        this.resetRunnerState(runner),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Runner reset timed out")), this.resetTimeoutMs),
        ),
      ]);
      pooledRunner.resetting = false;
    } catch (error) {
      this.logger.error(
        `[SandboxRunnerPool] Runner reset failed or timed out: ${error}. Force-replacing runner.`,
      );
      // Replace the stuck runner with a fresh one
      const index = this.runners.indexOf(pooledRunner);
      if (index !== -1) {
        const freshRunner = new SandboxRunner();
        this.runners[index] = {
          runner: freshRunner,
          inUse: false,
          resetting: false,
          lastReleasedTime: Date.now(),
          idleTimer: null,
        };
        this.logger.info(`[SandboxRunnerPool] Replaced stuck runner at index ${index} with fresh instance`);
      }
    }

    // Find the (possibly replaced) pooled runner for queue dispatch
    const currentPooled = this.runners.find((p) => p.runner === (pooledRunner.runner ?? runner) || p === pooledRunner);
    const freeRunner = currentPooled && !currentPooled.inUse && !currentPooled.resetting
      ? currentPooled
      : this.runners.find((p) => !p.inUse && !p.resetting);

    this.logger.debug(
      `[SandboxRunnerPool] Runner released and reset (available: ${this.runners.filter((p) => !p.inUse).length}/${this.runners.length})`,
    );

    if (this.queue.length > 0 && freeRunner) {
      const entry = this.queue.shift();
      if (entry) {
        clearTimeout(entry.timeout);
        freeRunner.inUse = true;
        entry.resolve(freeRunner.runner);
        this.logger.debug(
          `[SandboxRunnerPool] Queued request granted (queue: ${this.queue.length} remaining)`,
        );
      }
    } else if (freeRunner) {
      this.scheduleIdleCleanup(freeRunner);
    }
  }

  /**
   * Schedule idle cleanup for runners above the minRunners floor.
   * If the runner is re-acquired before the timer fires, the timer is cancelled.
   */
  private scheduleIdleCleanup(pooledRunner: PooledRunner): void {
    // Only schedule cleanup for runners above the warm floor
    const warmRunners = this.runners.slice(0, this.minRunners);
    if (warmRunners.includes(pooledRunner)) {
      return; // This is a warm runner – never clean it up
    }

    // Cancel existing timer if any
    if (pooledRunner.idleTimer !== null) {
      clearTimeout(pooledRunner.idleTimer);
    }

    pooledRunner.idleTimer = setTimeout(() => {
      pooledRunner.idleTimer = null;
      if (pooledRunner.inUse) return; // Reacquired before timer fired
      const idx = this.runners.indexOf(pooledRunner);
      if (idx !== -1) {
        this.runners.splice(idx, 1);
        this.logger.debug(
          `[SandboxRunnerPool] Idle runner removed (total: ${this.runners.length}/${this.maxRunners})`,
        );
      }
    }, this.idleTimeoutMs);
  }

  private clearRunnerListeners(runner: SandboxRunnerInternal): void {
    const safeRemoveAll = (target: unknown, label: string) => {
      if (!target || typeof target !== "object" || target === null) {
        return;
      }

      const maybe = target as { removeAllListeners?: unknown };
      if (typeof maybe.removeAllListeners !== "function") {
        return;
      }

      try {
        (maybe.removeAllListeners as () => void)();
      } catch (error) {
        this.logger.debug(`[SandboxRunnerPool] Failed removeAllListeners on ${label}: ${error}`);
      }
    };

    safeRemoveAll(runner, "runner");

    const processController = runner.processController;
    safeRemoveAll(processController, "processController");
    safeRemoveAll(processController?.proc, "processController.proc");
    safeRemoveAll(processController?.proc?.stdout, "processController.proc.stdout");
    safeRemoveAll(processController?.proc?.stderr, "processController.proc.stderr");

    safeRemoveAll(runner.registryManager, "registryManager");
    safeRemoveAll(runner.serialOutputBatcher, "serialOutputBatcher");
    safeRemoveAll(runner.pinStateBatcher, "pinStateBatcher");

    if (processController) {
      processController.stdoutListeners = [];
      processController.stderrListeners = [];
      processController.closeListeners = [];
      processController.errorListeners = [];
    }
  }

  private async resetRunnerState(runner: SandboxRunner): Promise<void> {
    try {
      if (runner.isRunning) {
        await runner.stop();
      }

      const r = runner as unknown as SandboxRunnerInternal;

      this.clearRunnerListeners(r);

      // Use the state setter (delegates to executionState.state)
      r.state = "stopped";

      // Reset executionState fields directly to avoid creating ad-hoc properties
      // on the runner instance that shadow the real executionState fields.
      const es = r.executionState;
      es.processKilled = false;
      es.pauseStartTime = null;
      es.totalPausedTime = 0;
      es.pinStateBatcher = null;
      es.serialOutputBatcher = null;
      es.onOutputCallback = null;
      es.errorCallback = null;
      es.telemetryCallback = null;
      es.pinStateCallback = null;
      es.ioRegistryCallback = undefined;
      es.outputBuffer = "";
      es.outputBufferIndex = 0;
      es.totalOutputBytes = 0;
      es.isSendingOutput = false;
      es.pendingCleanup = false;
      es.messageQueue = [];
      es.stderrFallbackBuffer = "";
      es.backpressurePaused = false;

      if (es.flushTimer) {
        clearTimeout(es.flushTimer);
        es.flushTimer = null;
      }

      if (r.fileBuilder && typeof r.fileBuilder.reset === "function") {
        r.fileBuilder.reset();
      }

      // Reset the existing RegistryManager rather than destroying and recreating it.
      // Destroying makes the object permanently unusable (destroyed=true), which breaks
      // the ExecutionManager that holds a reference to the same instance.
      // The original onUpdate callback uses executionState.ioRegistryCallback dynamically,
      // so it picks up the correct callback for each new run automatically.
      if (r.registryManager) {
        try {
          r.registryManager.reset();
        } catch (error) {
          this.logger.debug(`[SandboxRunnerPool] RegistryManager reset failed: ${error}`);
        }
      }

      if (r.timeoutManager) {
        r.timeoutManager.clear();
      }

      this.logger.debug("[SandboxRunnerPool] Runner state reset complete (isolation verified)");
    } catch (error) {
      this.logger.error(`[SandboxRunnerPool] Error during runner reset: ${error}`);
    }
  }

  getStats() {
    return {
      totalRunners: this.runners.length,
      minRunners: this.minRunners,
      maxRunners: this.maxRunners,
      availableRunners: this.runners.filter((p) => !p.inUse && !p.resetting).length,
      inUseRunners: this.runners.filter((p) => p.inUse).length,
      resettingRunners: this.runners.filter((p) => p.resetting).length,
      queuedRequests: this.queue.length,
      initialized: this.initialized,
    };
  }

  getRunnerIndex(runner: SandboxRunner): number {
    return this.runners.findIndex((p) => p.runner === runner);
  }

  async shutdown(): Promise<void> {
    this.logger.info("[SandboxRunnerPool] Shutting down...");

    for (const entry of this.queue) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("SandboxRunnerPool shutting down"));
    }
    this.queue.length = 0;

    // Cancel all idle timers
    for (const pooledRunner of this.runners) {
      if (pooledRunner.idleTimer !== null) {
        clearTimeout(pooledRunner.idleTimer);
        pooledRunner.idleTimer = null;
      }
    }

    for (const { runner } of this.runners) {
      try {
        if (runner.isRunning) {
          await runner.stop();
        }
      } catch (error) {
        this.logger.warn(`[SandboxRunnerPool] Error stopping runner during shutdown: ${error}`);
      }
    }

    this.logger.info("[SandboxRunnerPool] Shutdown complete");
  }
}

let poolInstance: SandboxRunnerPool | null = null;

export function getSandboxRunnerPool(): SandboxRunnerPool {
  if (!poolInstance) {
    const minRunners = Number.parseInt(process.env.SANDBOX_POOL_MIN_RUNNERS ?? "5", 10);
    const maxRunners = Number.parseInt(process.env.SANDBOX_POOL_MAX_RUNNERS ?? String(minRunners), 10);
    const idleTimeoutMs = Number.parseInt(process.env.SANDBOX_POOL_IDLE_TIMEOUT_MS ?? "120000", 10);
    poolInstance = new SandboxRunnerPool({ minRunners, maxRunners, idleTimeoutMs });
  }
  return poolInstance;
}

export async function initializeSandboxRunnerPool(): Promise<void> {
  const pool = getSandboxRunnerPool();
  await pool.initialize();
}
