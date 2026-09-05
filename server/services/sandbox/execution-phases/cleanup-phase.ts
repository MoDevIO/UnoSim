// execution-phases/cleanup-phase.ts
// Verantwortlichkeit: Cleanup nach Ausführung
// - Batchers flushen und stoppen
// - Message Queue leeren
// - Docker-Container cleanup

import type { Logger } from "@shared/logger";
import type { ProcessExecution } from "../../process-execution-port";
import type { ExecutionState } from "../execution-manager";

export interface CleanupDependencies {
  processExecutor: ProcessExecution;
  logger: Logger;
}

/**
 * Flush die Message Queue und sendet alle queued Messages an Callbacks
 */
export function flushMessageQueue(state: ExecutionState): void {
  if (state.messageQueue.length === 0) {
    return;
  }

  const queue = state.messageQueue;
  state.messageQueue = [];

  for (const msg of queue) {
    if (msg.type === "pinState" && state.pinStateCallback) {
      state.pinStateCallback(msg.data.pin, msg.data.stateType, msg.data.value);
    } else if (msg.type === "output" && state.onOutputCallback) {
      state.onOutputCallback(msg.data.line, msg.data.isComplete);
    } else if (msg.type === "error" && state.errorCallback) {
      state.errorCallback(msg.data.line);
    }
  }
}

/**
 * Stoppt Batchers (SerialOutputBatcher und PinStateBatcher)
 */
export function flushBatchers(state: ExecutionState): void {
  if (state.serialOutputBatcher) {
    state.serialOutputBatcher.stop();
  }
  if (state.pinStateBatcher) {
    state.pinStateBatcher.stop();
  }
}

/**
 * Räumt Docker-Container auf
 */
export async function cleanupDockerContainer(
  containerName: string | undefined,
  deps: CleanupDependencies,
): Promise<void> {
  if (!containerName) {
    return;
  }

  try {
    await deps.processExecutor.execute("docker", ["rm", "-f", containerName], {
      timeout: 5000,
      stdio: "pipe",
    });
    deps.logger.info(`Docker container cleanup: ${containerName}`);
  } catch (error) {
    deps.logger.debug(`Docker cleanup failed for ${containerName}: ${error}`);
  }
}
