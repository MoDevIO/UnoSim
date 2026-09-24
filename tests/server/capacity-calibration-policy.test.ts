import { describe, expect, it } from "vitest";
import {
  planActiveCandidates,
  planBracketRefinement,
  planDownwardRefinement,
  recommendDockerControlTimeout,
  recommendQueueTimeout,
  recommendSandboxStartSlotTimeout,
  measurementQueueTimeoutMs,
  scoreCalibrationConfidence,
  selectActiveRecommendation,
  selectStartupRecommendation,
  validateCalibrationOptions,
  type ActiveMeasurement,
  type CalibrationOptions,
  type StartupMeasurement,
} from "../../scripts/capacity-calibration-policy";

const baseOptions: CalibrationOptions = {
  expectedUsers: 200,
  targetCpuPercent: 75,
  maxCpuPercent: 85,
  maxUserWaitSec: 240,
  maxDurationMin: 30,
  classroomDurationSec: 60,
};

function active(requested: number, cpuP95Percent: number, overrides: Partial<ActiveMeasurement> = {}): ActiveMeasurement {
  return {
    requested,
    stable: true,
    cpuP95Percent,
    cpuMaxPercent: cpuP95Percent + 5,
    minAvailableMemoryBytes: 8 * 1024 ** 3,
    lifecycleDockerPeak: requested,
    pollingDockerPeak: requested,
    errors: [],
    elapsedMs: 30_000,
    ...overrides,
  };
}

function startup(requested: number, p95: number, overrides: Partial<StartupMeasurement> = {}): StartupMeasurement {
  return {
    requested,
    stable: true,
    startupSlotWaitP95Ms: p95 / 2,
    startupSlotWaitMaxMs: p95,
    startupDurationP95Ms: p95,
    cpuP95Percent: 30,
    iowaitP95Percent: 1,
    minAvailableMemoryBytes: 8 * 1024 ** 3,
    failures: 0,
    timeouts: 0,
    startupSlotWaitSamplesComplete: true,
    startupSlotWaitSampleCount: requested,
    ...overrides,
  };
}

describe("calibration policy options", () => {
  it("applies the documented defaults", () => {
    expect(validateCalibrationOptions({})).toEqual(baseOptions);
  });

  it("accepts decimal CPU thresholds below the hard ceiling", () => {
    expect(validateCalibrationOptions({ targetCpuPercent: 72.5, maxCpuPercent: 84.5 })).toMatchObject({
      targetCpuPercent: 72.5,
      maxCpuPercent: 84.5,
    });
  });

  it.each([
    { expectedUsers: 0 },
    { maxUserWaitSec: -1 },
    { maxDurationMin: Number.NaN },
    { targetCpuPercent: 85, maxCpuPercent: 85 },
    { maxCpuPercent: 96 },
  ])("rejects invalid option %#", (input) => {
    expect(() => validateCalibrationOptions(input)).toThrow();
  });
});

describe("active capacity planning", () => {
  it("plans host-sized bounded coarse candidates", () => {
    expect(planActiveCandidates(baseOptions, 10)).toEqual([20, 40]);
    expect(planActiveCandidates(baseOptions, 20)).toEqual([20, 40, 60, 80]);
    expect(planActiveCandidates({ ...baseOptions, expectedUsers: 35 }, 20)).toEqual([20, 35]);
    expect(planActiveCandidates({ ...baseOptions, expectedUsers: 500 }, 40).at(-1)).toBe(128);
  });

  it("plans downward refinement when the first candidate exceeds target CPU", () => {
    expect(planDownwardRefinement(80, baseOptions, 20)).toEqual([70, 60, 50, 40, 30, 20, 10]);
    expect(planDownwardRefinement(40, baseOptions, 10)).toEqual([35, 30, 25, 20, 15, 10, 5]);
  });

  it("plans bounded intermediate candidates for a normal target bracket", () => {
    expect(planBracketRefinement([
      active(40, 57),
      active(60, 84),
    ], baseOptions, 20)).toEqual([50]);
  });

  it("selects the highest directly measured stable candidate at or below target CPU", () => {
    const result = selectActiveRecommendation([
      active(20, 40),
      active(40, 62),
      active(60, 74.9),
      active(80, 86),
    ], baseOptions);
    expect(result).toMatchObject({ value: 60, status: "recommended", confidence: "HIGH" });
  });

  it("does not recommend a candidate whose physical overlap is unproven", () => {
    const result = selectActiveRecommendation([
      active(20, 40, { pollingDockerPeak: 19 }),
      active(40, 60, { lifecycleDockerPeak: 39 }),
    ], baseOptions);
    expect(result.value).toBeNull();
    expect(result.status).toBe("not-calibrated");
  });

  it("falls back below the hard ceiling with reduced confidence when target is unavailable", () => {
    const result = selectActiveRecommendation([
      active(20, 80),
      active(40, 84),
      active(60, 87),
    ], baseOptions);
    expect(result).toMatchObject({ value: 40, status: "recommended", confidence: "MEDIUM" });
    expect(result.warnings.join(" ")).toMatch(/target/i);
  });
});

describe("startup capacity planning", () => {
  it("selects the smallest safe candidate within ten percent of best startup p95", () => {
    const result = selectStartupRecommendation([
      startup(8, 1_500),
      startup(12, 900),
      startup(16, 850),
      startup(20, 840),
    ], 8, 20);
    expect(result).toMatchObject({ value: 12, status: "recommended" });
  });

  it("uses the smallest safe startup candidate as the resource baseline", () => {
    const result = selectStartupRecommendation([
      startup(8, 1_500),
      startup(12, 1_000, { cpuP95Percent: 50 }),
      startup(16, 900, { cpuP95Percent: 50 }),
    ], 8, 20);
    expect(result.value).toBe(8);
    expect(result.warnings.join(" ")).toMatch(/baseline|regression/i);
  });

  it("ignores failed, timed-out, and over-capacity startup candidates", () => {
    const result = selectStartupRecommendation([
      startup(8, 2_000),
      startup(12, 500, { failures: 1 }),
      startup(20, 400),
    ], 8, 12);
    expect(result.value).toBe(8);
  });
});

describe("timeout recommendations", () => {
  it("uses an independent classroom measurement queue timeout above production", () => {
    expect(measurementQueueTimeoutMs(60_000, 240, 60)).toBe(330_000);
    expect(measurementQueueTimeoutMs(600_000, 240, 60)).toBe(600_000);
    expect(() => measurementQueueTimeoutMs(60_000, 900, 60)).toThrow(/configured maximum/);
  });
  it("keeps Docker control timeout at the default when measured latency is lower", () => {
    expect(recommendDockerControlTimeout(500, 2_000, { min: 100, max: 30_000 })).toMatchObject({
      value: 2_000,
      status: "recommended",
    });
  });

  it("adds a measured margin and rounds Docker control timeout", () => {
    expect(recommendDockerControlTimeout(2_100, 2_000, { min: 100, max: 30_000 })).toMatchObject({
      value: 3_200,
      status: "recommended",
    });
  });

  it("reports an out-of-range Docker control recommendation without clamping", () => {
    const result = recommendDockerControlTimeout(25_000, 2_000, { min: 100, max: 30_000 });
    expect(result).toMatchObject({ value: null, status: "out-of-range" });
    expect(result.measuredBasis.join(" ")).toMatch(/37500/);
  });

  it("recommends sandbox-start-slot timeout from measured p99 and max", () => {
    expect(recommendSandboxStartSlotTimeout(8_664, 12_856, 30_000, { min: 1_000, max: 900_000 })).toMatchObject({
      value: 30_000,
      status: "recommended",
    });
  });

  it("does not recommend a sandbox-start timeout without measured waits", () => {
    expect(recommendSandboxStartSlotTimeout(null, null, 30_000, { min: 1_000, max: 900_000 })).toMatchObject({
      value: null,
      status: "not-calibrated",
    });
  });

  it("reports a queue timeout that fits the UX ceiling", () => {
    expect(recommendQueueTimeout(100_000, 120_000, 150_000, 240)).toMatchObject({
      value: 165_000,
      status: "recommended",
    });
  });

  it("marks queue policy infeasible when technical timeout exceeds user wait", () => {
    const result = recommendQueueTimeout(180_000, 200_000, 250_000, 240);
    expect(result).toMatchObject({ value: null, status: "infeasible" });
    expect(result.warnings.join(" ")).toMatch(/240|wait/i);
  });
});

describe("calibration confidence", () => {
  it("scores complete multi-phase direct measurements as high confidence", () => {
    expect(scoreCalibrationConfidence(3, true, 0)).toBe("HIGH");
  });

  it("lowers confidence for partial or safety-stopped runs", () => {
    expect(scoreCalibrationConfidence(2, false, 0)).toBe("MEDIUM");
    expect(scoreCalibrationConfidence(3, true, 1)).toBe("MEDIUM");
    expect(scoreCalibrationConfidence(0, false, 0)).toBe("LOW");
  });
});
