import { Router } from "express";
import type { Express } from "express";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import { getDockerCompileSemaphore } from "../services/sandbox/docker-compile-semaphore";
import { config } from "../config";
import { getProcessMetrics, compileMetricsTracker, webSocketMetricsTracker, evaluateObservabilityAlerts } from "../services/server-metrics";
import { getCompilerWithFallback } from "../services/compiler-with-fallback";
import { REST_API_VERSION } from "../services/protocol-version";

// Create router for testing
export const statusRouter = Router();

export function registerStatusRoutes(app: Express): void {
  // Mount router
  app.use("/", statusRouter);
  
  // Also add legacy direct routes for backward compatibility
  app.get("/api/readiness", (_req, res) => {
    const stats = getSandboxRunnerPool().getStats();
    const ready = stats.initialized && stats.sandboxReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "starting",
    });
  });
}

// Define routes on router
statusRouter.get("/api/status", (_req, res) => {
    const pool = getSandboxRunnerPool();
    const poolStats = pool.getStats();
    const semaphore = getDockerCompileSemaphore();
    const maxConcurrent = config.compilation.dockerCompileConcurrent;
    const processMetrics = getProcessMetrics();
    const compileMetrics = compileMetricsTracker.getMetrics();
    const wsMetrics = webSocketMetricsTracker.getMetrics();
    const compilerStats = getCompilerWithFallback().getStats();

    res.json({
      status: "ok",
      apiVersion: REST_API_VERSION,
      timestamp: new Date().toISOString(),
      serverMode: config.serverMode,
      simulationMode: config.simulationMode,
      compileWorkers: config.compilation.workerCount,
      compileSlots: {
        active: semaphore.activeCount,
        queued: semaphore.queueLength,
        maxConcurrent,
      },
      compileWorkerPool: {
        active: compilerStats.activeWorkers,
        queued: compilerStats.queuedTasks,
        totalTasks: compilerStats.totalTasks,
        completedTasks: compilerStats.completedTasks,
        failedTasks: compilerStats.failedTasks,
        avgCompileTimeMs: compilerStats.avgCompileTimeMs,
        maxWorkers: config.compilation.workerCount,
      },
      sandboxRunners: {
        total: poolStats.totalRunners,
        available: poolStats.availableRunners,
        inUse: poolStats.inUseRunners,
        queued: poolStats.queuedRequests,
        max: poolStats.maxRunners,
      },
      // Observability metrics (Phase 3.9)
      webSocketSessions: {
        active: wsMetrics.activeSessions,
        running: wsMetrics.runningSessions,
        paused: wsMetrics.pausedSessions,
        totalConnections: wsMetrics.totalConnections,
        totalDisconnections: wsMetrics.totalDisconnections,
      },
      compileMetrics: {
        count: compileMetrics.compileCount,
        timeoutCount: compileMetrics.compileTimeoutCount,
        errorCount: compileMetrics.compileErrorCount,
        avgDurationMs: compileMetrics.avgCompileDurationMs,
        avgQueueWaitTimeMs: compileMetrics.avgQueueWaitTimeMs,
        maxDurationMs: compileMetrics.maxCompileDurationMs,
        maxQueueWaitTimeMs: compileMetrics.maxQueueWaitTimeMs,
      },
      processMetrics: {
        cpuPercent: processMetrics.cpuPercent,
        memoryUsedMB: processMetrics.memoryUsedMB,
        memoryTotalMB: processMetrics.memoryTotalMB,
        memoryPercent: processMetrics.memoryPercent,
        uptimeSeconds: processMetrics.uptimeSeconds,
      },
      observabilityAlerts: evaluateObservabilityAlerts({
        compileMetrics,
        compileQueueDepth: semaphore.queueLength,
        runnerQueueDepth: poolStats.queuedRequests,
        runnerCapacity: poolStats.maxRunners,
        processMetrics,
      }),
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
