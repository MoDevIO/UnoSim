import { describe, expect, it } from "vitest";
import { assertCapacityRuntimeMatches, getCapacityProfile } from "../../scripts/capacity-validation-config";

describe("capacity validation runtime profiles", () => {
  it("enforces the operator-facing simulation and sandbox-start values", () => {
    const expectedProfiles = [
      { key: "BASELINE", simulationMaxConcurrent: 5, sandboxStartMaxConcurrent: 5, admissionMax: 25 },
      { key: "R20", simulationMaxConcurrent: 20, sandboxStartMaxConcurrent: 20, admissionMax: 100 },
      { key: "R40", simulationMaxConcurrent: 40, sandboxStartMaxConcurrent: 40, admissionMax: 100 },
      { key: "R60", simulationMaxConcurrent: 60, sandboxStartMaxConcurrent: 60, admissionMax: 100 },
      { key: "R80", simulationMaxConcurrent: 80, sandboxStartMaxConcurrent: 80, admissionMax: 100 },
      { key: "R80_BURST", simulationMaxConcurrent: 80, sandboxStartMaxConcurrent: 80, admissionMax: 180 },
    ];

    for (const expected of expectedProfiles) {
      const profile = getCapacityProfile(expected.key);
      expect(profile).toMatchObject({
        simulationMaxConcurrent: expected.simulationMaxConcurrent,
        sandboxStartMaxConcurrent: expected.sandboxStartMaxConcurrent,
        admissionMax: expected.admissionMax,
      });
      expect(() => assertCapacityRuntimeMatches(profile, {
        serverMode: "docker",
        capacity: {
          simulation: { maxConcurrent: expected.simulationMaxConcurrent },
          sandboxStart: { maxConcurrent: expected.sandboxStartMaxConcurrent },
          admission: { max: expected.admissionMax },
        },
      })).not.toThrow();
    }
  });

  it("accepts only a Docker runtime that matches the requested profile", () => {
    const profile = getCapacityProfile("BASELINE");
    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      capacity: {
        simulation: { maxConcurrent: 5 },
        sandboxStart: { maxConcurrent: 5 },
        admission: { max: 25 },
      },
    })).not.toThrow();
    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "local",
      capacity: {
        simulation: { maxConcurrent: 5 },
        sandboxStart: { maxConcurrent: 5 },
        admission: { max: 25 },
      },
    })).toThrow(/serverMode.*docker/i);
  });

  it("fails before load when any requested runtime value is missing or different", () => {
    const profile = getCapacityProfile("R20");
    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      capacity: {
        simulation: { maxConcurrent: 5 },
        sandboxStart: { maxConcurrent: 5 },
        admission: { max: 25 },
      },
    })).toThrow(/simulationMaxConcurrent.*20.*5.*sandboxStartMaxConcurrent.*20.*5.*admissionMax.*100.*25/i);
    expect(() => assertCapacityRuntimeMatches(profile, {
      serverMode: "docker",
      capacity: { simulation: { maxConcurrent: 20 }, admission: { max: 100 } },
    })).toThrow(/sandboxStartMaxConcurrent.*20.*undefined/i);
  });

  it("rejects unknown profiles", () => {
    expect(() => getCapacityProfile("production")).toThrow(/unknown/i);
  });
});
