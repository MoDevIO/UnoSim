import { describe, expect, it } from "vitest";
import {
  assertCapacityRuntimeMatches,
  getCapacityProfile,
} from "../../scripts/capacity-validation-config";

describe("capacity validation runtime profiles", () => {
  it("enforces the historical baseline and each staging candidate at runtime", () => {
    const expectedProfiles = [
      { key: "BASELINE", minRunners: 5, maxRunners: 5, admissionMax: 25 },
      { key: "R20", minRunners: 5, maxRunners: 20, admissionMax: 100 },
      { key: "R40", minRunners: 5, maxRunners: 40, admissionMax: 100 },
      { key: "R60", minRunners: 10, maxRunners: 60, admissionMax: 100 },
      { key: "R80", minRunners: 10, maxRunners: 80, admissionMax: 100 },
      { key: "R80_BURST", minRunners: 10, maxRunners: 80, admissionMax: 180 },
    ] as const;

    for (const expected of expectedProfiles) {
      const profile = getCapacityProfile(expected.key);
      expect(profile).toMatchObject({
        minRunners: expected.minRunners,
        maxRunners: expected.maxRunners,
        admissionMax: expected.admissionMax,
      });
      expect(() => assertCapacityRuntimeMatches(profile, {
        serverMode: "docker",
        sandboxRunners: { min: expected.minRunners, max: expected.maxRunners },
        admissionControl: { max: expected.admissionMax },
      })).not.toThrow();
    }
  });

  it("accepts only a Docker runtime that matches the requested profile", () => {
    const profile = getCapacityProfile("BASELINE");

    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      sandboxRunners: { min: 5, max: 5 },
      admissionControl: { max: 25 },
    })).not.toThrow();

    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "local",
      sandboxRunners: { min: 5, max: 5 },
      admissionControl: { max: 25 },
    })).toThrow(/serverMode.*docker/i);
  });

  it("fails before load when any requested runtime value is missing or different", () => {
    const profile = getCapacityProfile("R20");

    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      sandboxRunners: { min: 5, max: 5 },
      admissionControl: { max: 25 },
    })).toThrow(/maxRunners.*20.*5.*admissionMax.*100.*25/i);

    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      sandboxRunners: { max: 20 },
      admissionControl: { max: 100 },
    })).toThrow(/minRunners.*5.*undefined/i);
  });

  it("rejects unknown profiles", () => {
    expect(() => getCapacityProfile("production" as never)).toThrow(/unknown/i);
  });
});
