import { Router } from "express";
import type { Express } from "express";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import { getSandboxStartSemaphore } from "../services/sandbox/docker-compile-semaphore";
import { config } from "../config";
import { getProcessMetrics, compileMetricsTracker, webSocketMetricsTracker, evaluateObservabilityAlerts } from "../services/server-metrics";
import { getCompilerWithFallback } from "../services/compiler-with-fallback";
import { REST_API_VERSION } from "../services/protocol-version";
import { getCompileRateLimiter, getSimulationRateLimiter } from "../services/rate-limiter";
import { getSimulationAdmissionController } from "../services/simulation-admission-controller";

export const statusRouter = Router();

export function registerStatusRoutes(app: Express): void {
  app.use("/", statusRouter);
  app.get("/api/readiness", (_req, res) => {
    const stats = getSandboxRunnerPool().getStats();
    const ready = stats.initialized && stats.sandboxReady;
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "starting" });
  });
}

statusRouter.get("/api/status", (_req, res) => {
  const pool = getSandboxRunnerPool();
  const poolStats = pool.getStats();
  const sandboxStart = getSandboxStartSemaphore();
  const processMetrics = getProcessMetrics();
  const compileMetrics = compileMetricsTracker.getMetrics();
  const wsMetrics = webSocketMetricsTracker.getMetrics();
  const compilerStats = getCompilerWithFallback().getStats();
  const compileRateStats = getCompileRateLimiter().getStats();
  const simulationRateStats = getSimulationRateLimiter().getStats();
  const admissionStats = getSimulationAdmissionController().getStats();
  const compileMaxConcurrent = config.compilation.maxConcurrent;

  res.json({
    status: "ok",
    apiVersion: REST_API_VERSION,
    timestamp: new Date().toISOString(),
    serverMode: config.serverMode,
    capacity: {
      simulation: {
        maxConcurrent: config.capacity.simulationMaxConcurrent,
        active: poolStats.inUseRunners,
      },
      sandboxStart: {
        maxConcurrent: config.capacity.sandboxStartMaxConcurrent,
        active: sandboxStart.activeCount,
        waiting: sandboxStart.queueLength,
      },
      admission: {
        max: config.capacity.admissionMax,
        current: admissionStats.active,
      },
      queue: {
        waiting: poolStats.queuedRequests,
        timeoutMs: config.capacity.queueTimeoutMs,
      },
      compile: {
        maxConcurrent: compileMaxConcurrent,
        active: compilerStats.activeWorkers,
      },
    },
    // Legacy fields remain for clients that have not migrated to capacity.*.
    compileWorkers: config.compilation.workerCount,
    compileSlots: {
      active: sandboxStart.activeCount,
      queued: sandboxStart.queueLength,
      maxConcurrent: config.capacity.sandboxStartMaxConcurrent,
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
      min: poolStats.minRunners,
      available: poolStats.availableRunners,
      inUse: poolStats.inUseRunners,
      queued: poolStats.queuedRequests,
      max: poolStats.maxRunners,
    },
    admissionControl: admissionStats,
    ...(config.nodeEnv === "test" && config.capacityTestRunId ? { capacityTestRunId: config.capacityTestRunId } : {}),
    rateLimits: {
      compile: { blockedIdentities: compileRateStats.blockedClients, rejectedTotal: compileRateStats.rejectedTotal },
      simulationStart: { blockedIdentities: simulationRateStats.blockedClients, rejectedTotal: simulationRateStats.rejectedTotal },
    },
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
      compileQueueDepth: sandboxStart.queueLength,
      runnerQueueDepth: poolStats.queuedRequests,
      runnerCapacity: poolStats.maxRunners,
      processMetrics,
    }),
    /** @deprecated Use capacity.simulation instead. */
    pool: {
      total: poolStats.totalRunners,
      available: poolStats.availableRunners,
      inUse: poolStats.inUseRunners,
      queued: poolStats.queuedRequests,
      max: poolStats.maxRunners,
    },
    /** @deprecated Use capacity.sandboxStart instead. */
    compile: {
      active: sandboxStart.activeCount,
      queued: sandboxStart.queueLength,
      maxConcurrent: config.capacity.sandboxStartMaxConcurrent,
    },
  });
});
