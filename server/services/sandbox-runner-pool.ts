import { SandboxRunner } from "./sandbox-runner";
import { Logger } from "@shared/logger";
import { config } from "../config";

interface PooledRunner {
  runner: SandboxRunner;
  inUse: boolean;
  resetting: boolean;
  quarantined?: boolean;
  lastReleasedTime: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface QueueEntry {
  resolve: (runner: SandboxRunner) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface SandboxRunnerPoolOptions {
  minRunners?: number;
  maxRunners?: number;
  maxQueueSize?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
  resetTimeoutMs?: number;
}

export class SandboxRunnerPool {
  private readonly minRunners: number;
  private readonly maxRunners: number;
  private readonly maxQueueSize: number;
  private readonly idleTimeoutMs: number;
  private readonly runners: PooledRunner[] = [];
  private readonly queue: QueueEntry[] = [];
  private readonly logger = new Logger("SandboxRunnerPool");
  private readonly acquireTimeoutMs: number;
  private readonly resetTimeoutMs: number;
  private initialized = false;
  private shuttingDown = false;

  constructor(options: SandboxRunnerPoolOptions = {}) {
    this.minRunners = options.minRunners ?? config.sandbox.pool.minRunners;
    this.maxRunners = options.maxRunners ?? config.sandbox.pool.maxRunners;
    this.maxQueueSize = options.maxQueueSize ?? config.sandbox.pool.maxQueueSize;
    this.idleTimeoutMs = options.idleTimeoutMs ?? config.sandbox.pool.idleTimeoutMs;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? config.sandbox.pool.acquireTimeoutMs;
    this.resetTimeoutMs = options.resetTimeoutMs ?? config.sandbox.pool.resetTimeoutMs;
    this.logger.info(
      `[SandboxRunnerPool] Logical simulation capacity: activeMax=${this.maxRunners}, warmFloor=${this.minRunners}, idleTimeout=${this.idleTimeoutMs}ms`,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info(
      `[SandboxRunnerPool] Initializing ${this.minRunners} logical runner instances...`,
    );
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

    await Promise.all(this.runners.map(({ runner }) => runner.initialize()));

    this.initialized = true;
    this.logger.info(
      `[SandboxRunnerPool] Pool ready with ${this.minRunners} logical runners (simulation max: ${this.maxRunners})`,
    );
  }

  async acquireRunner(signal?: AbortSignal): Promise<SandboxRunner> {
    if (!this.initialized) {
      throw new Error(
        "SandboxRunnerPool not initialized. Call initialize() first.",
      );
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
      this.runners.push({
        runner,
        inUse: true,
        resetting: false,
        lastReleasedTime: Date.now(),
        idleTimer: null,
      });
      this.logger.debug(
        `[SandboxRunnerPool] On-demand runner created (total: ${this.runners.length}/${this.maxRunners})`,
      );
      return runner;
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `SandboxRunnerPool queue full (${this.maxQueueSize} pending). Try again later.`,
      );
    }

    return new Promise<SandboxRunner>((resolve, reject) => {
      if (signal?.aborted) {
        reject(
          new Error(
            "SandboxRunnerPool: acquire cancelled (client disconnected)",
          ),
        );
        return;
      }

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

      const onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        clearTimeout(timeout);
        this.logger.debug(
          `[SandboxRunnerPool] Queued request cancelled by AbortSignal (queue: ${this.queue.length} remaining)`,
        );
        reject(
          new Error(
            "SandboxRunnerPool: acquire cancelled (client disconnected)",
          ),
        );
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

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
      this.logger.warn(
        "[SandboxRunnerPool] Attempt to release unknown runner (ignored)",
      );
      return;
    }

    if (!pooledRunner.inUse && !pooledRunner.quarantined) {
      this.logger.warn(
        "[SandboxRunnerPool] Attempt to release already-released runner (ignored)",
      );
      return;
    }

    // Always mark as free FIRST, even if reset hangs — prevents permanent pool deadlock
    if (pooledRunner.idleTimer !== null) {
      clearTimeout(pooledRunner.idleTimer);
      pooledRunner.idleTimer = null;
    }
    pooledRunner.inUse = false;
    pooledRunner.quarantined = false;
    pooledRunner.resetting = true;
    pooledRunner.lastReleasedTime = Date.now();

    // Reset with a timeout guard so a stuck runner.stop() cannot block forever
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runner.resetForReuse(),
        new Promise<void>((_, reject) => {
          resetTimer = setTimeout(
            () => reject(new Error("Runner reset timed out")),
            this.resetTimeoutMs,
          );
        }),
      ]);
      pooledRunner.resetting = false;
    } catch (error) {
      this.logger.error(
        `[SandboxRunnerPool] Runner reset failed or timed out: ${error}.`,
      );
      if (this.recoverFailedReset(pooledRunner)) return;
    } finally {
      if (resetTimer !== undefined) {
        clearTimeout(resetTimer);
      }
    }

    // Find the (possibly replaced) pooled runner for queue dispatch
    const currentPooled = this.runners.find(
      (p) => p.runner === (pooledRunner.runner ?? runner) || p === pooledRunner,
    );
    const freeRunner =
      currentPooled && !currentPooled.inUse && !currentPooled.resetting
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

  private recoverFailedReset(pooledRunner: PooledRunner): boolean {
    if (pooledRunner.runner.hasPendingContainerCleanup) {
      this.quarantineForCleanup(pooledRunner);
      return true;
    }
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
      this.logger.info(
        `[SandboxRunnerPool] Replaced stuck runner at index ${index} with fresh instance`,
      );
    }
    return false;
  }

  private quarantineForCleanup(pooledRunner: PooledRunner): void {
    // Retain ownership in this bounded slot and retry using the existing
    // idle-maintenance interval. Never offer it until reset confirms cleanup.
    pooledRunner.quarantined = true;
    if (this.shuttingDown) return;
    pooledRunner.idleTimer = setTimeout(() => {
      pooledRunner.idleTimer = null;
      void this.releaseRunner(pooledRunner.runner);
    }, this.idleTimeoutMs);
    pooledRunner.idleTimer.unref();
  }

  /**
   * Schedule idle cleanup for logical runners above the derived warm floor.
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

  getStats() {
    const sandboxStatuses = this.runners.map((entry) =>
      (entry.runner as SandboxRunner & {
        getSandboxStatus?: () => { dockerAvailable: boolean; dockerImageBuilt: boolean };
      }).getSandboxStatus?.(),
    );
    const sandboxReady = config.serverMode !== "docker" ||
      (sandboxStatuses.length > 0 && sandboxStatuses.every(
        (status) => status?.dockerAvailable && status.dockerImageBuilt,
      ));

    return {
      totalRunners: this.runners.length,
      minRunners: this.minRunners,
      maxRunners: this.maxRunners,
      maxQueueSize: this.maxQueueSize,
      availableRunners: this.runners.filter((p) => !p.inUse && !p.resetting)
        .length,
      inUseRunners: this.runners.filter((p) => p.inUse).length,
      resettingRunners: this.runners.filter((p) => p.resetting).length,
      queuedRequests: this.queue.length,
      initialized: this.initialized,
      sandboxReady,
    };
  }

  getRunnerIndex(runner: SandboxRunner): number {
    return this.runners.findIndex((p) => p.runner === runner);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
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
        if (runner.isRunning || runner.hasPendingContainerCleanup) {
          await runner.stop();
        }
      } catch (error) {
        this.logger.warn(
          `[SandboxRunnerPool] Error stopping runner during shutdown: ${error}`,
        );
      }
    }

    this.logger.info("[SandboxRunnerPool] Shutdown complete");
  }
}

let poolInstance: SandboxRunnerPool | null = null;

export function getSandboxRunnerPool(): SandboxRunnerPool {
  poolInstance ??= new SandboxRunnerPool({
    minRunners: config.sandbox.pool.minRunners,
    maxRunners: config.sandbox.pool.maxRunners,
    idleTimeoutMs: config.sandbox.pool.idleTimeoutMs,
    acquireTimeoutMs: config.sandbox.pool.acquireTimeoutMs,
    resetTimeoutMs: config.sandbox.pool.resetTimeoutMs,
  });
  return poolInstance;
}

export async function initializeSandboxRunnerPool(): Promise<void> {
  const pool = getSandboxRunnerPool();
  await pool.initialize();
}

/** Reset the singleton — test-only, allows re-initialization with new env vars. */
export function _resetPoolSingleton(): void {
  if (poolInstance) {
    poolInstance.shutdown().catch(() => {});
    poolInstance = null;
  }
}
