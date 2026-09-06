/**
 * Server Process Metrics
 * 
 * Tracks CPU and memory usage of the Node.js server process.
 * Uses built-in process.cpuUsage() and process.memoryUsage() APIs.
 */

import { Logger } from "@shared/logger";

const logger = new Logger("ServerMetrics");

interface ProcessMetrics {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryPercent: number;
  uptimeSeconds: number;
}

interface CpuUsageSample {
  user: number;
  system: number;
  timestamp: number;
}

let previousCpuSample: CpuUsageSample | null = null;

/**
 * Get current CPU and memory usage of the Node.js process
 */
export function getProcessMetrics(): ProcessMetrics {
  const now = Date.now();
  
  // Memory usage
  const memUsage = process.memoryUsage();
  const memoryUsedMB = memUsage.heapUsed / (1024 * 1024);
  const memoryTotalMB = osTotalMemoryMB();
  const memoryPercent = (memoryUsedMB / memoryTotalMB) * 100;
  
  // CPU usage (requires two samples)
  const cpuUsage = process.cpuUsage();
  let cpuPercent = 0;
  
  if (previousCpuSample !== null) {
    const elapsedMs = now - previousCpuSample.timestamp;
    const elapsedNs = elapsedMs * 1_000_000; // Convert to nanoseconds
    
    const userDiff = cpuUsage.user - previousCpuSample.user;
    const systemDiff = cpuUsage.system - previousCpuSample.system;
    const totalDiff = userDiff + systemDiff;
    
    // CPU percentage across all cores
    cpuPercent = (totalDiff / elapsedNs) * 100;
  }
  
  // Store sample for next calculation
  previousCpuSample = {
    user: cpuUsage.user,
    system: cpuUsage.system,
    timestamp: now,
  };
  
  return {
    cpuPercent,
    memoryUsedMB,
    memoryTotalMB,
    memoryPercent,
    uptimeSeconds: process.uptime(),
  };
}

/**
 * Get total system memory in MB
 */
function osTotalMemoryMB(): number {
  return os.totalmem() / (1024 * 1024);
}

// Import os module
import os from "node:os";

/**
 * Track compilation metrics (duration, queue wait time)
 */
export interface CompileMetrics {
  compileCount: number;
  compileTimeoutCount: number;
  compileErrorCount: number;
  avgCompileDurationMs: number;
  avgQueueWaitTimeMs: number;
  maxCompileDurationMs: number;
  maxQueueWaitTimeMs: number;
}

class CompileMetricsTracker {
  private compileCount = 0;
  private compileTimeoutCount = 0;
  private compileErrorCount = 0;
  private totalCompileDurationMs = 0;
  private totalQueueWaitTimeMs = 0;
  private maxCompileDurationMs = 0;
  private maxQueueWaitTimeMs = 0;
  
  recordCompileStart(): number {
    return Date.now();
  }
  
  recordCompileComplete(startTime: number, queueWaitTimeMs: number, success: boolean, timedOut: boolean): void {
    const duration = Date.now() - startTime;
    
    this.compileCount++;
    this.totalCompileDurationMs += duration;
    this.totalQueueWaitTimeMs += queueWaitTimeMs;
    
    if (duration > this.maxCompileDurationMs) {
      this.maxCompileDurationMs = duration;
    }
    if (queueWaitTimeMs > this.maxQueueWaitTimeMs) {
      this.maxQueueWaitTimeMs = queueWaitTimeMs;
    }
    
    if (timedOut) {
      this.compileTimeoutCount++;
    }
    if (!success) {
      this.compileErrorCount++;
    }
    
    logger.debug(`[CompileMetrics] Compile completed: ${duration.toFixed(0)}ms (queue: ${queueWaitTimeMs.toFixed(0)}ms, success: ${success})`);
  }
  
  getMetrics(): CompileMetrics {
    return {
      compileCount: this.compileCount,
      compileTimeoutCount: this.compileTimeoutCount,
      compileErrorCount: this.compileErrorCount,
      avgCompileDurationMs: this.compileCount > 0 
        ? this.totalCompileDurationMs / this.compileCount 
        : 0,
      avgQueueWaitTimeMs: this.compileCount > 0 
        ? this.totalQueueWaitTimeMs / this.compileCount 
        : 0,
      maxCompileDurationMs: this.maxCompileDurationMs,
      maxQueueWaitTimeMs: this.maxQueueWaitTimeMs,
    };
  }
  
  reset(): void {
    this.compileCount = 0;
    this.compileTimeoutCount = 0;
    this.compileErrorCount = 0;
    this.totalCompileDurationMs = 0;
    this.totalQueueWaitTimeMs = 0;
    this.maxCompileDurationMs = 0;
    this.maxQueueWaitTimeMs = 0;
  }
}

export const compileMetricsTracker = new CompileMetricsTracker();

/**
 * Track WebSocket session metrics
 */
export interface WebSocketMetrics {
  activeSessions: number;
  runningSessions: number;
  pausedSessions: number;
  totalConnections: number;
  totalDisconnections: number;
}

class WebSocketMetricsTracker {
  private activeSessions = 0;
  private runningSessions = 0;
  private pausedSessions = 0;
  private totalConnections = 0;
  private totalDisconnections = 0;
  
  onConnection(): void {
    this.activeSessions++;
    this.totalConnections++;
    logger.debug(`[WebSocketMetrics] Connection: ${this.activeSessions} active, ${this.totalConnections} total`);
  }
  
  onDisconnection(): void {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    this.totalDisconnections++;
    logger.debug(`[WebSocketMetrics] Disconnection: ${this.activeSessions} active, ${this.totalDisconnections} total`);
  }
  
  onSessionStart(): void {
    this.runningSessions++;
    this.pausedSessions = Math.max(0, this.pausedSessions - 1);
  }
  
  onSessionPause(): void {
    this.runningSessions = Math.max(0, this.runningSessions - 1);
    this.pausedSessions++;
  }
  
  onSessionStop(): void {
    this.runningSessions = Math.max(0, this.runningSessions - 1);
  }
  
  getMetrics(): WebSocketMetrics {
    return {
      activeSessions: this.activeSessions,
      runningSessions: this.runningSessions,
      pausedSessions: this.pausedSessions,
      totalConnections: this.totalConnections,
      totalDisconnections: this.totalDisconnections,
    };
  }
  
  reset(): void {
    this.activeSessions = 0;
    this.runningSessions = 0;
    this.pausedSessions = 0;
    this.totalConnections = 0;
    this.totalDisconnections = 0;
  }
}

export const webSocketMetricsTracker = new WebSocketMetricsTracker();
