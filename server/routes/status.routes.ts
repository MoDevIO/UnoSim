import type { Express } from "express";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import { getDockerCompileSemaphore } from "../services/sandbox/docker-compile-semaphore";
import { config } from "../config";

export function registerStatusRoutes(app: Express): void {
  app.get("/api/status", (_req, res) => {
    const pool = getSandboxRunnerPool();
    const poolStats = pool.getStats();
    const semaphore = getDockerCompileSemaphore();
    const maxConcurrent = config.compilation.dockerCompileConcurrent;

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      serverMode: config.serverMode,
      simulationMode: config.simulationMode,
      compileWorkers: config.compilation.workerCount,
      compileSlots: {
        active: semaphore.activeCount,
        queued: semaphore.queueLength,
        maxConcurrent,
      },
      sandboxRunners: {
        total: poolStats.totalRunners,
        available: poolStats.availableRunners,
        inUse: poolStats.inUseRunners,
        queued: poolStats.queuedRequests,
        max: poolStats.maxRunners,
      },
      // Backward-compatible aliases (deprecated — prefer compileSlots/sandboxRunners)
      pool: {
        total: poolStats.totalRunners,
        available: poolStats.availableRunners,
        inUse: poolStats.inUseRunners,
        queued: poolStats.queuedRequests,
        max: poolStats.maxRunners,
      },
      compile: {
        active: semaphore.activeCount,
        queued: semaphore.queueLength,
        maxConcurrent,
      },
    });
  });
}
