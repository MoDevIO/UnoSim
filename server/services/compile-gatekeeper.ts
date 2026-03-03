/**
 * Compile Gatekeeper - Semaphore for Compiler Process Concurrency Control
 *
 * Limits the number of simultaneous Arduino CLI compiler processes
 * to prevent race conditions in temp directory access and build failures.
 * 
 * Default: 4 concurrent compiles (tuned for typical systems)
 * Can be adjusted via environment variable or constructor parameter.
 */

import { Logger } from "@shared/logger";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

export class CompileGatekeeper {
  private available: number;
  private readonly maxConcurrent: number;
  private queue: Array<() => void> = [];
  private activeCompiles = 0;
  private logger = new Logger("CompileGatekeeper");
  private readonly lockRootDir = process.env.BUILD_CACHE_LOCK_DIR || "/tmp/unowebsim/cache/locks";

  constructor(maxConcurrent?: number) {
    // In worker threads, disable gatekeeper since the worker pool controls concurrency
    const isWorkerThread = process.env.COMPILE_GATEKEEPER_DISABLED === "true";
    
    if (isWorkerThread) {
      // Worker pool already limits concurrency, so allow unlimited compiles per worker
      this.maxConcurrent = Infinity;
      this.available = Infinity;
      this.logger.debug(
        `CompileGatekeeper in worker thread - gatekeeper disabled (pool controls concurrency)`,
      );
    } else {
      // Main thread: enforce concurrency limit
      this.maxConcurrent =
        maxConcurrent || parseInt(process.env.COMPILE_MAX_CONCURRENT || "4", 10);
      this.available = this.maxConcurrent;

      this.logger.info(
        `CompileGatekeeper initialized with max ${this.maxConcurrent} concurrent compiles`,
      );
    }
  }

  /**
   * Acquire a compile slot.
   * If no slots available, this returns a Promise that resolves when a slot becomes free.
   * 
   * Usage:
   * ```typescript
   * const release = await gatekeeper.acquire();
   * try {
   *   await compiler.compile(code);
   * } finally {
   *   release();
   * }
   * ```
   */
  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.available--;
        this.activeCompiles++;
        this.logger.debug(
          `Compile acquired (available: ${this.available}, active: ${this.activeCompiles})`,
        );
        // Return the release function bound to this instance
        resolve(this.release.bind(this));
      };

      if (this.available > 0) {
        // Fast path: slot available immediately
        grant();
      } else {
        // Slow path: queue the request
        this.queue.push(grant);
        this.logger.debug(
          `Compile queued (queue length: ${this.queue.length}, active: ${this.activeCompiles})`,
        );
      }
    });
  }

  /**
   * Release a compile slot (called by the release function returned from acquire())
   * Grants the next queued compilation job, if any.
   */
  private release() {
    this.available++;
    this.activeCompiles--;
    this.logger.debug(
      `Compile released (available: ${this.available}, active: ${this.activeCompiles}, queued: ${this.queue.length})`,
    );

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  /**
   * Get current gatekeeper statistics for monitoring/debugging
   */
  getStats() {
    return {
      maxConcurrent: this.maxConcurrent,
      available: this.available,
      active: this.activeCompiles,
      queued: this.queue.length,
    };
  }

  /**
   * Gracefully drain the queue and wait for all active compiles to finish.
   * Useful for shutdown scenarios.
   */
  async drain(): Promise<void> {
    return new Promise((resolve) => {
      const checkEmpty = () => {
        if (this.activeCompiles === 0 && this.queue.length === 0) {
          resolve();
        } else {
          // Check again in 100ms
          setTimeout(checkEmpty, 100);
        }
      };
      checkEmpty();
    });
  }

  /**
   * Acquire a named lock backed by the filesystem.
   * Prevents cache stampede scenarios across worker threads/processes.
   */
  async acquireNamedLock(lockKey: string, timeoutMs: number = 30000): Promise<() => Promise<void>> {
    const safeKey = lockKey.replace(/[^a-zA-Z0-9._-]/g, "_");
    const lockPath = join(this.lockRootDir, safeKey);
    const startedAt = Date.now();

    await mkdir(this.lockRootDir, { recursive: true });

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await mkdir(lockPath);
        this.logger.debug(`Named lock acquired: ${safeKey}`);
        return async () => {
          await rm(lockPath, { recursive: true, force: true });
          this.logger.debug(`Named lock released: ${safeKey}`);
        };
      } catch (error: any) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Timeout while waiting for named lock: ${safeKey}`);
  }
}

/**
 * Global singleton instance
 */
let gatekeeperInstance: CompileGatekeeper | null = null;

export function getCompileGatekeeper(maxConcurrent?: number): CompileGatekeeper {
  if (!gatekeeperInstance) {
    gatekeeperInstance = new CompileGatekeeper(maxConcurrent);
  }
  return gatekeeperInstance;
}

export function resetCompileGatekeeper(): void {
  gatekeeperInstance = null;
}
