/**
 * Integration tests for /api/status endpoint with Phase 3.9 Observability metrics
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import express from "express";
import { statusRouter } from "../../../server/routes/status.routes";

describe("GET /api/status - Phase 3.9 Observability Metrics", () => {
  let app: express.Application;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    // Mount status router
    app.use("/", statusRouter);
    
    // Start server on random port
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    
    const address = server.address();
    if (typeof address === "string") {
      baseUrl = address;
    } else {
      baseUrl = `http://localhost:${address?.port}`;
    }
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
  });

  it("should return status with Phase 3.9 observability metrics", async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    // Basic status fields
    expect(data.status).toBe("ok");
    expect(data.apiVersion).toBe("1.0.0");
    expect(data).toHaveProperty("timestamp");
    
    // Phase 3.9: WebSocket Sessions metrics
    expect(data).toHaveProperty("webSocketSessions");
    expect(data.webSocketSessions).toHaveProperty("active");
    expect(data.webSocketSessions).toHaveProperty("running");
    expect(data.webSocketSessions).toHaveProperty("paused");
    expect(data.webSocketSessions).toHaveProperty("totalConnections");
    expect(data.webSocketSessions).toHaveProperty("totalDisconnections");
    
    // Phase 3.9: Compile metrics
    expect(data).toHaveProperty("compileMetrics");
    expect(data.compileMetrics).toHaveProperty("count");
    expect(data.compileMetrics).toHaveProperty("timeoutCount");
    expect(data.compileMetrics).toHaveProperty("errorCount");
    expect(data.compileMetrics).toHaveProperty("avgDurationMs");
    expect(data.compileMetrics).toHaveProperty("avgQueueWaitTimeMs");
    expect(data.compileMetrics).toHaveProperty("maxDurationMs");
    expect(data.compileMetrics).toHaveProperty("maxQueueWaitTimeMs");
    
    // Phase 3.9: Process metrics
    expect(data).toHaveProperty("processMetrics");
    expect(data.processMetrics).toHaveProperty("cpuPercent");
    expect(data.processMetrics).toHaveProperty("memoryUsedMB");
    expect(data.processMetrics).toHaveProperty("memoryTotalMB");
    expect(data.processMetrics).toHaveProperty("memoryPercent");
    expect(data.processMetrics).toHaveProperty("uptimeSeconds");
    
    // Type checks
    expect(typeof data.webSocketSessions.active).toBe("number");
    expect(typeof data.webSocketSessions.running).toBe("number");
    expect(typeof data.webSocketSessions.paused).toBe("number");
    expect(typeof data.webSocketSessions.totalConnections).toBe("number");
    expect(typeof data.webSocketSessions.totalDisconnections).toBe("number");
    
    expect(typeof data.compileMetrics.count).toBe("number");
    expect(typeof data.compileMetrics.timeoutCount).toBe("number");
    expect(typeof data.compileMetrics.errorCount).toBe("number");
    expect(typeof data.compileMetrics.avgDurationMs).toBe("number");
    expect(typeof data.compileMetrics.avgQueueWaitTimeMs).toBe("number");
    
    expect(typeof data.processMetrics.cpuPercent).toBe("number");
    expect(typeof data.processMetrics.memoryUsedMB).toBe("number");
    expect(typeof data.processMetrics.memoryTotalMB).toBe("number");
    expect(typeof data.processMetrics.memoryPercent).toBe("number");
    expect(typeof data.processMetrics.uptimeSeconds).toBe("number");
  });

  it("should maintain backward compatibility with deprecated pool/compile aliases", async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    const data = await response.json();
    
    // Backward compatibility: deprecated aliases should still exist
    expect(data).toHaveProperty("pool");
    expect(data.pool).toHaveProperty("available");
    expect(data.pool).toHaveProperty("inUse");
    expect(data.pool).toHaveProperty("queued");
    expect(data.pool).toHaveProperty("max");
    
    expect(data).toHaveProperty("compile");
    expect(data.compile).toHaveProperty("active");
    expect(data.compile).toHaveProperty("queued");
    expect(data.compile).toHaveProperty("maxConcurrent");
  });

  it("should return valid CPU and memory ranges", async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    const data = await response.json();
    
    const { cpuPercent, memoryUsedMB, memoryTotalMB, memoryPercent } = data.processMetrics;
    
    expect(cpuPercent).toBeGreaterThanOrEqual(0);
    expect(memoryUsedMB).toBeGreaterThan(0);
    expect(memoryTotalMB).toBeGreaterThan(0);
    expect(memoryPercent).toBeGreaterThan(0);
    expect(memoryPercent).toBeLessThanOrEqual(100);
    expect(memoryUsedMB).toBeLessThanOrEqual(memoryTotalMB);
  });
});
