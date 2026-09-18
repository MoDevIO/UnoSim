import { describe, expect, it } from "vitest";
import * as configModule from "../../server/config";
import { getClientConfig, parseEnvInt, parseListenHost, parseRuntimeProfile, validatePoolBounds } from "../../server/config";

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
  ])("rejects the removed topology selector %s", (key) => {
    expect(() => parseRuntimeProfile({ NODE_ENV: "test", [key]: "legacy" })).toThrow(
      new RegExp(`${key}.*no longer supported`),
    );
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

  it("rejects an inverted sandbox pool range", () => {
    expect(() => validatePoolBounds(5, 2)).toThrow(/must not exceed/);
    expect(() => validatePoolBounds(2, 5)).not.toThrow();
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
    expect(clientConfig.tutor).toMatchObject({ mode: "disabled", provider: "kiconnect" });
    expect(clientConfig.tutor).not.toHaveProperty("baseUrl");
    expect(clientConfig.tutor).not.toHaveProperty("managedApiKey");
  });
});
