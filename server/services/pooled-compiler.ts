/**
 * Compilation Pool Adapter
 * 
 * Wraps the CompilationWorkerPool to provide the same interface
 * as the direct ArduinoCompiler, but routes work through worker threads.
 * 
 * In development mode (tsx), falls back to direct compilation because
 * worker threads don't have access to TypeScript path mappings (@shared/*).
 * In production (transpiled .js), uses worker pool for parallelization.
 * 
 * This allows minimal changes to existing code that expects a `compiler`
 * object with a `compile()` method.
 */

import { CompilationWorkerPool, getCompilationPool } from "./compilation-worker-pool";
import { ArduinoCompiler } from "./arduino-compiler";
import type { CompilationResult, CompileRequestOptions } from "./arduino-compiler";
import type { CompileRequestPayload } from "@shared/worker-protocol";

export class PooledCompiler {
  private readonly pool: CompilationWorkerPool | null;
  private readonly directCompiler: ArduinoCompiler;
  private readonly usePool: boolean;

  constructor(pool?: CompilationWorkerPool) {
    // Always initialize direct compiler as fallback
    this.directCompiler = new ArduinoCompiler();
    
    // Try to use worker pool in production if available
    this.usePool = process.env.NODE_ENV === "production";
    
    if (this.usePool && pool) {
      this.pool = pool;
    } else if (this.usePool) {
      try {
        this.pool = getCompilationPool();
      } catch {
        // Worker pool unavailable (e.g., worker files not found) - fall back to direct compiler
        // This is expected in development mode and is handled gracefully
        this.pool = null;
      }
    } else {
      // Development mode: use direct compiler (worker threads don't work with tsx/@shared/*)
      this.pool = null;
    }
  }

  /**
   * Compile code through the worker pool (production) or directly (development)
   * 
   * Signature matches ArduinoCompiler.compile() for drop-in compatibility
   */
  async compile(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
    options?: CompileRequestOptions,
  ): Promise<CompilationResult> {
    if (this.usePool && this.pool) {
      try {
        const task: CompileRequestPayload = { code, headers, tempRoot, ...options };
        return await this.pool.compile(task);
      } catch {
        // Pool failed to compile (e.g., workers not operational) - fall back to direct compiler
        // This is an expected fallback path when workers are unavailable
        if (!this.directCompiler) {
          throw new Error("Neither pool nor direct compiler available");
        }
        return await this.directCompiler.compile(code, headers, tempRoot, options);
      }
    } else {
      // Fall back to direct compiler (always available)
      if (!this.directCompiler) {
        throw new Error("Neither pool nor direct compiler available");
      }
      return await this.directCompiler.compile(code, headers, tempRoot, options);
    }
  }

  /**
   * Check if worker pool is operational
   */
  isOperational(): boolean {
    return this.usePool && this.pool !== null;
  }

  /**
   * Get current pool statistics (production only)
   */
  getStats() {
    if (this.pool) {
      return this.pool.getStats();
    }
    return {
      activeWorkers: 0,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgCompileTimeMs: 0,
      queuedTasks: 0,
    };
  }

  /**
   * Gracefully shutdown the pool (production only)
   */
  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.shutdown();
    }
  }
}

/**
 * Singleton instance for application-wide use
 */
let pooledCompilerInstance: PooledCompiler | null = null;

export function getPooledCompiler(): PooledCompiler {
  pooledCompilerInstance ??= new PooledCompiler();
  return pooledCompilerInstance;
}

// setPooledCompiler removed; not needed
