import { describe, expect, it } from "vitest";
import * as configModule from "../../server/config";
import { getClientConfig, parseCapacityTestRunId, parseEnvInt, parseListenHost, parseRuntimeProfile, rejectObsoleteTutorCurriculumEnv, validateSimulationCapacity } from "../../server/config";

describe("central configuration validation", () => {
  it("provides one parser for the complete runtime profile", () => {
    expect(configModule).toHaveProperty("parseRuntimeProfile");
  });

  it("derives the two supported runtime profiles and the Docker test bypass", () => {
    expect(parseRuntimeProfile({ NODE_ENV: "development" })).toEqual({
      nodeEnv: "development",
      serverMode: "local",
      dockerTestBypassGateway: false,
    });
    expect(parseRuntimeProfile({ NODE_ENV: "production" })).toEqual({
      nodeEnv: "production",
      serverMode: "docker",
      dockerTestBypassGateway: false,
    });
    expect(parseRuntimeProfile({
      NODE_ENV: "test",
      UNOSIM_SERVER_MODE: "docker",
      UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
    })).toEqual({
      nodeEnv: "test",
      serverMode: "docker",
      dockerTestBypassGateway: true,
    });
  });

  it.each([
    [{ NODE_ENV: "production", UNOSIM_SERVER_MODE: "local" }, /production.*docker/i],
    [{ NODE_ENV: "development", UNOSIM_SERVER_MODE: "docker" }, /development.*local/i],
    [{ NODE_ENV: "production", UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1" }, /only.*NODE_ENV=test/i],
    [{ NODE_ENV: "test", UNOSIM_SERVER_MODE: "local", UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1" }, /only.*docker/i],
    [{ NODE_ENV: "test", UNOSIM_SERVER_MODE: "docker", UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "true" }, /must be 1/i],
    [{ NODE_ENV: "staging" }, /NODE_ENV/i],
  ] as const)("rejects unsupported runtime profile %#", (env, message) => {
    expect(() => parseRuntimeProfile(env)).toThrow(message);
  });

  it.each([
    "UNOSIM_SIMULATION_MODE",
    "UNOSIM_TRUST_MODE",
    "FORCE_DOCKER",
    "UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL",
    "SANDBOX_POOL_MIN_RUNNERS",
    "SANDBOX_POOL_MAX_RUNNERS",
    "DOCKER_COMPILE_CONCURRENT",
  ])("rejects the removed topology selector %s", (key) => {
    expect(() => parseRuntimeProfile({ NODE_ENV: "test", [key]: "legacy" })).toThrow(
      new RegExp(`${key}.*no longer supported`),
    );
  });

  it("exposes one semantic capacity configuration with unchanged defaults", () => {
    expect(configModule.config.capacity).toEqual({
      simulationMaxConcurrent: 5,
      sandboxStartMaxConcurrent: 8,
      admissionMax: 25,
      queueTimeoutMs: 60_000,
      sandboxStartSlotTimeoutMs: 30_000,
    });
  });

  it("rejects malformed, fractional and out-of-range integers", () => {
    expect(() => parseEnvInt("PORT", "abc", 3000, { min: 1, max: 65535 })).toThrow(/expected an integer/);
    expect(() => parseEnvInt("PORT", "3.5", 3000, { min: 1, max: 65535 })).toThrow(/expected an integer/);
    expect(() => parseEnvInt("PORT", "70000", 3000, { min: 1, max: 65535 })).toThrow(/between/);
  });

  it("preserves defaults and accepts valid integer values", () => {
    expect(parseEnvInt("PORT", undefined, 3000, { min: 1, max: 65535 })).toBe(3000);
    expect(parseEnvInt("PORT", "8080", 3000, { min: 1, max: 65535 })).toBe(8080);
  });

  it("keeps Docker control checks at 2000ms by default and validates overrides", () => {
    expect(parseEnvInt("DOCKER_CONTROL_TIMEOUT_MS", undefined, 2_000, { min: 100, max: 30_000 })).toBe(2_000);
    expect(parseEnvInt("DOCKER_CONTROL_TIMEOUT_MS", "10000", 2_000, { min: 100, max: 30_000 })).toBe(10_000);
    expect(() => parseEnvInt("DOCKER_CONTROL_TIMEOUT_MS", "99", 2_000, { min: 100, max: 30_000 })).toThrow(/between/);
    expect((configModule.config.sandbox as { dockerControlTimeoutMs?: number }).dockerControlTimeoutMs).toBe(2_000);
  });

  it("rejects an inverted sandbox pool range", () => {
    expect(() => validateSimulationCapacity(5, 2, "local")).toThrow(/must not exceed/);
    expect(() => validateSimulationCapacity(2, 5, "local")).not.toThrow();
  });

  it("allows safe capacity run IDs only in the test runtime", () => {
    expect(parseCapacityTestRunId(undefined, "production")).toBeUndefined();
    expect(parseCapacityTestRunId("capacity_R20_burst_123", "test")).toBe(
      "capacity_R20_burst_123",
    );
    expect(() => parseCapacityTestRunId("capacity_R20_123", "production")).toThrow(
      /allowed only with NODE_ENV=test/i,
    );
    expect(() => parseCapacityTestRunId("capacity run 123", "test")).toThrow(
      /URL-safe test run identifier/i,
    );
  });

  it("requires at least one warm runner for Docker readiness", () => {
    expect(() => validateSimulationCapacity(0, 0, "docker")).toThrow(/SIMULATION_MAX_CONCURRENT.*at least 1/i);
    expect(() => validateSimulationCapacity(0, 1, "local")).not.toThrow();
  });

  it("keeps local mode on loopback by default", () => {
    expect(parseListenHost("local", undefined)).toBe("127.0.0.1");
  });

  it("allows an explicit LAN listener without changing local trust mode", () => {
    expect(parseListenHost("local", "0.0.0.0")).toBe("0.0.0.0");
  });

  it("keeps gateway mode on all interfaces by default", () => {
    expect(parseListenHost("gateway", undefined)).toBe("0.0.0.0");
  });

  it("exposes only non-secret tutor configuration to the browser", () => {
    const clientConfig = getClientConfig();
    expect(clientConfig).not.toHaveProperty("simulationMode");
    expect(clientConfig.tutor).toEqual({ provider: "kiconnect" });
    expect(clientConfig.tutor).not.toHaveProperty("baseUrl");
    expect(clientConfig.tutor).not.toHaveProperty("managedApiKey");
  });

  it.each([
    "UNOSIM_TUTOR_CURRICULUM_SOURCE",
    "UNOSIM_TUTOR_CURRICULUM_COMMIT",
    "UNOSIM_TUTOR_CURRICULUM_ALLOWED_HOSTS",
    "UNOSIM_TUTOR_CURRICULUM_REFRESH_MS",
    "UNOSIM_TUTOR_CURRICULUM_TIMEOUT_MS",
    "UNOSIM_TUTOR_CURRICULUM_MAX_MANIFEST_BYTES",
    "UNOSIM_TUTOR_CURRICULUM_MAX_TOPIC_BYTES",
    "UNOSIM_TUTOR_CURRICULUM_MAX_TOTAL_BYTES",
  ])("tombstones obsolete Tutor repository configuration %s", (key) => {
    expect(() => rejectObsoleteTutorCurriculumEnv({ [key]: "legacy" })).toThrow(new RegExp(`${key}.*Course Content`));
  });
});
