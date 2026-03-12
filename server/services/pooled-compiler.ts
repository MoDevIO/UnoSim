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

import { CompilationWorkerPool, getCompilationPool, type CompilationTask } from "./compilation-worker-pool";
import { ArduinoCompiler } from "./arduino-compiler";
import type { CompilationResult } from "./arduino-compiler";
import type { CompileRequestOptions } from "./arduino-compiler";

export class PooledCompiler {
  private readonly pool: CompilationWorkerPool | null;
  private readonly directCompiler: ArduinoCompiler | null;
  private readonly usePool: boolean;

  constructor(pool?: CompilationWorkerPool) {
    // Only use worker pool in production (where .js files exist and @shared/* is resolved)
    this.usePool = process.env.NODE_ENV === "production";
    
    if (this.usePool) {
      this.pool = pool ?? getCompilationPool();
      this.directCompiler = null;
    } else {
      // Development mode: use direct compiler (worker threads don't work with tsx/@shared/*)
      this.pool = null;
      this.directCompiler = new ArduinoCompiler();
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
      const task: CompilationTask = { code, headers, tempRoot, ...options };
      return await this.pool.compile(task);
    } else if (this.directCompiler) {
      return await this.directCompiler.compile(code, headers, tempRoot, options);
    } else {
      throw new Error("Neither pool nor direct compiler available");
    }
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
  if (!pooledCompilerInstance) {
    pooledCompilerInstance = new PooledCompiler();
  }
  return pooledCompilerInstance;
}

// setPooledCompiler removed; not needed
