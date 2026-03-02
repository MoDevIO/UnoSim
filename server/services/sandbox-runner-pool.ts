import { SandboxRunner } from "./sandbox-runner";
import { RegistryManager } from "./registry-manager";
import { Logger } from "@shared/logger";

interface PooledRunner {
  runner: SandboxRunner;
  inUse: boolean;
  lastReleasedTime: number;
}

interface QueueEntry {
  resolve: (runner: SandboxRunner) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class SandboxRunnerPool {
  private readonly numRunners: number;
  private readonly runners: PooledRunner[] = [];
  private readonly queue: QueueEntry[] = [];
  private readonly logger = new Logger("SandboxRunnerPool");
  private readonly acquireTimeoutMs = 60000;
  private initialized = false;

  constructor(numRunners: number = 5) {
    this.numRunners = numRunners;
    this.logger.info(`[SandboxRunnerPool] Initialized with target pool size: ${this.numRunners}`);
  }

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

  async acquireRunner(): Promise<SandboxRunner> {
    if (!this.initialized) {
      throw new Error("SandboxRunnerPool not initialized. Call initialize() first.");
    }

    const available = this.runners.find((p) => !p.inUse);
    if (available) {
      available.inUse = true;
      this.logger.debug(
        `[SandboxRunnerPool] Runner acquired (available: ${this.runners.filter((p) => !p.inUse).length}/${this.numRunners})`,
      );
      return available.runner;
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
        `[SandboxRunnerPool] Runner queued (queue length: ${this.queue.length}/${this.numRunners})`,
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

    await this.resetRunnerState(runner);

    pooledRunner.inUse = false;
    pooledRunner.lastReleasedTime = Date.now();
    this.logger.debug(
      `[SandboxRunnerPool] Runner released and reset (available: ${this.runners.filter((p) => !p.inUse).length}/${this.numRunners})`,
    );

    if (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      clearTimeout(entry.timeout);
      pooledRunner.inUse = true;
      entry.resolve(runner);
      this.logger.debug(
        `[SandboxRunnerPool] Queued request granted (queue: ${this.queue.length} remaining)`,
      );
    }
  }

  private clearRunnerListeners(runner: any): void {
    const safeRemoveAll = (target: any, label: string) => {
      if (!target || typeof target.removeAllListeners !== "function") {
        return;
      }

      try {
        target.removeAllListeners();
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

      const r = runner as any;

      this.clearRunnerListeners(r);

      r.state = "stopped";
      r.processKilled = false;
      r.pauseStartTime = null;
      r.totalPausedTime = 0;
      r.lastPauseTimestamp = null;

      r.pinStateBatcher = null;
      r.serialOutputBatcher = null;

      r.onOutputCallback = null;
      r.outputCallback = null;
      r.errorCallback = null;
      r.telemetryCallback = null;
      r.pinStateCallback = null;
      r.ioRegistryCallback = null;

      r.outputBuffer = "";
      r.errorBuffer = "";
      r.totalOutputBytes = 0;
      r.isSendingOutput = false;

      r.pendingCleanup = false;
      r.cleanupRetries = new Map();
      r.messageQueue = [];

      if (r.flushTimer) {
        clearTimeout(r.flushTimer);
        r.flushTimer = null;
      }

      if (r.fileBuilder && typeof r.fileBuilder.reset === "function") {
        r.fileBuilder.reset();
      }

      if (r.registryManager) {
        try {
          r.registryManager.destroy();
        } catch (error) {
          this.logger.debug(`[SandboxRunnerPool] Error destroying old RegistryManager: ${error}`);
        }
      }

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
      totalRunners: this.numRunners,
      availableRunners: this.runners.filter((p) => !p.inUse).length,
      inUseRunners: this.runners.filter((p) => p.inUse).length,
      queuedRequests: this.queue.length,
      initialized: this.initialized,
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info("[SandboxRunnerPool] Shutting down...");

    for (const entry of this.queue) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("SandboxRunnerPool shutting down"));
    }
    this.queue.length = 0;

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
    poolInstance = new SandboxRunnerPool(5);
  }
  return poolInstance;
}

export async function initializeSandboxRunnerPool(): Promise<void> {
  const pool = getSandboxRunnerPool();
  await pool.initialize();
}
