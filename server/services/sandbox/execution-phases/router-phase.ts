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
  const useDocker = !!(state.dockerAvailable && state.dockerImageBuilt);
  const shouldThrowOnNoDocker = config.serverMode === "docker" && config.simulationMode === "docker-sandbox";

  return {
    useDocker,
    shouldThrowOnNoDocker,
  };
}

/**
 * Check if Docker route should be used
 * 
 * @param state - Current execution state
 * @returns true if Docker execution is available and should be used
 */
export function shouldUseDocker(state: ExecutionState): boolean {
  return !!(state.dockerAvailable && state.dockerImageBuilt);
}

/**
 * Check if local fallback should throw an error
 * 
 * @returns true if local fallback is forbidden in production mode
 */
export function shouldThrowOnLocalFallback(): boolean {
  return config.serverMode === "docker" && config.simulationMode === "docker-sandbox";
}
