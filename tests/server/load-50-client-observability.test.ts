/**
 * 50-Client Real Docker Load Test with Phase 3.9 Observability Metrics
 * 
 * Usage:
 *   LOAD_TEST_REAL_SERVER=true LOAD_TEST_SERVER_URL=http://localhost:5173 \
 *   npx vitest run tests/server/load-50-client-observability.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

function getTestCode(clientId: number): string {
  // Unique code per client to bypass server cache
  // Cache hash includes full code, so even small changes force recompilation
  // Use per-client timestamp to ensure uniqueness even with concurrent clients
  const timestamp = Date.now();
  const uniqueId = `${clientId}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  
  return `
// Test Client: ${clientId}
// Unique identifier: ${uniqueId}

void setup() {
  Serial.begin(115200);
  Serial.println("Client ${clientId} starting...");
  Serial.println("Unique ID: ${uniqueId}");
}

void loop() {
  delay(100);
  Serial.print("Client ${clientId}: ");
  Serial.println(millis());
}
`;
}

interface ClientMetrics {
  clientId: number;
  fetchSketchTime: number;
  compileTime: number;
  startSimTime: number;
  totalTime: number;
  success: boolean;
  error?: string;
  cached?: boolean; // Track if compile was cached
}

interface ServerMetricsSnapshot {
  timestamp: string;
  webSocketSessions: {
    active: number;
    running: number;
    paused: number;
    totalConnections: number;
    totalDisconnections: number;
  };
  compileMetrics: {
    count: number;
    timeoutCount: number;
    errorCount: number;
    avgDurationMs: number;
    avgQueueWaitTimeMs: number;
    maxDurationMs: number;
    maxQueueWaitTimeMs: number;
  };
  processMetrics: {
    cpuPercent: number;
    memoryUsedMB: number;
    memoryTotalMB: number;
    memoryPercent: number;
    uptimeSeconds: number;
  };
  compileSlots: {
    active: number;
    queued: number;
    maxConcurrent: number;
  };
  compileWorkerPool?: {
    active: number;
    queued: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgCompileTimeMs: number;
    maxWorkers: number;
  };
  sandboxRunners: {
    total: number;
    available: number;
    inUse: number;
    queued: number;
    max: number;
  };
}

interface TestResult {
  testName: string;
  totalClients: number;
  successful: number;
  failed: number;
  successRate: number;
  cacheHits: number;
  cacheMisses: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  serverMetricsStart?: ServerMetricsSnapshot;
  serverMetricsEnd?: ServerMetricsSnapshot;
  serverMetricsPeak?: {
    maxCpuPercent: number;
    maxMemoryPercent: number;
    maxActiveSessions: number;
    maxCompileQueue: number;
    maxRunnerQueue: number;
  };
  clientMetrics: ClientMetrics[];
}

function fetchHttp(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: options?.method || "GET",
        headers: options?.headers || {},
      },
      async (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            ok: (res.statusCode ?? 200) >= 200 && (res.statusCode ?? 200) < 300,
            status: res.statusCode ?? 200,
            json: async () => JSON.parse(data),
            text: async () => data,
          });
        });
      },
    );
    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

async function getServerMetrics(apiBase: string): Promise<ServerMetricsSnapshot> {
  const gatewaySecret = process.env.UNOSIM_GATEWAY_SECRET || "test-secret-for-load-testing-32-chars";
  const response = await fetchHttp(`${apiBase}/api/status`, {
    headers: {
      "x-unosim-gateway-secret": gatewaySecret,
    },
  });
  if (!response.ok) throw new Error(`Status endpoint failed: ${response.status}`);
  return await response.json();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

describe("50-Client Real Docker Load Test with Observability", () => {
  const API_BASE = process.env.LOAD_TEST_SERVER_URL || "http://localhost:5173";
  const NUM_CLIENTS = Number.parseInt(process.env.LOAD_TEST_CLIENT_COUNT || "50", 10);
  const TEST_LABEL = `${NUM_CLIENTS}-Client`;
  const results: TestResult[] = [];
  
  let metricsInterval: NodeJS.Timeout | null = null;
  let metricsHistory: ServerMetricsSnapshot[] = [];

  beforeAll(async () => {
    console.log(`[LoadTest] ====== DEBUG INFO ======`);
    console.log(`[LoadTest] API_BASE=${API_BASE}`);
    console.log(`[LoadTest] LOAD_TEST_SERVER_URL=${process.env.LOAD_TEST_SERVER_URL}`);
    console.log(`[LoadTest] NODE_ENV=${process.env.NODE_ENV}`);
    console.log(`[LoadTest] Testing against ${API_BASE} with ${NUM_CLIENTS} concurrent clients`);
    
    // Start metrics polling every 500ms
    metricsInterval = setInterval(async () => {
      try {
        const metrics = await getServerMetrics(API_BASE);
        metricsHistory.push(metrics);
        console.log(`[LoadTest] Metrics polled: CPU=${metrics.processMetrics.cpuPercent.toFixed(2)}%, Sessions=${metrics.webSocketSessions.active}`);
      } catch (err) {
        console.error(`[LoadTest] Metrics poll failed:`, err);
      }
    }, 500);
  });

  afterAll(async () => {
    if (metricsInterval) clearInterval(metricsInterval);
        // Save debug info to file
    const debugFile = path.join(process.cwd(), "load-test-debug.log");
    fs.writeFileSync(debugFile, `[Debug] API_BASE=${API_BASE}\n[Debug] LOAD_TEST_SERVER_URL=${process.env.LOAD_TEST_SERVER_URL}\n[Debug] Timestamp=${new Date().toISOString()}\n`);
        // Save results to file
    const outputDir = path.join(process.cwd(), "load-test-results");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFile = path.join(outputDir, `${NUM_CLIENTS}-client-observability-${timestamp}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    
    // Write summary to fixed file
    const summaryFile = path.join(outputDir, "latest-summary.txt");
    const lastResult = results.at(-1);
    if (lastResult) {
      const summary = `=== ${TEST_LABEL} Load Test (Cache-Controlled) ===
API_BASE: ${API_BASE}
Total Time: ${lastResult.totalTime}ms
Successful: ${lastResult.successful}/${lastResult.totalClients}
Failed: ${lastResult.failed}
Cache Hits: ${lastResult.cacheHits} (${((lastResult.cacheHits/lastResult.totalClients)*100).toFixed(1)}%)
Cache Misses: ${lastResult.cacheMisses} (${((lastResult.cacheMisses/lastResult.totalClients)*100).toFixed(1)}%)

Latency:
  Avg: ${lastResult.avgTime.toFixed(0)}ms
  P50: ${lastResult.p50.toFixed(0)}ms
  P90: ${lastResult.p90.toFixed(0)}ms
  P95: ${lastResult.p95.toFixed(0)}ms
  P99: ${lastResult.p99.toFixed(0)}ms

Server Metrics (Peak):
  CPU: ${lastResult.serverMetricsPeak.maxCpuPercent.toFixed(2)}%
  Memory: ${lastResult.serverMetricsPeak.maxMemoryPercent.toFixed(2)}%
  Active Sessions: ${lastResult.serverMetricsPeak.maxActiveSessions}
  Compile Queue: ${lastResult.serverMetricsPeak.maxCompileQueue}
  Runner Queue: ${lastResult.serverMetricsPeak.maxRunnerQueue}

Compile Metrics (Absolute):
  Compiles: ${lastResult.serverMetricsEnd.compileMetrics.count}
  Avg Duration: ${lastResult.serverMetricsEnd.compileMetrics.avgDurationMs.toFixed(0)}ms
  Avg Queue Wait: ${lastResult.serverMetricsEnd.compileMetrics.avgQueueWaitTimeMs.toFixed(0)}ms
  Timeouts: ${lastResult.serverMetricsEnd.compileMetrics.timeoutCount}
  Errors: ${lastResult.serverMetricsEnd.compileMetrics.errorCount}
`;
      fs.writeFileSync(summaryFile, summary);
    }
    
    console.log(`[LoadTest] Results saved to ${outputFile}`);
  });

  it(`should handle ${NUM_CLIENTS} concurrent clients with metrics`, async () => {
    const clientMetrics: ClientMetrics[] = [];
    const startTime = Date.now();

    // Capture start metrics
    const serverMetricsStart = await getServerMetrics(API_BASE);
    metricsHistory = [serverMetricsStart];

    // Run all clients concurrently
    console.log(`[LoadTest] Starting ${NUM_CLIENTS} concurrent clients...`);
    const clientStartTime = Date.now();
    const promises = Array.from({ length: NUM_CLIENTS }, (_, i) => 
      simulateClient(i + 1, API_BASE).then(m => {
        clientMetrics.push(m);
        if (m.success) {
          console.log(`[LoadTest] Client ${i+1} completed in ${m.totalTime}ms`);
        } else {
          console.error(`[LoadTest] Client ${i+1} FAILED: ${m.error}`);
        }
        return m;
      }),
    );

    await Promise.all(promises);
    console.log(`[LoadTest] All clients completed in ${Date.now() - clientStartTime}ms`);

    // Wait a bit for final metrics
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Capture end metrics
    const serverMetricsEnd = await getServerMetrics(API_BASE);

    // Calculate peak metrics from history
    const serverMetricsPeak = {
      maxCpuPercent: Math.max(...metricsHistory.map(m => m.processMetrics.cpuPercent)),
      maxMemoryPercent: Math.max(...metricsHistory.map(m => m.processMetrics.memoryPercent)),
      maxActiveSessions: Math.max(...metricsHistory.map(m => m.webSocketSessions.active)),
      maxCompileQueue: Math.max(...metricsHistory.map(m => m.compileWorkerPool?.queued ?? m.compileSlots.queued)),
      maxRunnerQueue: Math.max(...metricsHistory.map(m => m.sandboxRunners.queued)),
    };

    const totalTime = Date.now() - startTime;
    const successful = clientMetrics.filter(m => m.success).length;
    const failed = NUM_CLIENTS - successful;
    const times = clientMetrics.map(m => m.totalTime);
    const cacheHits = clientMetrics.filter(m => m.cached === true).length;
    const cacheMisses = clientMetrics.filter(m => m.cached === false).length;

    const result: TestResult = {
      testName: `${TEST_LABEL} Real Docker with Observability (Cache-Controlled)`,
      totalClients: NUM_CLIENTS,
      successful,
      failed,
      successRate: (successful / NUM_CLIENTS) * 100,
      cacheHits,
      cacheMisses,
      totalTime,
      avgTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      minTime: times.length > 0 ? Math.min(...times) : 0,
      maxTime: times.length > 0 ? Math.max(...times) : 0,
      throughput: NUM_CLIENTS / (totalTime / 1000),
      p50: percentile(times, 50),
      p90: percentile(times, 90),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      serverMetricsStart,
      serverMetricsEnd,
      serverMetricsPeak,
      clientMetrics,
    };

    results.push(result);

    // Log summary
    console.log(`\n========== ${TEST_LABEL.toUpperCase()} LOAD TEST RESULTS (CACHE-CONTROLLED) ==========`);
    console.log(`Success Rate: ${result.successRate.toFixed(1)}% (${successful}/${NUM_CLIENTS})`);
    console.log(`Total Time: ${result.totalTime.toFixed(0)}ms`);
    console.log(`Throughput: ${result.throughput.toFixed(2)} clients/sec`);
    console.log(`Latency: avg=${result.avgTime.toFixed(0)}ms, p95=${result.p95.toFixed(0)}ms, p99=${result.p99.toFixed(0)}ms`);
    console.log("\n--- Cache Statistics ---");
    console.log(`Cache Hits: ${cacheHits} (${((cacheHits/NUM_CLIENTS)*100).toFixed(1)}%)`);
    console.log(`Cache Misses: ${cacheMisses} (${((cacheMisses/NUM_CLIENTS)*100).toFixed(1)}%)`);
    console.log(`Cache Strategy: Unique code per client with timestamp`);
    console.log("\n--- Server Metrics (Peak) ---");
    console.log(`CPU: ${serverMetricsPeak.maxCpuPercent.toFixed(1)}%`);
    console.log(`Memory: ${serverMetricsPeak.maxMemoryPercent.toFixed(1)}%`);
    console.log(`Active Sessions: ${serverMetricsPeak.maxActiveSessions}`);
    console.log(`Compile Queue: ${serverMetricsPeak.maxCompileQueue}`);
    console.log(`Runner Queue: ${serverMetricsPeak.maxRunnerQueue}`);
    console.log("\n--- Compile Metrics (Absolute) ---");
    console.log(`Compiles: ${serverMetricsEnd.compileMetrics.count}`);
    console.log(`Avg Duration: ${serverMetricsEnd.compileMetrics.avgDurationMs.toFixed(0)}ms`);
    console.log(`Avg Queue Wait: ${serverMetricsEnd.compileMetrics.avgQueueWaitTimeMs.toFixed(0)}ms`);
    console.log(`Timeouts: ${serverMetricsEnd.compileMetrics.timeoutCount}`);
    console.log(`Errors: ${serverMetricsEnd.compileMetrics.errorCount}`);
    console.log("===============================================\n");

    // Assertions
    expect(result.successRate).toBeGreaterThanOrEqual(98); // Allow 1 failure
    expect(serverMetricsPeak.maxCpuPercent).toBeLessThan(90); // CPU should not max out
    expect(serverMetricsPeak.maxMemoryPercent).toBeLessThan(90); // Memory should not max out
  }, 300000); // 5 minute timeout
});

async function simulateClient(clientId: number, apiBase: string): Promise<ClientMetrics> {
  const metrics: ClientMetrics = {
    clientId,
    fetchSketchTime: 0,
    compileTime: 0,
    startSimTime: 0,
    totalTime: 0,
    success: false,
  };

  const startTime = Date.now();

  try {
    // Fetch sketch
    const fetchStart = Date.now();
    const sketchRes = await fetchHttp(`${apiBase}/api/sketches`);
    metrics.fetchSketchTime = Date.now() - fetchStart;
    if (!sketchRes.ok) throw new Error(`Fetch failed: ${sketchRes.status}`);

    // Compile with unique code to bypass cache
    const compileStart = Date.now();
    const uniqueCode = getTestCode(clientId);
    const compileRes = await fetchHttp(`${apiBase}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: uniqueCode, headers: [] }),
    });
    metrics.compileTime = Date.now() - compileStart;
    if (!compileRes.ok) throw new Error(`Compile failed: ${compileRes.status}`);
    
    // Check if response was cached (should be false for unique code)
    const compileBody = await compileRes.text();
    try {
      const compileJson = JSON.parse(compileBody);
      metrics.cached = compileJson.cached === true;
    } catch {
      metrics.cached = false;
    }

    // Start simulation (WebSocket would be here, but we skip for load test)
    const startSimStart = Date.now();
    metrics.startSimTime = Date.now() - startSimStart;

    metrics.totalTime = Date.now() - startTime;
    metrics.success = true;
  } catch (err) {
    metrics.error = err instanceof Error ? err.message : String(err);
    metrics.totalTime = Date.now() - startTime;
  }

  return metrics;
}
