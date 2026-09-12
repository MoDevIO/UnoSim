import { describe, expect, it, afterEach } from "vitest";
import { config } from "../../../../server/config";
import { decideExecutionRoute } from "../../../../server/services/sandbox/execution-phases/router-phase";
import type { ExecutionState } from "../../../../server/services/sandbox/execution-manager";

const dockerReadyState = { dockerAvailable: true, dockerImageBuilt: true } as ExecutionState;
const dockerUnavailableState = { dockerAvailable: false, dockerImageBuilt: false } as ExecutionState;

describe("decideExecutionRoute", () => {
  const originalSimulationMode = config.simulationMode;
  const originalServerMode = config.serverMode;

  afterEach(() => {
    (config as { simulationMode: typeof config.simulationMode }).simulationMode = originalSimulationMode;
    (config as { serverMode: typeof config.serverMode }).serverMode = originalServerMode;
  });

  it("keeps local simulation local even when Docker is ready", () => {
    (config as { simulationMode: "local" }).simulationMode = "local";

    expect(decideExecutionRoute(dockerReadyState)).toEqual({
      useDocker: false,
      shouldThrowOnNoDocker: false,
    });
  });

  it("keeps local simulation local when Docker is unavailable", () => {
    (config as { simulationMode: "local" }).simulationMode = "local";

    expect(decideExecutionRoute(dockerUnavailableState).useDocker).toBe(false);
  });

  it("uses Docker for docker-sandbox when Docker is ready", () => {
    (config as { simulationMode: "docker-sandbox" }).simulationMode = "docker-sandbox";

    expect(decideExecutionRoute(dockerReadyState).useDocker).toBe(true);
  });

  it("falls back locally for docker-sandbox when local server mode has no Docker", () => {
    (config as { simulationMode: "docker-sandbox" }).simulationMode = "docker-sandbox";
    (config as { serverMode: "local" }).serverMode = "local";

    expect(decideExecutionRoute(dockerUnavailableState)).toEqual({
      useDocker: false,
      shouldThrowOnNoDocker: false,
    });
  });

  it("preserves the production no-Docker throw policy", () => {
    (config as { simulationMode: "docker-sandbox" }).simulationMode = "docker-sandbox";
    (config as { serverMode: "docker" }).serverMode = "docker";

    expect(decideExecutionRoute(dockerUnavailableState)).toEqual({
      useDocker: false,
      shouldThrowOnNoDocker: true,
    });
  });
});
