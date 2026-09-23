export const CALIBRATION_POLICY_VERSION = "1" as const;

export type CalibrationOptions = {
  expectedUsers: number;
  targetCpuPercent: number;
  maxCpuPercent: number;
  maxUserWaitSec: number;
  maxDurationMin: number;
  classroomDurationSec: 60;
};

export type ActiveMeasurement = {
  requested: number;
  stable: boolean;
  cpuP95Percent: number | null;
  cpuMaxPercent: number | null;
  minAvailableMemoryBytes: number | null;
  lifecycleDockerPeak: number;
  pollingDockerPeak: number;
  errors: string[];
  elapsedMs: number;
};

export type StartupMeasurement = {
  requested: number;
  stable: boolean;
  startupSlotWaitP95Ms: number | null;
  startupSlotWaitMaxMs: number | null;
  startupDurationP95Ms: number | null;
  cpuP95Percent: number | null;
  iowaitP95Percent: number | null;
  minAvailableMemoryBytes: number | null;
  failures: number;
  timeouts: number;
};

export type Recommendation<T> = {
  value: T | null;
  status: "recommended" | "not-calibrated" | "infeasible" | "out-of-range";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  measuredBasis: string[];
  warnings: string[];
};

const DEFAULTS: CalibrationOptions = {
  expectedUsers: 200,
  targetCpuPercent: 75,
  maxCpuPercent: 85,
  maxUserWaitSec: 240,
  maxDurationMin: 30,
  classroomDurationSec: 60,
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown, name: string): number {
  if (!finiteNumber(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function positiveNumber(value: unknown, name: string): number {
  if (!finiteNumber(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

export function validateCalibrationOptions(input: Partial<CalibrationOptions>): CalibrationOptions {
  const options: CalibrationOptions = {
    ...DEFAULTS,
    ...input,
    classroomDurationSec: 60,
  };
  positiveInteger(options.expectedUsers, "expectedUsers");
  positiveNumber(options.targetCpuPercent, "targetCpuPercent");
  positiveNumber(options.maxCpuPercent, "maxCpuPercent");
  positiveNumber(options.maxUserWaitSec, "maxUserWaitSec");
  positiveNumber(options.maxDurationMin, "maxDurationMin");
  if (options.targetCpuPercent >= options.maxCpuPercent) {
    throw new Error("targetCpuPercent must be less than maxCpuPercent");
  }
  if (options.maxCpuPercent > 95) throw new Error("maxCpuPercent must be at most 95");
  return options;
}

export function planActiveCandidates(options: CalibrationOptions, logicalCpus: number): number[] {
  positiveInteger(logicalCpus, "logicalCpus");
  const cap = Math.min(options.expectedUsers, 128, Math.max(20, logicalCpus * 4));
  if (cap <= 20) return [cap];
  const increment = Math.max(20, logicalCpus);
  const candidates: number[] = [];
  for (let value = 20; value < cap; value += increment) candidates.push(value);
  candidates.push(cap);
  return [...new Set(candidates)];
}

export function planDownwardRefinement(firstExceeded: number, _options: CalibrationOptions, logicalCpus: number): number[] {
  positiveInteger(firstExceeded, "firstExceeded");
  positiveInteger(logicalCpus, "logicalCpus");
  const step = Math.max(5, Math.ceil(logicalCpus / 2));
  const lowerBound = Math.max(1, Math.ceil(logicalCpus / 2));
  const candidates: number[] = [];
  for (let value = firstExceeded - step; value >= lowerBound; value -= step) candidates.push(value);
  return candidates;
}

function activeIsStable(measurement: ActiveMeasurement, options: CalibrationOptions): boolean {
  return measurement.stable
    && measurement.errors.length === 0
    && measurement.cpuP95Percent !== null
    && measurement.cpuP95Percent <= options.maxCpuPercent
    && measurement.lifecycleDockerPeak === measurement.requested
    && measurement.pollingDockerPeak >= measurement.requested;
}

export function selectActiveRecommendation(
  measurements: ActiveMeasurement[],
  options: CalibrationOptions,
): Recommendation<number> {
  const stable = measurements.filter((measurement) => activeIsStable(measurement, options));
  const target = stable.filter((measurement) => (measurement.cpuP95Percent ?? Infinity) <= options.targetCpuPercent);
  if (target.length > 0) {
    const selected = target.reduce((best, current) => current.requested > best.requested ? current : best);
    return {
      value: selected.requested,
      status: "recommended",
      confidence: target.length >= 2 ? "HIGH" : "MEDIUM",
      measuredBasis: [`${selected.requested} active simulations directly measured`, `CPU p95 ${selected.cpuP95Percent}%`],
      warnings: [],
    };
  }
  if (stable.length > 0) {
    const selected = stable.reduce((best, current) => current.requested > best.requested ? current : best);
    return {
      value: selected.requested,
      status: "recommended",
      confidence: "MEDIUM",
      measuredBasis: [`${selected.requested} active simulations directly measured`, `CPU p95 ${selected.cpuP95Percent}%`],
      warnings: ["No directly measured stable candidate met the target CPU; selected the highest stable candidate below the hard ceiling."],
    };
  }
  return {
    value: null,
    status: "not-calibrated",
    confidence: "LOW",
    measuredBasis: [],
    warnings: ["No stable directly measured active-simulation candidate was available."],
  };
}

function materialStartupRegression(candidate: StartupMeasurement, baseline: StartupMeasurement): boolean {
  if (candidate.failures > 0 || candidate.timeouts > 0) return true;
  if (candidate.cpuP95Percent !== null && baseline.cpuP95Percent !== null) {
    if (candidate.cpuP95Percent - baseline.cpuP95Percent > 5) return true;
    if (baseline.cpuP95Percent > 0 && candidate.cpuP95Percent / baseline.cpuP95Percent > 1.1) return true;
  }
  if (candidate.iowaitP95Percent !== null && baseline.iowaitP95Percent !== null
      && candidate.iowaitP95Percent - baseline.iowaitP95Percent > 5) return true;
  if (candidate.minAvailableMemoryBytes !== null && baseline.minAvailableMemoryBytes !== null
      && candidate.minAvailableMemoryBytes < baseline.minAvailableMemoryBytes * 0.9) return true;
  return false;
}

export function selectStartupRecommendation(
  measurements: StartupMeasurement[],
  productionDefault: number,
  maxActive: number,
): Recommendation<number> {
  const safe = measurements
    .filter((measurement) => measurement.requested <= maxActive)
    .filter((measurement) => measurement.stable && measurement.failures === 0 && measurement.timeouts === 0)
    .filter((measurement) => measurement.startupDurationP95Ms !== null)
    .sort((left, right) => left.requested - right.requested);
  if (safe.length === 0) {
    return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: ["No safe startup candidate was directly measured."] };
  }
  const baseline = safe[0];
  const best = Math.min(...safe.map((measurement) => measurement.startupDurationP95Ms ?? Infinity));
  const nearBest = safe.filter((measurement) => (measurement.startupDurationP95Ms ?? Infinity) <= best * 1.1);
  const eligible = nearBest.filter((measurement) => !materialStartupRegression(measurement, baseline));
  const selected = eligible[0] ?? baseline;
  const warnings = eligible.length === 0
    ? ["Every near-best startup candidate had a material resource or error regression; kept the smallest safe baseline."]
    : [];
  if (selected.requested < productionDefault) {
    warnings.push(`Measured startup candidate ${selected.requested} is below the current default ${productionDefault}; review before applying.`);
  }
  return {
    value: selected.requested,
    status: "recommended",
    confidence: safe.length >= 3 ? "HIGH" : "MEDIUM",
    measuredBasis: [`startup candidate ${selected.requested} directly measured`, `best startup p95 ${best}ms`, `baseline candidate ${baseline.requested}`],
    warnings,
  };
}

function roundUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function rangeRecommendation(
  technical: number,
  productionDefault: number,
  range: { min: number; max: number },
  basis: string[],
): Recommendation<number> {
  if (technical > range.max) {
    return {
      value: null,
      status: "out-of-range",
      confidence: "HIGH",
      measuredBasis: [...basis, `technical recommendation ${technical}`],
      warnings: [`Technical recommendation ${technical}ms exceeds configured maximum ${range.max}ms; no value was emitted.`],
    };
  }
  return {
    value: Math.max(productionDefault, range.min, technical),
    status: "recommended",
    confidence: "HIGH",
    measuredBasis: [...basis, `technical recommendation ${technical}`],
    warnings: technical < productionDefault ? ["Measured latency supports the existing production default; it was not reduced."] : [],
  };
}

export function recommendDockerControlTimeout(
  p99Ms: number | null,
  productionDefault: number,
  range: { min: number; max: number },
): Recommendation<number> {
  if (p99Ms === null || !finiteNumber(p99Ms) || p99Ms < 0) {
    return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: ["Docker control p99 was not measured."] };
  }
  return rangeRecommendation(roundUp(p99Ms * 1.5, 100), productionDefault, range, [`Docker control p99 ${p99Ms}ms`]);
}

export function recommendSandboxStartSlotTimeout(
  p99Ms: number | null,
  maxObservedMs: number | null,
  productionDefault: number,
  range: { min: number; max: number },
): Recommendation<number> {
  if ((p99Ms === null || !finiteNumber(p99Ms)) && (maxObservedMs === null || !finiteNumber(maxObservedMs))) {
    return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: ["Sandbox-start-slot waits were not measured."] };
  }
  const technical = roundUp(Math.max(p99Ms ?? 0, 0) * 2 || 0, 1_000);
  const maxMargin = roundUp(Math.max(maxObservedMs ?? 0, 0) * 1.5, 1_000);
  return rangeRecommendation(
    Math.max(technical, maxMargin),
    productionDefault,
    range,
    [`sandbox-start-slot p99 ${p99Ms ?? "n/a"}ms`, `max observed ${maxObservedMs ?? "n/a"}ms`],
  );
}

export function recommendQueueTimeout(
  queueP95Ms: number | null,
  queueP99Ms: number | null,
  queueMaxMs: number | null,
  maxUserWaitSec: number,
): Recommendation<number> {
  const values = [queueP95Ms === null ? null : queueP95Ms * 1.5, queueP99Ms === null ? null : queueP99Ms * 1.25, queueMaxMs === null ? null : queueMaxMs * 1.1]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) {
    return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: ["Simulation queue waits were not measured."] };
  }
  const technical = roundUp(Math.max(...values), 1_000);
  const ceiling = maxUserWaitSec * 1_000;
  if (technical > ceiling) {
    return {
      value: null,
      status: "infeasible",
      confidence: "MEDIUM",
      measuredBasis: [`technical queue minimum ${technical}ms`, `UX ceiling ${ceiling}ms`],
      warnings: [`Technical queue timeout ${technical}ms exceeds the maximum user wait policy ${ceiling}ms.`],
    };
  }
  return {
    value: technical,
    status: "recommended",
    confidence: "MEDIUM",
    measuredBasis: [`technical queue minimum ${technical}ms`, `UX ceiling ${ceiling}ms`],
    warnings: [],
  };
}

export function scoreCalibrationConfidence(
  measuredPhases: number,
  complete: boolean,
  safetyEvents: number,
): "HIGH" | "MEDIUM" | "LOW" {
  if (measuredPhases >= 3 && complete && safetyEvents === 0) return "HIGH";
  if (measuredPhases > 0) return "MEDIUM";
  return "LOW";
}
