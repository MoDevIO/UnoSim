import { runRestCompileBatch, type RestCompileBatchMeasurement, type RestCompileBatchOptions } from "./capacity-rest-compile";
import type { HostSample } from "./capacity-scenario-runner";

/**
 * Compile load of the browser emulation (plan 4.12, P7.1): a browser run costs
 * the server nothing, so the server's limit is the compile. The steps model a
 * class: single compiles, the worker pool at its width, every student pressing
 * Compile at once (unique sketches), and the same burst on an unchanged example
 * (cache hits).
 */
export type CompileLoadStep = {
  readonly name: "serial" | "pool" | "class-burst" | "class-burst-cached";
  readonly requests: number;
  readonly concurrency: number;
  readonly sketch: "unique" | "shared";
};

/** Upper bound of the class burst: what one REST compile batch accepts. */
const MAX_BURST = 64;

export function planCompileLoad(expectedUsers: number, workerCount: number): CompileLoadStep[] {
  const burst = Math.max(1, Math.min(expectedUsers, MAX_BURST));
  const pool = Math.max(1, Math.min(workerCount, burst));
  return [
    { name: "serial", requests: 5, concurrency: 1, sketch: "unique" },
    { name: "pool", requests: Math.max(16, pool * 2), concurrency: pool, sketch: "unique" },
    { name: "class-burst", requests: burst, concurrency: burst, sketch: "unique" },
    { name: "class-burst-cached", requests: burst, concurrency: burst, sketch: "shared" },
  ];
}

export type CompileLoadMeasurement = Omit<RestCompileBatchMeasurement, "latencyMs" | "results"> & {
  readonly step: CompileLoadStep["name"];
  readonly sketch: CompileLoadStep["sketch"];
  /** From the first request to the last answer. */
  readonly durationMs: number;
  readonly successfulPerMinute: number;
  /** Most compile containers of this run seen at once (polled every 250 ms). */
  readonly compileContainerPeak: number;
  readonly cpuPeakPercent: number | null;
  readonly availableMemoryMinBytes: number | null;
};

export type CompileLoadDependencies = {
  readonly runBatch?: (options: RestCompileBatchOptions) => Promise<RestCompileBatchMeasurement>;
  /** Compile containers of the run that exist right now. */
  readonly countCompileContainers: () => number;
  readonly sampleHost: () => Promise<HostSample>;
  readonly now?: () => number;
};

const POLL_INTERVAL_MS = 250;

export async function measureCompileLoad(
  target: { baseUrl: string; runId: string },
  steps: readonly CompileLoadStep[],
  dependencies: CompileLoadDependencies,
): Promise<CompileLoadMeasurement[]> {
  const runBatch = dependencies.runBatch ?? ((options: RestCompileBatchOptions) => runRestCompileBatch(options));
  const now = dependencies.now ?? Date.now;
  const measurements: CompileLoadMeasurement[] = [];
  for (const step of steps) {
    // One warm compile makes the cached burst measure cache hits only.
    if (step.sketch === "shared") await runBatch({ ...target, requestCount: 1, concurrency: 1, sketch: "shared", sketchSeed: step.name });

    let containerPeak = 0;
    const samples: HostSample[] = [];
    let polling = false;
    const poller = setInterval(() => {
      if (polling) return;
      polling = true;
      containerPeak = Math.max(containerPeak, dependencies.countCompileContainers());
      dependencies.sampleHost().then((sample) => { samples.push(sample); }, () => undefined).finally(() => { polling = false; });
    }, POLL_INTERVAL_MS);
    const startedAt = now();
    let batch: RestCompileBatchMeasurement;
    try {
      batch = await runBatch({ ...target, requestCount: step.requests, concurrency: step.concurrency, sketch: step.sketch, sketchSeed: step.name });
    } finally {
      clearInterval(poller);
    }
    const durationMs = Math.max(1, now() - startedAt);
    const { latencyMs: _latencies, results: _results, ...summary } = batch;
    const cpu = samples.map((sample) => sample.cpuPercent).filter((value): value is number => value !== null);
    const memory = samples.map((sample) => sample.availableMemoryBytes).filter((value): value is number => value !== null);
    measurements.push({
      ...summary,
      step: step.name,
      sketch: step.sketch,
      durationMs,
      successfulPerMinute: Math.round(batch.successful / durationMs * 60_000),
      compileContainerPeak: containerPeak,
      cpuPeakPercent: cpu.length > 0 ? Math.max(...cpu) : null,
      availableMemoryMinBytes: memory.length > 0 ? Math.min(...memory) : null,
    });
  }
  return measurements;
}

/** Markdown table of a compile load run for the calibration report. */
export function renderCompileLoadTable(measurements: readonly CompileLoadMeasurement[]): string[] {
  if (measurements.length === 0) return ["Compile load: not measured."];
  return [
    "| Step | Sketch | Requests × concurrency | OK / 503 / failed | p50 / p95 / max (ms) | Compiles/min | Compile containers (peak) | CPU peak |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...measurements.map((m) => `| ${m.step} | ${m.sketch} | ${m.requested} × ${m.concurrency} | ${m.successful} / ${m.serviceUnavailable} / ${m.failed - m.serviceUnavailable} | ${m.p50LatencyMs} / ${m.p95LatencyMs} / ${m.maxLatencyMs} | ${m.successfulPerMinute} | ${m.compileContainerPeak} | ${m.cpuPeakPercent === null ? "—" : `${Math.round(m.cpuPeakPercent)} %`} |`),
  ];
}
