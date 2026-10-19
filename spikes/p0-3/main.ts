// Page thread: starts the worker per sketch, watches its own responsiveness, shows and copies the result.
// Injected by build.mjs: the sketches with their HEX text.
declare const __PROBES__: Array<{ name: string; hex: string }>;
const PROBES = __PROBES__;

interface Result { name: string; peakSpeed: number; factors: number[]; simTimeMs: number; wallMs: number }
const REAL_TIME_MS = 10_000;
const PEAK_SIM_MS = 2_000;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

async function runOne(name: string, hex: string): Promise<{ result: Result; lagP95: number; lagMax: number }> {
  const lags: number[] = [];
  let expected = performance.now() + 16;
  const ticker = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 16;
  }, 16);
  const worker = new Worker("worker.js");
  const result = await new Promise<Result>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<Result>) => resolve(event.data);
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ name, hex, realTimeMs: REAL_TIME_MS, peakSimMs: PEAK_SIM_MS });
  });
  clearInterval(ticker);
  worker.terminate();
  return { result, lagP95: percentile(lags, 0.95), lagMax: Math.max(0, ...lags) };
}

const output = document.querySelector<HTMLPreElement>("#output")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const copy = document.querySelector<HTMLButtonElement>("#copy")!;
let report: unknown;

run.onclick = async () => {
  run.disabled = true;
  copy.disabled = true;
  const rows: Array<Record<string, unknown>> = [];
  output.textContent = "running…\n";
  for (const probe of PROBES) {
    output.textContent += `${probe.name} …\n`;
    const { result, lagP95, lagMax } = await runOne(probe.name, probe.hex);
    const settled = result.factors.slice(Math.floor(result.factors.length / 2));
    rows.push({
      sketch: probe.name,
      peakSpeed: Number(result.peakSpeed.toFixed(2)),
      realTimeFactorMedian: Number(percentile(settled, 0.5).toFixed(2)),
      realTimeFactorMin: Number(Math.min(...result.factors).toFixed(2)),
      uiLagP95Ms: Number(lagP95.toFixed(1)),
      uiLagMaxMs: Number(lagMax.toFixed(1)),
    });
  }
  report = { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGb: (navigator as { deviceMemory?: number }).deviceMemory ?? null, measuredAt: new Date().toISOString(), rows };
  output.textContent = `${JSON.stringify(report, null, 2)}\n`;
  run.disabled = false;
  copy.disabled = false;
};

copy.onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => {
    const range = document.createRange();
    range.selectNodeContents(output);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
};
