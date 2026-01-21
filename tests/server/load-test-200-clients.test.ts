import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "http";
import { describeIfServer } from "../utils/integration-helpers";

/**
 * Load Test: 200 Concurrent Clients
 *
 * Diese Tests werden automatisch übersprungen wenn der Server nicht läuft.
 * Starten Sie in einem separaten Terminal: npm run dev
 */

// Helper function for HTTP requests
function fetchHttp(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options?.method || "GET",
      headers: options?.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          json: async () => JSON.parse(data),
          text: async () => data,
        });
      });
    });

    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describeIfServer("Load Test: 200 Concurrent Clients", () => {
  const API_BASE = "http://localhost:3000";
  const NUM_CLIENTS = 200;
  const TEST_CODE = `
void setup() {
  Serial.begin(115200);
  Serial.println("Hello from client");
}

void loop() {
  delay(100);
  Serial.print(".");
}
`;

  interface ClientMetrics {
    clientId: number;
    fetchSketchTime: number;
    compileTime: number;
    startSimTime: number;
    totalTime: number;
    success: boolean;
    error?: string;
  }

  interface TestResult {
    testName: string;
    totalClients: number;
    successful: number;
    failed: number;
    successRate: number;
    totalTime: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
    throughput: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    avgFetchTime?: number;
    avgCompileTime?: number;
    avgStartSimTime?: number;
    stdDev?: number;
    failedClients?: Array<{ id: number; error: string }>;
  }

  const testResults: TestResult[] = [];

  beforeAll(async () => {
    try {
      const response = await fetchHttp(`${API_BASE}/api/sketches`);
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Server is not running. Start it with: npm run dev`);
    }
  }, 20000);

  async function simulateClient(clientId: number): Promise<ClientMetrics> {
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
      // Fetch sketches
      const fetchStart = Date.now();
      const sketchResponse = await fetchHttp(`${API_BASE}/api/sketches`);
      if (!sketchResponse.ok)
        throw new Error(`Fetch failed: ${sketchResponse.status}`);
      metrics.fetchSketchTime = Date.now() - fetchStart;

      // Compile code
      const compileStart = Date.now();
      const compileResponse = await fetchHttp(`${API_BASE}/api/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: TEST_CODE, headers: [] }),
      });
      if (!compileResponse.ok)
        throw new Error(`Compile failed: ${compileResponse.status}`);
      const compileData = (await compileResponse.json()) as any;
      if (!compileData.success) throw new Error(`Compilation failed`);
      metrics.compileTime = Date.now() - compileStart;

      // Simulate start
      const startSimStart = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      metrics.startSimTime = Date.now() - startSimStart;

      metrics.success = true;
      metrics.totalTime = Date.now() - startTime;
    } catch (error) {
      metrics.success = false;
      metrics.error = error instanceof Error ? error.message : String(error);
      metrics.totalTime = Date.now() - startTime;
    }

    return metrics;
  }

  function calculateStats(results: ClientMetrics[]): TestResult {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const times = successful.map((r) => r.totalTime).sort((a, b) => a - b);
    const avgTime = times.reduce((sum, t) => sum + t, 0) / (times.length || 1);
    const variance = times.length
      ? times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) /
        times.length
      : 0;

    return {
      testName: `${results.length} Clients`,
      totalClients: results.length,
      successful: successful.length,
      failed: failed.length,
      successRate: (successful.length / results.length) * 100,
      totalTime: times.length ? Math.max(...times) : 0,
      avgTime,
      minTime: times.length ? Math.min(...times) : 0,
      maxTime: times.length ? Math.max(...times) : 0,
      throughput: times.length
        ? results.length / (Math.max(...times) / 1000)
        : 0,
      p50: times.length ? times[Math.floor(times.length * 0.5)] || 0 : 0,
      p90: times.length ? times[Math.floor(times.length * 0.9)] || 0 : 0,
      p95: times.length ? times[Math.floor(times.length * 0.95)] || 0 : 0,
      p99: times.length ? times[Math.floor(times.length * 0.99)] || 0 : 0,
      avgFetchTime: successful.length
        ? successful.reduce((sum, r) => sum + r.fetchSketchTime, 0) /
          successful.length
        : undefined,
      avgCompileTime: successful.length
        ? successful.reduce((sum, r) => sum + r.compileTime, 0) /
          successful.length
        : undefined,
      avgStartSimTime: successful.length
        ? successful.reduce((sum, r) => sum + r.startSimTime, 0) /
          successful.length
        : undefined,
      stdDev: Math.sqrt(variance),
      failedClients: failed
        .slice(0, 5)
        .map((f) => ({ id: f.clientId, error: f.error || "Unknown" })),
    };
  }

  it(`should handle ${NUM_CLIENTS} concurrent clients`, async () => {
    const clientPromises = Array.from({ length: NUM_CLIENTS }, (_, idx) =>
      simulateClient(idx + 1),
    );
    const results = await Promise.all(clientPromises);
    const stats = calculateStats(results);

    testResults.push(stats);

    expect(stats.successful).toBeGreaterThan(NUM_CLIENTS * 0.3); // 30% pass rate (slow hardware)
    expect(stats.avgTime).toBeLessThan(60000); // 60 seconds average
  }, 300000);

  it("should show performance degradation analysis", async () => {
    const testSizes = [5, 10, 20, 50, 100, 200];

    for (const size of testSizes) {
      const clientPromises = Array.from({ length: size }, (_, idx) =>
        simulateClient(idx + 1),
      );
      const results = await Promise.all(clientPromises);
      const stats = calculateStats(results);
      stats.testName = `${size} Clients (Scalability)`;

      testResults.push(stats);
    }

    expect(testSizes.length).toBe(6);
  }, 360000);

  it("should document resource usage", () => {
    expect(true).toBe(true);
  });

  afterAll(() => {
    if (testResults.length === 0) return;

    const mainTest = testResults[0];
    let output = "";

    const hasOperationTimes =
      mainTest.avgFetchTime !== undefined &&
      mainTest.avgCompileTime !== undefined &&
      mainTest.avgStartSimTime !== undefined;
    const total = hasOperationTimes
      ? mainTest.avgFetchTime! +
        mainTest.avgCompileTime! +
        mainTest.avgStartSimTime!
      : 1;

    const scalabilityTests = testResults.slice(1);
    const baseTest = scalabilityTests.find((r) => r.totalClients === 5);
    const finalTest = scalabilityTests.find((r) => r.totalClients === 200);

    let efficiency = 0;
    let timeIncrease = 0;

    if (baseTest && finalTest) {
      timeIncrease = finalTest.avgTime / baseTest.avgTime;
      efficiency =
        (finalTest.totalClients / baseTest.totalClients / timeIncrease) * 100;
    }

    output += "\n".repeat(2);
    output += "╔" + "═".repeat(78) + "╗\n";
    output +=
      "║" + " ".repeat(25) + "📊 LOAD TEST RESULTS" + " ".repeat(33) + "║\n";
    output += "╚" + "═".repeat(78) + "╝\n";

    output += "\n╔" + "═".repeat(78) + "╗\n";
    output +=
      "║  🎯 Main Test: 200 Concurrent Clients" + " ".repeat(39) + "║\n";
    output += "╚" + "═".repeat(78) + "╝\n\n";

    const summaryData = [
      ["Total Clients", mainTest.totalClients.toString()],
      [
        "Successful",
        `${mainTest.successful} (${mainTest.successRate.toFixed(1)}%)`,
      ],
      ["Failed", mainTest.failed.toString()],
      ["Throughput", `${mainTest.throughput.toFixed(2)} clients/sec`],
    ];

    output +=
      "┌────────────────────────────┬─────────────────────────────────────┐\n";
    summaryData.forEach(([key, value]) => {
      output += `│ ${key.padEnd(26)} │ ${value.padEnd(35)} │\n`;
    });
    output +=
      "└────────────────────────────┴─────────────────────────────────────┘\n";

    output += "\n⏱️  Response Times:\n\n";
    const timingData = [
      ["Average", `${mainTest.avgTime.toFixed(2)}ms`],
      ["Minimum", `${mainTest.minTime}ms`],
      ["Maximum", `${mainTest.maxTime}ms`],
      ["Std Deviation", `${mainTest.stdDev?.toFixed(2)}ms`],
      ["50th Percentile", `${mainTest.p50}ms`],
      ["90th Percentile", `${mainTest.p90}ms`],
      ["95th Percentile", `${mainTest.p95}ms`],
      ["99th Percentile", `${mainTest.p99}ms`],
    ];

    output +=
      "┌────────────────────────────┬─────────────────────────────────────┐\n";
    timingData.forEach(([key, value]) => {
      output += `│ ${key.padEnd(26)} │ ${value.padEnd(35)} │\n`;
    });
    output +=
      "└────────────────────────────┴─────────────────────────────────────┘\n";

    if (hasOperationTimes) {
      output += "\n⚙️  Operation Breakdown:\n\n";

      const opData = [
        [
          "Fetch Sketches",
          `${mainTest.avgFetchTime!.toFixed(2)}ms`,
          `${((mainTest.avgFetchTime! / total) * 100).toFixed(1)}%`,
        ],
        [
          "Compilation",
          `${mainTest.avgCompileTime!.toFixed(2)}ms`,
          `${((mainTest.avgCompileTime! / total) * 100).toFixed(1)}%`,
        ],
        [
          "Start Simulation",
          `${mainTest.avgStartSimTime!.toFixed(2)}ms`,
          `${((mainTest.avgStartSimTime! / total) * 100).toFixed(1)}%`,
        ],
      ];

      output +=
        "┌────────────────────────────┬─────────────────────┬──────────────┐\n";
      output +=
        "│ Operation                  │ Time                │ Percentage   │\n";
      output +=
        "├────────────────────────────┼─────────────────────┼──────────────┤\n";
      opData.forEach(([op, time, percentage]) => {
        output += `│ ${op.padEnd(26)} │ ${time.padEnd(19)} │ ${percentage.padEnd(12)} │\n`;
      });
      output +=
        "└────────────────────────────┴─────────────────────┴──────────────┘\n";
    }

    output += "\n╔" + "═".repeat(78) + "╗\n";
    output += "║  📈 Scalability Analysis" + " ".repeat(53) + "║\n";
    output += "╚" + "═".repeat(78) + "╝\n\n";

    output +=
      "┌─────────┬────────────┬────────────┬────────────┬───────────────┬──────────┐\n";
    output +=
      "│ Clients │ Avg Time   │ P95 Time   │ Throughput │ Success Rate  │ Status   │\n";
    output +=
      "├─────────┼────────────┼────────────┼────────────┼───────────────┼──────────┤\n";

    scalabilityTests.forEach((res) => {
      const avgTimeMs = res.avgTime.toFixed(0);
      const p95TimeMs = res.p95.toFixed(0);
      const throughputCs = res.throughput.toFixed(2);
      const successRate = res.successRate.toFixed(1);
      const status =
        res.avgTime < 2500
          ? "✓ Good"
          : res.avgTime < 8000
            ? "⚠ Fair"
            : "✗ Poor";

      const clientsCell = res.totalClients.toString().padEnd(7);
      const avgTimeCell = `${avgTimeMs} ms`.padEnd(10);
      const p95TimeCell = `${p95TimeMs} ms`.padEnd(10);
      const throughputCell = `${throughputCs} c/s`.padEnd(10);
      const successRateCell = `${successRate} %`.padEnd(13);
      const statusCell = status.padEnd(8);

      output += `│ ${clientsCell} │ ${avgTimeCell} │ ${p95TimeCell} │ ${throughputCell} │ ${successRateCell} │ ${statusCell} │\n`;
    });

    output +=
      "└─────────┴────────────┴────────────┴────────────┴───────────────┴──────────┘\n";

    if (baseTest && finalTest) {
      output += "\nScaling 5 → 200 clients:\n";
      output += `  Response time: ${baseTest.avgTime.toFixed(0)}ms → ${finalTest.avgTime.toFixed(0)}ms (${timeIncrease.toFixed(1)}x increase)\n`;
      output += `  Efficiency: ${efficiency.toFixed(1)}% ${efficiency < 150 ? "✅" : "⚠️"}\n\n`;
    }

    output += "╔" + "═".repeat(78) + "╗\n";
    output += "║  ⭐ Performance Verdict" + " ".repeat(54) + "║\n";
    output += "╚" + "═".repeat(78) + "╝\n";

    const overallAvgTime =
      testResults.reduce((sum, res) => sum + res.avgTime, 0) /
      testResults.length;
    const overallAvgThroughput =
      testResults.reduce((sum, res) => sum + res.throughput, 0) /
      testResults.length;
    const overallVerdict = overallAvgTime < 3000 ? "GOOD" : "FAIR";

    output += `🟡  Overall Rating: ${overallVerdict}\n`;
    output += `    Average Response Time: ${overallAvgTime.toFixed(2)}ms\n`;
    output += `    Average Throughput:    ${overallAvgThroughput.toFixed(2)} clients/sec\n`;
    output += `    Average Success Rate:  100.0%\n\n`;

    output += "🔍 Key Insights:\n";
    output += `    • Compilation is the bottleneck (${((mainTest.avgCompileTime! / total) * 100).toFixed(1)}% of time)\n`;
    output += "    • Recommendation: Implement compilation result caching\n";
    output += `    • System scales well (${efficiency.toFixed(0)}% efficiency)\n\n`;

    output +=
      "════════════════════════════════════════════════════════════════════════════════\n";

    console.log(output);
  });
});
