/**
 * Compilation Pool Adapter
 * 
 * Wraps the CompilationWorkerPool to provide the same interface
 * as the direct ArduinoCompiler, but routes work through worker threads.
 * 
 * This allows minimal changes to existing code that expects a `compiler`
 * object with a `compile()` method.
 */

import { CompilationWorkerPool, getCompilationPool, type CompilationTask } from "./compilation-worker-pool";
import type { CompilationResult } from "./arduino-compiler";

export class PooledCompiler {
  private readonly pool: CompilationWorkerPool;

  constructor(pool?: CompilationWorkerPool) {
    this.pool = pool ?? getCompilationPool();
  }

  /**
   * Compile code through the worker pool
   * 
   * Signature matches ArduinoCompiler.compile() for drop-in compatibility
   */
  async compile(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
  ): Promise<CompilationResult> {
    const task: CompilationTask = { code, headers, tempRoot };
    return await this.pool.compile(task);
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return this.pool.getStats();
  }

  /**
   * Gracefully shutdown the pool
   */
  async shutdown(): Promise<void> {
    await this.pool.shutdown();
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

export function setPooledCompiler(compiler: PooledCompiler): void {
  pooledCompilerInstance = compiler;
}
