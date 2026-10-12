import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderCapacityEnv } from "../../scripts/capacity-calibration-report";
import type { CalibrationRunResult } from "../../scripts/calibrate-capacity";
import { parseEnvInt } from "../../server/config";

const repoRoot = join(__dirname, "../..");
const composePath = join(repoRoot, "docker-compose.yml");

/** Variable names the calibration proposes in capacity.env, taken from the report renderer itself. */
function capacityEnvVariables(): string[] {
  const notCalibrated = { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: [] };
  const result = {
    policyVersion: "1",
    policy: { expectedUsers: 1 },
    fingerprint: { gitSha: "test" },
    phases: { dockerControl: [], active: [], startup: [], classroom: null },
    recommendations: Object.fromEntries([
      "simulationMaxConcurrent", "sandboxStartMaxConcurrent", "simulationAdmissionMax", "simulationQueueTimeoutMs",
      "sandboxStartSlotTimeoutMs", "dockerControlTimeoutMs", "compileMaxConcurrent",
    ].map((name) => [name, notCalibrated])),
  } as unknown as CalibrationRunResult;
  return [...renderCapacityEnv(result).matchAll(/^#?\s*([A-Z][A-Z0-9_]+)(?:=| omitted)/gm)].map((match) => match[1]);
}

function composeBackendEnvironment(): string[] {
  const compose = parse(readFileSync(composePath, "utf8")) as { services: Record<string, { environment: string[] }> };
  return compose.services["unosim-backend"].environment;
}

const composeAvailable = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;

/** Environment of the backend service after real Compose interpolation of docker-compose.yml. */
function interpolatedBackendEnvironment(overrides: Record<string, string>): Record<string, string> {
  const result = spawnSync("docker", ["compose", "-f", composePath, "config", "--format", "json"], {
    encoding: "utf8",
    cwd: repoRoot,
    // Only what Compose needs: host UnoSim settings must not shadow the values under test.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PWD: repoRoot,
      DOCKER_GID: "999",
      UNOSIM_GATEWAY_SECRET: "g".repeat(32),
      UNOSIM_TRUSTED_PROXY: "127.0.0.1",
      UNOSIM_ALLOWED_WS_ORIGINS: "https://classroom.example.edu",
      ...overrides,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as { services: Record<string, { environment: Record<string, string> }> };
  return parsed.services["unosim-backend"].environment;
}

describe("docker-compose capacity pass-through", () => {
  it("reads the capacity.env variable list from the report renderer", () => {
    expect(capacityEnvVariables().sort()).toEqual([
      "COMPILE_MAX_CONCURRENT",
      "DOCKER_CONTROL_TIMEOUT_MS",
      "SANDBOX_START_MAX_CONCURRENT",
      "SANDBOX_START_SLOT_TIMEOUT_MS",
      "SIMULATION_ADMISSION_MAX",
      "SIMULATION_MAX_CONCURRENT",
      "SIMULATION_QUEUE_TIMEOUT_MS",
    ]);
  });

  it("forwards every variable of a capacity.env proposal from .env to the backend container", () => {
    const environment = composeBackendEnvironment();
    for (const name of capacityEnvVariables()) {
      const entry = environment.find((candidate) => candidate.startsWith(`${name}=`));
      expect(entry, `${name} must be passed to unosim-backend`).toBeDefined();
      expect(entry, `${name} must take its value from .env`).toMatch(new RegExp(String.raw`^${name}=\$\{${name}(:-[^}]*)?\}$`));
    }
  });

  it.skipIf(!composeAvailable)("delivers .env values to the container after real Compose interpolation", () => {
    const names = capacityEnvVariables();
    const overrides = Object.fromEntries(names.map((name, index) => [name, String(1_000 + index)]));

    const environment = interpolatedBackendEnvironment(overrides);

    for (const name of names) expect(environment[name], name).toBe(overrides[name]);
  });

  it.skipIf(!composeAvailable)("keeps the previous defaults when .env sets nothing", () => {
    const environment = interpolatedBackendEnvironment({});

    expect(environment.SIMULATION_MAX_CONCURRENT).toBe("200");
    expect(environment.SIMULATION_ADMISSION_MAX).toBe("25");
    // Not a second default: empty falls back to the application default in server/config.ts.
    expect(environment.SIMULATION_QUEUE_TIMEOUT_MS).toBe("");
    expect(parseEnvInt("SIMULATION_QUEUE_TIMEOUT_MS", environment.SIMULATION_QUEUE_TIMEOUT_MS, 60_000)).toBe(60_000);
  });
});
