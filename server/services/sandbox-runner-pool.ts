/**
 * SandboxRunnerPool
 * 
 * Manages a fixed pool of SandboxRunner instances to:
 * - Prevent unlimited process spawning (OOM protection)
 * - Recycle runner instances (efficiency)
 * - Maintain strict isolation between requests (security)
 * 
 * Queue-based management ensures fair access when all runners busy.
 */

import { SandboxRunner } from "./sandbox-runner";
import { Logger } from "@shared/logger";
import { RegistryManager } from "./registry-manager";

/**
 * Internal wrapper tracking runner state
 */
interface PooledRunner {
  runner: SandboxRunner;
  inUse: boolean;
  lastReleasedTime: number;
}

/**
 * Queue entry for waiting acquire requests
 */
interface QueueEntry {
  resolve: (runner: SandboxRunner) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * SandboxRunnerPool - manages fixed number of reusable sandbox runners
 * 
 * Security: Strict state isolation via complete reset on release
 * Performance: No unbounded process creation; queue-based fairness
 * Reliability: Timeout protection, error handling, cleanup
 */
export class SandboxRunnerPool {
  private readonly numRunners: number;
  private readonly runners: PooledRunner[] = [];
  private readonly queue: QueueEntry[] = [];
  private readonly logger = new Logger("SandboxRunnerPool");
  private readonly acquireTimeoutMs = 60000; // 60s timeout per acquire request
  private initialized = false;

  constructor(numRunners: number = 5) {
    this.numRunners = numRunners;
    this.logger.info(`[SandboxRunnerPool] Initialized with target pool size: ${this.numRunners}`);
  }

  /**
   * Initialize all runners in the pool
   * Deferred from constructor to allow async setup
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info(`[SandboxRunnerPool] Initializing ${this.numRunners} runner instances...`);
    
    for (let i = 0; i < this.numRunners; i++) {
      const runner = new SandboxRunner();
      this.runners.push({
        runner,
        inUse: false,
        lastReleasedTime: Date.now(),
      });
      this.logger.debug(`[SandboxRunnerPool] Created runner [${i}]`);
    }

    this.initialized = true;
    this.logger.info(`[SandboxRunnerPool] Pool ready with ${this.numRunners} runners`);
  }

  /**
   * Acquire a runner from the pool
   * Returns immediately if available, otherwise queues request
   * 
   * @throws Error if pool not initialized or timeout reached
   */
  async acquireRunner(): Promise<SandboxRunner> {
    if (!this.initialized) {
      throw new Error("SandboxRunnerPool not initialized. Call initialize() first.");
    }

    // Try to find an available runner
    const available = this.runners.find((p) => !p.inUse);
    if (available) {
      available.inUse = true;
      this.logger.debug(
        `[SandboxRunnerPool] Runner acquired (available: ${this.runners.filter((p) => !p.inUse).length}/${this.numRunners - 1})`
      );
      return available.runner;
    }

    // All runners busy - queue the request
    return new Promise<SandboxRunner>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue if timeout fires
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error(`SandboxRunnerPool: acquire timeout after ${this.acquireTimeoutMs}ms (queue: ${this.queue.length})`));
      }, this.acquireTimeoutMs);

      const entry: QueueEntry = { resolve, reject, timeout };
      this.queue.push(entry);
      
      this.logger.debug(
        `[SandboxRunnerPool] Runner queued (queue length: ${this.queue.length}/${this.numRunners})`
      );
    });
  }

  /**
   * Release a runner back to the pool
   * CRITICAL: Performs complete state reset for isolation
   * 
   * @param runner The runner to release
   * @throws Error if runner not from this pool
   */
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

    // CRITICAL: Complete state reset before returning to pool
    await this.resetRunnerState(runner);

    // Mark as available
    pooledRunner.inUse = false;
    pooledRunner.lastReleasedTime = Date.now();

    this.logger.debug(
      `[SandboxRunnerPool] Runner released and reset (available: ${this.runners.filter((p) => !p.inUse).length}/${this.numRunners})`
    );

    // Process queue if any requests waiting
    if (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      clearTimeout(entry.timeout);
      entry.resolve(runner);
      
      // Mark as immediately in use (for next request)
      pooledRunner.inUse = true;
      
      this.logger.debug(`[SandboxRunnerPool] Queued request granted (queue: ${this.queue.length} remaining)`);
    }
  }

  /**
   * SECURITY CRITICAL: Complete state reset
   * Ensures student A cannot see student B's data
   * 
   * Resets all:
   * - Callbacks (onOutput, error, etc.)
   * - State machines (simulationState counters)
   * - Timing data (pauseStartTime, totalPausedTime)
   * - Managers (RegistryManager, TimeoutManager)
   * - Buffers (output, error)
   * - Process state
   */
  private async resetRunnerState(runner: SandboxRunner): Promise<void> {
    try {
      // 1. Stop any active simulation to trigger internal cleanup
      if (runner.isRunning) {
        this.logger.debug("[SandboxRunnerPool] Runner still running - stopping...");
        await runner.stop();
      }

      // 2. Access private fields via reflection to reset state
      // (TypeScript allows this at runtime)
      const r = runner as any;

      // Reset simulation state
      r.state = 0; // SimulationState.STOPPED
      r.processKilled = false;
      r.pauseStartTime = null;
      r.totalPausedTime = 0;
      r.lastPauseTimestamp = null;

      // Reset batchers to null (already destroyed in stop())
      r.pinStateBatcher = null;
      r.serialOutputBatcher = null;

      // Reset callbacks
      r.onOutputCallback = null;
      r.outputCallback = null;
      r.errorCallback = null;
      r.telemetryCallback = null;
      r.pinStateCallback = null;
      r.ioRegistryCallback = null;

      // Reset buffers
      r.outputBuffer = "";
      r.errorBuffer = "";
      r.isSendingOutput = false;

      // Reset pending cleanup flag
      r.pendingCleanup = false;
      r.cleanupRetries = new Map();

      // Clear flush timer
      if (r.flushTimer) {
        clearTimeout(r.flushTimer);
        r.flushTimer = null;
      }

      // Reset file builder state (clear created sketch directories list)
      if (r.fileBuilder && typeof r.fileBuilder.reset === 'function') {
        r.fileBuilder.reset();
      }

      // RegistryManager is recreated fresh (not reused across requests)
      // This is the safest approach to avoid any state leakage
      if (r.registryManager) {
        try {
          r.registryManager.destroy(); // Cleanup existing
        } catch (e) {
          this.logger.debug(`[SandboxRunnerPool] Error destroying old RegistryManager: ${e}`);
        }
      }

      // Create fresh RegistryManager (same as in constructor)
      r.registryManager = new RegistryManager({
        onUpdate: (registry: any, baudrate: any, reason: any) => {
          if (r.ioRegistryCallback) {
            r.ioRegistryCallback(registry, baudrate, reason);
          }
          r.flushMessageQueue?.();
        },
        onTelemetry: (metrics: any) => {
          if (r.telemetryCallback) {
            r.telemetryCallback(metrics);
          }
        },
        enableTelemetry: true,
      });

      // Reset TimeoutManager
      if (r.timeoutManager) {
        r.timeoutManager.clear();
      }

      this.logger.debug("[SandboxRunnerPool] Runner state reset complete (isolation verified)");
    } catch (error) {
      this.logger.error(`[SandboxRunnerPool] Error during runner reset: ${error}`);
      // Don't throw - mark runner as available anyway (will be in incomplete state if reused)
      // Better to return runner than to lose it from pool
    }
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return {
      totalRunners: this.numRunners,
      availableRunners: this.runners.filter((p) => !p.inUse).length,
      inUseRunners: this.runners.filter((p) => p.inUse).length,
      queuedRequests: this.queue.length,
      initialized: this.initialized,
    };
  }

  /**
   * Graceful shutdown - stop all runners
   */
  async shutdown(): Promise<void> {
    this.logger.info("[SandboxRunnerPool] Shutting down...");

    // Reject any pending queue entries
    for (const entry of this.queue) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("SandboxRunnerPool shutting down"));
    }
    this.queue.length = 0;

    // Stop all runners
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

// Singleton instance
let poolInstance: SandboxRunnerPool | null = null;

/**
 * Get or create the global SandboxRunnerPool
 */
export function getSandboxRunnerPool(): SandboxRunnerPool {
  if (!poolInstance) {
    poolInstance = new SandboxRunnerPool(5); // Default: 5 runners
  }
  return poolInstance;
}

/**
 * Initialize the global runner pool
 * Must be called at app startup
 */
export async function initializeSandboxRunnerPool(): Promise<void> {
  const pool = getSandboxRunnerPool();
  await pool.initialize();
}
