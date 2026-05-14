/**
 * CompilerWithFallback — Adapter that routes compile work to the worker pool
 * (production) or to the in-process ArduinoCompiler (development).
 *
 * NOTE: This is NOT the worker pool itself. The pool lives in
 *       `compilation-worker-pool.ts`. This class is the adapter that picks
 *       a backend at runtime and exposes a `compile()` method that matches
 *       ArduinoCompiler for drop-in compatibility.
 *
 * Mode selection:
 *   • production (server runs in docker)      → CompilationWorkerPool
 *   • development (tsx, worker @shared/* fail) → direct ArduinoCompiler fallback
 *
 * Renamed from `PooledCompiler` — the old name suggested this class WAS the
 * pool, which was misleading.
 */

import { CompilationWorkerPool, getCompilationPool } from "./compilation-worker-pool";
import { ArduinoCompiler } from "./arduino-compiler";
import type { CompilationResult, CompileRequestOptions } from "./arduino-compiler";
import type { CompileRequestPayload } from "@shared/worker-protocol";
import { config } from "../config";

export class CompilerWithFallback {
  private readonly pool: CompilationWorkerPool | null;
  private readonly directCompiler: ArduinoCompiler;
  private readonly usePool: boolean;

  constructor(pool?: CompilationWorkerPool) {
    // Always initialize direct compiler as fallback
    this.directCompiler = new ArduinoCompiler();
    
    // Try to use worker pool in production if available
    this.usePool = config.serverMode === "docker";
    
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
let compilerInstance: CompilerWithFallback | null = null;

export function getCompilerWithFallback(): CompilerWithFallback {
  compilerInstance ??= new CompilerWithFallback();
  return compilerInstance;
}

// setCompilerWithFallback removed; not needed
