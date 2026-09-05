import type { Express } from "express";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import { getDockerCompileSemaphore } from "../services/sandbox/docker-compile-semaphore";
import { config } from "../config";

export function registerStatusRoutes(app: Express): void {
  app.get("/api/readiness", (_req, res) => {
    const stats = getSandboxRunnerPool().getStats();
    const ready = stats.initialized && stats.sandboxReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "starting",
    });
  });

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
      /**
       * @deprecated Use compileSlots instead. Will be removed in next major release.
       */
      pool: {
        total: poolStats.totalRunners,
        available: poolStats.availableRunners,
        inUse: poolStats.inUseRunners,
        queued: poolStats.queuedRequests,
        max: poolStats.maxRunners,
      },
      /**
       * @deprecated Use compileSlots instead. Will be removed in next major release.
       */
      compile: {
        active: semaphore.activeCount,
        queued: semaphore.queueLength,
        maxConcurrent,
      },
    });
  });
}
