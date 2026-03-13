/**
 * Compile Gatekeeper - Backward Compatibility Layer
 * 
 * Delegates to UnifiedGatekeeper for centralized concurrency management.
 * This maintains backward compatibility while using the new unified system internally.
 */

import { Logger } from "@shared/logger";
import { getUnifiedGatekeeper, TaskPriority } from "./unified-gatekeeper";

class CompileGatekeeper {
  private logger = new Logger("CompileGatekeeper");
  private readonly maxConcurrent: number;

  constructor(maxConcurrent?: number) {
    // In worker threads, disable gatekeeper since the worker pool controls concurrency
    const isWorkerThread = process.env.COMPILE_GATEKEEPER_DISABLED === "true";
    
    if (isWorkerThread) {
      this.maxConcurrent = Infinity;
      this.logger.debug(
        `CompileGatekeeper in worker thread - gatekeeper disabled (pool controls concurrency)`,
      );
    } else {
      this.maxConcurrent =
        maxConcurrent || parseInt(process.env.COMPILE_MAX_CONCURRENT || "4", 10);

      this.logger.info(
        `CompileGatekeeper initialized with max ${this.maxConcurrent} concurrent compiles`,
      );
    }
  }

  /**
   * Acquire a compile slot with HIGH priority (for interactive simulations)
   * Ensures user-initiated actions get prompt access
   */
  async acquireHighPriority(): Promise<() => void> {
    const unified = getUnifiedGatekeeper(this.maxConcurrent);
    return await unified.acquireCompileSlotHighPriority("simulation-start");
  }

  /**
   * Acquire a compile slot with NORMAL priority (backward compatibility)
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
    const unified = getUnifiedGatekeeper(this.maxConcurrent);
    return await unified.acquireCompileSlot(TaskPriority.NORMAL, 30000, "compile-gatekeeper");
  }

  /**
   * Get current gatekeeper statistics for monitoring/debugging
   */
  getStats() {
    const unified = getUnifiedGatekeeper(this.maxConcurrent);
    const unifiedStats = unified.getStats();
    return {
      maxConcurrent: unifiedStats.maxConcurrentCompiles,
      available: unifiedStats.availableSlots,
      active: unifiedStats.activeCompiles,
      queued: unifiedStats.queuedCompiles,
    };
  }

  /**
   * Gracefully drain the queue and wait for all active compiles to finish.
   * Useful for shutdown scenarios.
   */
  async drain(): Promise<void> {
    const unified = getUnifiedGatekeeper(this.maxConcurrent);
    await unified.drain();
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

