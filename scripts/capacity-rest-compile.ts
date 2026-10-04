import { TEST_RUN_ID_PATTERN } from "@shared/input-limits";

export type RestCompileBatchOptions = {
  baseUrl: string;
  runId: string;
  requestCount: number;
  concurrency: number;
  timeoutMs?: number;
};

export type RestCompileRequestResult = {
  request: number;
  startedAtMs: number;
  completedAtMs: number;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  serviceUnavailable: boolean;
};

export type RestCompileBatchMeasurement = {
  requested: number;
  concurrency: number;
  completed: number;
  successful: number;
  failed: number;
  serviceUnavailable: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  latencyMs: number[];
  results: RestCompileRequestResult[];
};

const MAX_REST_COMPILE_REQUESTS = 128;
const MAX_REST_COMPILE_CONCURRENCY = 64;
const DEFAULT_REST_COMPILE_TIMEOUT_MS = 120_000;

function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileRank / 100 * sorted.length) - 1)];
}

export async function runRestCompileBatch(
  options: RestCompileBatchOptions,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<RestCompileBatchMeasurement> {
  if (!options.baseUrl) throw new Error("A backend URL is required for the REST compile workload");
  if (!TEST_RUN_ID_PATTERN.test(options.runId)) throw new Error("runId must be a URL-safe test run identifier");
  if (!Number.isInteger(options.requestCount) || options.requestCount < 1 || options.requestCount > MAX_REST_COMPILE_REQUESTS) {
    throw new Error(`requestCount must be between 1 and ${MAX_REST_COMPILE_REQUESTS}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1
    || options.concurrency > MAX_REST_COMPILE_CONCURRENCY || options.concurrency > options.requestCount) {
    throw new Error(`concurrency must be between 1 and min(requestCount, ${MAX_REST_COMPILE_CONCURRENCY})`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_REST_COMPILE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error("timeoutMs must be between 1000 and 300000");
  }

  const results = new Array<RestCompileRequestResult>(options.requestCount);
  let nextRequest = 0;
  const workers = Array.from({ length: options.concurrency }, async () => {
    while (true) {
      const request = nextRequest++;
      if (request >= options.requestCount) return;

      const startedAt = now();
      const code = `// REST_COMPILE_REQUEST_${request} run=${options.runId}\nvoid setup() {}\nvoid loop() { delay(1); }\n`;
      let statusCode = 0;
      let success = false;
      try {
        const response = await fetcher(`${options.baseUrl.replace(/\/$/, "")}/api/compile`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-run-id": options.runId,
          },
          body: JSON.stringify({ code }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        statusCode = response.status;
        const body = await response.json().catch(() => null) as { success?: unknown } | null;
        success = response.ok && body?.success === true;
      } catch {
        statusCode = 0;
      }
      const completedAt = now();
      results[request] = {
        request,
        startedAtMs: startedAt,
        completedAtMs: completedAt,
        statusCode,
        latencyMs: Math.max(0, completedAt - startedAt),
        success,
        serviceUnavailable: statusCode === 503,
      };
    }
  });
  await Promise.all(workers);

  const latencies = results.map((result) => result.latencyMs);
  const successful = results.filter((result) => result.success).length;
  return {
    requested: options.requestCount,
    concurrency: options.concurrency,
    completed: results.length,
    successful,
    failed: results.length - successful,
    serviceUnavailable: results.filter((result) => result.serviceUnavailable).length,
    averageLatencyMs: latencies.reduce((total, value) => total + value, 0) / Math.max(1, latencies.length),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    latencyMs: latencies,
    results,
  };
}
