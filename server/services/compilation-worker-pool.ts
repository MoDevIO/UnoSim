/**
 * Compilation Worker Pool
 *
 * Manages a pool of worker threads for parallel C++ compilation.
 * Decouples compilation from the main request thread to prevent blocking.
 *
 * Architecture:
 * - Main Thread (Express): Receives /api/compile request → enqueues work
 * - Worker Threads (N parallel): Each thread runs G++ compile independently
 * - Queue Manager: Distributes work fairly when workers are busy
 *
 * Impact: Reduces compilation latency by ~30% under concurrent load
 * (200 parallel requests sequentially → 4–8 workers process in parallel)
 */

import { Worker } from "node:worker_threads";
import path, { join } from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Logger } from "@shared/logger";
import type { CompilationResult } from "./arduino-compiler";
import {
  type CompileRequestPayload,
  type AnyWorkerMessage,
  type CompileRequestMessage,
  createCompileRequest,
  isReadyMessage,
  isCompileResponse,
} from "@shared/worker-protocol";
import { config } from "../config";
import { compileMetricsTracker } from "./server-metrics";

/**
 * Statistic tracking for monitoring pool health
 */
interface PoolStats {
  activeWorkers: number;
  /** Workers this pool runs (after the safety cap), not the configured value. */
  maxWorkers: number;
  /** Workers currently alive; lower than maxWorkers while a crashed worker restarts. */
  liveWorkers: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgCompileTimeMs: number;
  queuedTasks: number;
}

interface CompilationTask {
  task: CompileRequestPayload;
  resolve: (result: CompilationResult) => void;
  reject: (error: Error) => void;
  startTime: number;
  queueTimer?: NodeJS.Timeout;
}

/**
 * The pool is full or a compile waited too long for a worker. This is
 * backpressure, not a pool failure: callers must not retry it on the main
 * thread, they report the server as busy.
 */
export class CompileCapacityError extends Error {
  readonly name = "CompileCapacityError";
}

/** Same bounds as the unified gatekeeper queue (500 waiting, 30 s wait). */
const DEFAULT_MAX_QUEUE = 500;
const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

export interface CompilationWorkerPoolOptions {
  /** Compiles allowed to wait for a worker; further compiles are rejected. */
  maxQueue?: number;
  /** Longest wait for a worker before a compile is rejected. */
  queueTimeoutMs?: number;
}

interface ActiveCompilation {
  item: CompilationTask;
  compileStartTime: number;
  queueWaitTimeMs: number;
  messageHandler: (msg: AnyWorkerMessage) => void;
}

/**
 * CompilationWorkerPool: Manage parallel compilation across worker threads
 */
export class CompilationWorkerPool {
  private readonly logger = new Logger("CompilationWorkerPool");
  private readonly numWorkers: number;
  private readonly workers: Worker[] = [];
  private readonly liveWorkers = new Set<number>();
  private readonly availableWorkers: Set<number> = new Set();
  private readonly queue: CompilationTask[] = [];
  private readonly activeCompilations = new Map<number, ActiveCompilation>();
  private isInitialized: boolean = false;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;
  private workerScript: string | null = null;
  private shuttingDown = false;
  private readonly restartAttempts = new Map<number, number>();
  private readonly restartTimers = new Map<number, NodeJS.Timeout>();

  private readonly stats = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    compileTimes: [] as number[],
  };

  constructor(numWorkers?: number, options: CompilationWorkerPoolOptions = {}) {
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.queueTimeoutMs = options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
    // With per-worker temp dirs each worker has its own isolated directory,
    // so race conditions in arduino-cli no longer occur.
    // Safe upper bound raised to 8; WORKER_COUNT env var overrides.
    const maxSafeWorkers = 8;
    const recommendedWorkers = Math.max(2, Math.floor(os.cpus().length * 0.5));
    const configuredWorkers = config.compilation.workerCount ?? recommendedWorkers;
    this.numWorkers = numWorkers ?? Math.min(maxSafeWorkers, configuredWorkers);
    if (numWorkers === undefined && configuredWorkers > maxSafeWorkers) {
      this.logger.warn(
        `[CompilationWorkerPool] WORKER_COUNT=${configuredWorkers} exceeds the safe maximum; running ${maxSafeWorkers} workers`,
      );
    }

    this.logger.info(
      `[CompilationWorkerPool] Initializing with ${this.numWorkers} workers (max: ${maxSafeWorkers})`,
    );
    this.initializeWorkers();
  }

  /**
   * Initialize all worker threads
   */
  private initializeWorkers(): void {
    // In development, workers are .ts; in production, they're .js after transpilation
    const dirname = path.dirname(new URL(import.meta.url).pathname);

    // Try .js first (production), fallback to .ts (development with tsx)
    let workerScript = path.join(dirname, "workers", "compile-worker.js");
    if (!fs.existsSync(workerScript)) {
      workerScript = path.join(dirname, "workers", "compile-worker.ts");
    }

    // Validate worker file exists
    if (!fs.existsSync(workerScript)) {
      this.logger.error(
        `[CompilationWorkerPool] Worker file not found: ${workerScript}`,
      );
      this.logger.warn(
        `[CompilationWorkerPool] Worker pool disabled - falling back to synchronous compilation`,
      );
      // Don't throw - let CompilerWithFallback handle fallback to direct compiler
      return;
    }

    this.logger.info(
      `[CompilationWorkerPool] Using worker script: ${workerScript}`,
    );

    this.workerScript = workerScript;
    for (let i = 0; i < this.numWorkers; i++) {
      this.startWorker(i);
    }

    this.logger.info(
      `[CompilationWorkerPool] ${this.liveWorkers.size} workers started`,
    );
    this.isInitialized = true;
  }

  /** Starts (or restarts) the worker with the given slot id. */
  private startWorker(workerId: number): void {
    if (!this.workerScript) return;
    try {
      // Each worker gets its own temp directory to avoid arduino-cli race conditions
      const workerTempRoot = join(os.tmpdir(), `unosim-worker-${workerId}`);
      const worker = new Worker(this.workerScript, {
        workerData: {
          workerId: workerId + 1,
          tempRoot: workerTempRoot,
          compilation: {
            buildCacheDir: config.compilation.buildCacheDir,
            buildCacheMaxBytes: config.compilation.buildCacheMaxBytes,
            fqbn: config.compilation.fqbn,
          },
        },
      });
      // A replaced worker's late events must not touch its successor in the same slot.
      const isCurrent = () => this.workers[workerId] === worker;

      worker.on("message", (msg: AnyWorkerMessage) => {
        if (isCurrent() && isReadyMessage(msg)) {
          if (
            this.liveWorkers.has(workerId) &&
            !this.activeCompilations.has(workerId)
          ) {
            this.availableWorkers.add(workerId);
          }
          this.logger.debug(`[Worker ${workerId}] Ready`);
          this.processQueue();
        }
      });

      worker.on("error", (err) => {
        if (!isCurrent()) return;
        this.logger.error(`[Worker ${workerId}] Error (${err.name})`);
        this.handleWorkerFailure(workerId, err);
      });

      worker.on("exit", (code) => {
        if (!isCurrent()) return;
        this.logger.warn(`[Worker ${workerId}] Exited with code ${code}`);
        this.handleWorkerFailure(
          workerId,
          new Error(
            `Compilation worker ${workerId} exited with code ${code}`,
          ),
        );
      });

      this.workers[workerId] = worker;
      this.liveWorkers.add(workerId);
      this.logger.debug(`[Worker ${workerId}] Started`);
    } catch (err) {
      this.logger.error(
        `Failed to start worker ${workerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Restarts a failed worker with exponential backoff (1 s … 30 s); never during shutdown. */
  private scheduleRestart(workerId: number): void {
    if (this.shuttingDown || this.restartTimers.has(workerId)) return;
    const attempts = this.restartAttempts.get(workerId) ?? 0;
    const delayMs = Math.min(1_000 * 2 ** attempts, 30_000);
    this.restartAttempts.set(workerId, attempts + 1);
    const timer = setTimeout(() => {
      this.restartTimers.delete(workerId);
      if (this.shuttingDown) return;
      this.logger.warn(`[CompilationWorkerPool] Restarting worker ${workerId} (attempt ${attempts + 1})`);
      this.startWorker(workerId);
    }, delayMs);
    timer.unref?.();
    this.restartTimers.set(workerId, timer);
  }

  /**
   * Check if the pool is operational
   */
  isOperational(): boolean {
    return this.isInitialized && this.liveWorkers.size > 0;
  }

  /**
   * Enqueue a compilation task
   */
  async compile(task: CompileRequestPayload): Promise<CompilationResult> {
    if (!this.isOperational()) {
      throw new Error(
        "Compilation worker pool is not operational. Worker files may not be available.",
      );
    }

    if (this.availableWorkers.size === 0 && this.queue.length >= this.maxQueue) {
      throw new CompileCapacityError(`Compile queue full (${this.maxQueue} waiting)`);
    }
    this.stats.totalTasks++;

    return new Promise((resolve, reject) => {
      const item: CompilationTask = {
        task,
        resolve,
        reject,
        startTime: Date.now(),
      };
      item.queueTimer = setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.stats.failedTasks++;
        reject(new CompileCapacityError(`No compile worker became free within ${this.queueTimeoutMs}ms`));
      }, this.queueTimeoutMs);
      this.queue.push(item);

      this.processQueue();
    });
  }

  /**
   * Process queued tasks using available workers
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.availableWorkers.size > 0) {
      const workerId = this.availableWorkers.values().next().value as number;
      const queueItem = this.queue.shift();

      if (!queueItem) break;
      clearTimeout(queueItem.queueTimer);

      const { task, resolve, reject, startTime } = queueItem;
      this.availableWorkers.delete(workerId);

      const worker = this.workers[workerId];
      const queueWaitTimeMs = Date.now() - startTime;
      const compileStartTime = Date.now();

      // Set up one-time message handler for this specific task
      const messageHandler = (msg: AnyWorkerMessage) => {
        if (isCompileResponse(msg)) {
          const { payload } = msg;

          if (payload.error) {
            this.stats.failedTasks++;
            compileMetricsTracker.recordCompileComplete(
              compileStartTime,
              queueWaitTimeMs,
              false,
              payload.error.message?.toLowerCase().includes("timeout") === true,
            );
            const errorMsg = payload.error.message || "Unknown worker error";
            const error = new Error(errorMsg);
            if (payload.error.stack) {
              error.stack = payload.error.stack;
            }
            reject(error);
          } else if (payload.result) {
            this.restartAttempts.delete(workerId);
            const compileTimeMs = Date.now() - compileStartTime;
            compileMetricsTracker.recordCompileComplete(
              compileStartTime,
              queueWaitTimeMs,
              payload.result.success,
              !payload.result.success && `${payload.result.stderr ?? ""} ${payload.result.errors.map((err) => err.message).join(" ")}`.toLowerCase().includes("timeout"),
            );
            this.stats.completedTasks++;
            this.stats.compileTimes.push(compileTimeMs);
            this.logger.info(
              `[Worker ${workerId}] Compiled in ${compileTimeMs}ms`,
            );
            resolve(payload.result);
          } else {
            // Malformed response
            this.stats.failedTasks++;
            compileMetricsTracker.recordCompileComplete(
              compileStartTime,
              queueWaitTimeMs,
              false,
              false,
            );
            reject(new Error("Worker returned malformed response"));
          }

          // Clean up listener and mark worker as available
          worker.off("message", messageHandler);
          this.activeCompilations.delete(workerId);
          if (this.liveWorkers.has(workerId)) {
            this.availableWorkers.add(workerId);
          }
          this.processQueue(); // Process next in queue
        }
      };

      this.activeCompilations.set(workerId, {
        item: { task, resolve, reject, startTime },
        compileStartTime,
        queueWaitTimeMs,
        messageHandler,
      });
      worker.on("message", messageHandler);

      // Send compile task to worker using strict protocol
      const message: CompileRequestMessage = createCompileRequest(task);
      worker.postMessage(message);
    }
  }

  private handleWorkerFailure(workerId: number, error: Error): void {
    const wasLive = this.liveWorkers.has(workerId);
    this.liveWorkers.delete(workerId);
    this.availableWorkers.delete(workerId);

    const active = this.activeCompilations.get(workerId);
    if (active) {
      this.workers[workerId]?.off("message", active.messageHandler);
      this.activeCompilations.delete(workerId);
      this.stats.failedTasks++;
      compileMetricsTracker.recordCompileComplete(
        active.compileStartTime,
        active.queueWaitTimeMs,
        false,
        error.message.toLowerCase().includes("timeout"),
      );
      active.item.reject(error);
    }

    if (this.liveWorkers.size === 0 && this.queue.length > 0) {
      const queued = this.queue.splice(0);
      this.stats.failedTasks += queued.length;
      for (const item of queued) {
        clearTimeout(item.queueTimer);
        item.reject(
          new Error("Compilation worker pool has no operational workers"),
        );
      }
    }

    if (wasLive) this.scheduleRestart(workerId);
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const compileTimes = this.stats.compileTimes;
    const avgCompileTimeMs =
      compileTimes.length > 0
        ? compileTimes.reduce((a, b) => a + b, 0) / compileTimes.length
        : 0;

    return {
      activeWorkers: this.activeCompilations.size,
      maxWorkers: this.numWorkers,
      liveWorkers: this.liveWorkers.size,
      totalTasks: this.stats.totalTasks,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      avgCompileTimeMs,
      queuedTasks: this.queue.length,
    };
  }

  /**
   * Gracefully shut down the pool
   */
  async shutdown(): Promise<void> {
    this.logger.info("[CompilationWorkerPool] Shutting down...");
    this.isInitialized = false;
    this.shuttingDown = true;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();

    const shutdownError = new Error("Compilation worker pool is shutting down");
    for (const item of this.queue.splice(0)) {
      clearTimeout(item.queueTimer);
      item.reject(shutdownError);
    }
    for (const [workerId, active] of this.activeCompilations) {
      this.workers[workerId]?.off("message", active.messageHandler);
      active.item.reject(shutdownError);
    }
    this.activeCompilations.clear();
    this.availableWorkers.clear();
    this.liveWorkers.clear();

    const promises = this.workers.map((worker, idx) => {
      return worker
        .terminate()
        .then(() => {
          this.logger.debug(`[Worker ${idx}] Terminated`);
        })
        .catch((err) => {
          this.logger.error(
            `[Worker ${idx}] Termination error: ${err.message}`,
          );
        });
    });
    await Promise.all(promises);
    this.logger.info("[CompilationWorkerPool] Shutdown complete");
  }
}

/**
 * Singleton instance
 */
let poolInstance: CompilationWorkerPool | null = null;

export function getCompilationPool(): CompilationWorkerPool {
  poolInstance ??= new CompilationWorkerPool();
  return poolInstance;
}
