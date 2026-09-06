/**
 * Tests for server metrics (Phase 3.9 Observability)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  getProcessMetrics, 
  compileMetricsTracker, 
  webSocketMetricsTracker 
} from "../../../server/services/server-metrics";

describe("Server Metrics (Phase 3.9 Observability)", () => {
  beforeEach(() => {
    compileMetricsTracker.reset();
    webSocketMetricsTracker.reset();
  });

  afterEach(() => {
    compileMetricsTracker.reset();
    webSocketMetricsTracker.reset();
  });

  describe("getProcessMetrics", () => {
    it("should return process CPU and memory metrics", () => {
      const metrics = getProcessMetrics();
      
      expect(metrics).toHaveProperty("cpuPercent");
      expect(metrics).toHaveProperty("memoryUsedMB");
      expect(metrics).toHaveProperty("memoryTotalMB");
      expect(metrics).toHaveProperty("memoryPercent");
      expect(metrics).toHaveProperty("uptimeSeconds");
      
      expect(typeof metrics.cpuPercent).toBe("number");
      expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
      
      expect(typeof metrics.memoryUsedMB).toBe("number");
      expect(metrics.memoryUsedMB).toBeGreaterThan(0);
      
      expect(typeof metrics.memoryTotalMB).toBe("number");
      expect(metrics.memoryTotalMB).toBeGreaterThan(0);
      
      expect(typeof metrics.memoryPercent).toBe("number");
      expect(metrics.memoryPercent).toBeGreaterThan(0);
      expect(metrics.memoryPercent).toBeLessThanOrEqual(100);
      
      expect(typeof metrics.uptimeSeconds).toBe("number");
      expect(metrics.uptimeSeconds).toBeGreaterThan(0);
    });

    it("should calculate CPU percentage from two samples", () => {
      // First call initializes baseline
      const metrics1 = getProcessMetrics();
      
      // Second call should have CPU data
      const metrics2 = getProcessMetrics();
      
      // CPU may be 0 if no work was done, but should be valid number
      expect(typeof metrics2.cpuPercent).toBe("number");
      expect(metrics2.cpuPercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe("compileMetricsTracker", () => {
    it("should track compile metrics", () => {
      const startTime = Date.now() - 500; // Simulate 500ms compile time
      const queueWaitTimeMs = 100;
      
      // Simulate compile start
      compileMetricsTracker.recordCompileComplete(startTime, queueWaitTimeMs, true, false);
      
      const metrics = compileMetricsTracker.getMetrics();
      
      expect(metrics.compileCount).toBe(1);
      expect(metrics.compileTimeoutCount).toBe(0);
      expect(metrics.compileErrorCount).toBe(0);
      expect(metrics.avgCompileDurationMs).toBeGreaterThanOrEqual(500);
      expect(metrics.avgQueueWaitTimeMs).toBe(100);
      expect(metrics.maxCompileDurationMs).toBeGreaterThanOrEqual(500);
      expect(metrics.maxQueueWaitTimeMs).toBe(100);
    });

    it("should track compile timeouts", () => {
      const startTime = Date.now() - 1000;
      
      compileMetricsTracker.recordCompileComplete(startTime, 0, false, true);
      
      const metrics = compileMetricsTracker.getMetrics();
      
      expect(metrics.compileCount).toBe(1);
      expect(metrics.compileTimeoutCount).toBe(1);
      expect(metrics.compileErrorCount).toBe(1);
    });

    it("should calculate averages over multiple compiles", () => {
      const now = Date.now();
      
      compileMetricsTracker.recordCompileComplete(now - 100, 10, true, false);
      compileMetricsTracker.recordCompileComplete(now - 200, 20, true, false);
      compileMetricsTracker.recordCompileComplete(now - 300, 30, true, false);
      
      const metrics = compileMetricsTracker.getMetrics();
      
      expect(metrics.compileCount).toBe(3);
      expect(metrics.avgCompileDurationMs).toBeGreaterThan(0);
      expect(metrics.avgQueueWaitTimeMs).toBe(20); // (10+20+30)/3
    });

    it("should reset metrics", () => {
      compileMetricsTracker.recordCompileComplete(Date.now(), 100, true, false);
      compileMetricsTracker.reset();
      
      const metrics = compileMetricsTracker.getMetrics();
      
      expect(metrics.compileCount).toBe(0);
      expect(metrics.compileTimeoutCount).toBe(0);
      expect(metrics.compileErrorCount).toBe(0);
      expect(metrics.avgCompileDurationMs).toBe(0);
      expect(metrics.avgQueueWaitTimeMs).toBe(0);
    });
  });

  describe("webSocketMetricsTracker", () => {
    it("should track WebSocket connections", () => {
      webSocketMetricsTracker.onConnection();
      
      const metrics = webSocketMetricsTracker.getMetrics();
      
      expect(metrics.activeSessions).toBe(1);
      expect(metrics.totalConnections).toBe(1);
      expect(metrics.totalDisconnections).toBe(0);
    });

    it("should track WebSocket disconnections", () => {
      webSocketMetricsTracker.onConnection();
      webSocketMetricsTracker.onDisconnection();
      
      const metrics = webSocketMetricsTracker.getMetrics();
      
      expect(metrics.activeSessions).toBe(0);
      expect(metrics.totalConnections).toBe(1);
      expect(metrics.totalDisconnections).toBe(1);
    });

    it("should track session lifecycle", () => {
      webSocketMetricsTracker.onConnection();
      webSocketMetricsTracker.onSessionStart();
      
      let metrics = webSocketMetricsTracker.getMetrics();
      expect(metrics.runningSessions).toBe(1);
      expect(metrics.pausedSessions).toBe(0);
      
      webSocketMetricsTracker.onSessionPause();
      metrics = webSocketMetricsTracker.getMetrics();
      expect(metrics.runningSessions).toBe(0);
      expect(metrics.pausedSessions).toBe(1);
      
      webSocketMetricsTracker.onSessionStart();
      metrics = webSocketMetricsTracker.getMetrics();
      expect(metrics.runningSessions).toBe(1);
      expect(metrics.pausedSessions).toBe(0);
      
      webSocketMetricsTracker.onSessionStop();
      metrics = webSocketMetricsTracker.getMetrics();
      expect(metrics.runningSessions).toBe(0);
    });

    it("should reset metrics", () => {
      webSocketMetricsTracker.onConnection();
      webSocketMetricsTracker.onSessionStart();
      webSocketMetricsTracker.reset();
      
      const metrics = webSocketMetricsTracker.getMetrics();
      
      expect(metrics.activeSessions).toBe(0);
      expect(metrics.runningSessions).toBe(0);
      expect(metrics.pausedSessions).toBe(0);
      expect(metrics.totalConnections).toBe(0);
    });
  });
});
