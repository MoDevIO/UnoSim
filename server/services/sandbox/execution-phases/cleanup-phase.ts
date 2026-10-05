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
): Promise<boolean> {
  if (!containerName) {
    return true;
  }

  try {
    const result = await deps.processExecutor.execute("docker", ["rm", "-f", containerName], {
      timeout: 5000,
      stdio: "pipe",
    });
    if (result.code !== 0 || result.error) {
      // docker run uses --rm. A failed rm can mean auto-removal, but only a
      // successful daemon listing can establish absence (not an error string).
      // A name filter can conservatively match more than the exact name;
      // an empty successful listing still proves this container is absent.
      const remaining = await deps.processExecutor.execute("docker", [
        "container", "ls", "--all", "--filter", `name=${containerName}`, "--quiet",
      ], { timeout: 5000, stdio: "pipe" });
      if (remaining.code !== 0 || remaining.error || remaining.stdout?.trim() !== "") {
        deps.logger.warn(`Docker cleanup failed for ${containerName} (code ${result.code})`);
        return false;
      }
    }
    deps.logger.info(`Docker container cleanup: ${containerName}`);
    return true;
  } catch (error) {
    deps.logger.debug(`Docker cleanup failed for ${containerName}: ${error}`);
    return false;
  }
}


// Natural close, deadline and explicit Stop must join the same removal. The
// weak key retains no completed sessions; each runner owns at most one flight.
const cleanupFlights = new WeakMap<ExecutionState, { name: string; completion: Promise<void> }>();

export function cleanupExecutionContainer(state: ExecutionState, deps: CleanupDependencies): Promise<void> {
  const name = state.currentContainerName;
  if (!name) return Promise.resolve();
  const pending = cleanupFlights.get(state);
  if (pending?.name === name) return pending.completion;
  const generation = state.runGeneration;
  const flight = { name, completion: Promise.resolve() };
  flight.completion = cleanupDockerContainer(name, deps).then((removed) => {
    if (removed && state.runGeneration === generation && state.currentContainerName === name) {
      state.currentContainerName = undefined;
    }
  }).finally(() => {
    if (cleanupFlights.get(state) === flight) cleanupFlights.delete(state);
  });
  cleanupFlights.set(state, flight);
  return flight.completion;
}
