// router-phase.ts
// Pure routing logic: decides between Docker and Local execution
// Extracted from ExecutionManager.setupSimulationProcess()

import { config } from "../../../config";
import type { ExecutionState } from "../execution-manager";

interface RouterDecision {
  useDocker: boolean;
  shouldThrowOnNoDocker: boolean;
}

/**
 * Pure routing function: decides between Docker and Local execution
 * 
 * @param state - Current execution state
 * @returns RouterDecision with routing information
 */
export function decideExecutionRoute(state: ExecutionState): RouterDecision {
  const useDocker =
    config.simulationMode === "docker-sandbox" &&
    !!(state.dockerAvailable && state.dockerImageBuilt);
  const shouldThrowOnNoDocker = config.serverMode === "docker" && config.simulationMode === "docker-sandbox";

  return {
    useDocker,
    shouldThrowOnNoDocker,
  };
}

