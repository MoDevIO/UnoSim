import { describe, expect, it } from "vitest";
import {
  collectDockerProbe,
  collectHostProbe,
  measureDockerControlLatency,
  type DockerProbeDependencies,
  type HostProbeDependencies,
} from "../../scripts/capacity-calibration-host";

function hostDeps(overrides: Partial<HostProbeDependencies> = {}): HostProbeDependencies {
  return {
    run: async (file, args) => {
      if (file === "git" && args[0] === "rev-parse") return { stdout: "abc123\n" };
      if (file === "git" && args[0] === "status") return { stdout: "" };
      return { stdout: "" };
    },
    logicalCpus: () => 8,
    architecture: "x64",
    nodeVersion: "v24.20.0",
    ...overrides,
  };
}

function dockerDeps(overrides: Partial<DockerProbeDependencies> = {}): DockerProbeDependencies {
  return {
    run: async (args) => {
      if (args[0] === "version") return { stdout: "29.8.0|29.8.0\n" };
      if (args[0] === "info") return { stdout: JSON.stringify({ Architecture: "amd64", NCPU: 8, MemTotal: 16_000, Driver: "overlay2" }) };
      if (args[0] === "image") return { stdout: JSON.stringify({ Id: "sha256:image", RepoDigests: ["unosim@sha256:digest"] }) };
      if (args[0] === "ps") return { stdout: JSON.stringify({ ID: "abc", Names: "other", Image: "postgres", Status: "Up", Labels: "app=other" }) + "\n" };
      throw new Error(`unexpected docker args ${args.join(" ")}`);
    },
    ...overrides,
  };
}

describe("host calibration probes", () => {
  it("collects required identity and marks optional signals null when unavailable", async () => {
    const result = await collectHostProbe(hostDeps({
      optional: {
        physicalMemoryBytes: null,
        loadAverage: null,
        availableMemoryBytes: null,
        swapUsedBytes: null,
        iowaitPercent: null,
        thermalPressure: null,
      },
    }));
    expect(result.required).toEqual({
      gitSha: "abc123",
      gitDirty: false,
      nodeVersion: "v24.20.0",
      architecture: "x64",
      logicalCpus: 8,
    });
    expect(result.optional.availableMemoryBytes).toBeNull();
    expect(result.safetySignals).toEqual({ cpuAvailable: true, memoryAvailable: false });
  });

  it("fails when a required Git identity probe is unavailable", async () => {
    await expect(collectHostProbe(hostDeps({
      run: async () => { throw new Error("git unavailable"); },
    }))).rejects.toThrow(/git unavailable/);
  });
});

describe("Docker calibration probes", () => {
  it("captures daemon, image, storage, and unrelated workload fingerprints", async () => {
    const result = await collectDockerProbe("unosim-sandbox:latest", dockerDeps());
    expect(result).toMatchObject({
      clientVersion: "29.8.0",
      serverVersion: "29.8.0",
      architecture: "amd64",
      cpus: 8,
      memoryBytes: 16_000,
      storageDriver: "overlay2",
      daemonHealthy: true,
      image: { reference: "unosim-sandbox:latest", id: "sha256:image", digest: "unosim@sha256:digest" },
    });
    expect(result.runningContainers[0]).toMatchObject({ name: "other", image: "postgres" });
  });

  it("fails fast when Docker daemon health cannot be read", async () => {
    await expect(collectDockerProbe("unosim-sandbox:latest", dockerDeps({
      run: async (args) => args[0] === "info" ? Promise.reject(new Error("daemon unavailable")) : { stdout: "" },
    }))).rejects.toThrow(/daemon unavailable/);
  });
});

describe("Docker control latency probes", () => {
  it("keeps idle and parallel duration samples separated by command", async () => {
    let calls = 0;
    const result = await measureDockerControlLatency("unosim-sandbox:latest", 3, 2, {
      run: async () => {
        calls++;
        return { stdout: "ok" };
      },
      now: (() => {
        let time = 0;
        return () => (time += 10);
      })(),
    });
    expect(calls).toBe(24);
    expect(result).toHaveLength(6);
    expect(result.filter((sample) => sample.condition === "idle")).toHaveLength(3);
    expect(result.filter((sample) => sample.condition === "parallel")).toHaveLength(3);
    expect(result.every((sample) => sample.durationsMs.length > 0)).toBe(true);
  });

  it("records command errors without fabricating a duration", async () => {
    const result = await measureDockerControlLatency("unosim-sandbox:latest", 1, 1, {
      run: async () => Promise.reject(new Error("control timeout")),
    });
    expect(result.every((sample) => sample.durationsMs.length === 0)).toBe(true);
    expect(result.every((sample) => sample.error === "control timeout")).toBe(true);
  });
});
