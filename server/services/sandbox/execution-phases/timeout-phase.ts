// execution-phases/timeout-phase.ts
// Verantwortlichkeit: Timeout nach Start der Ausführung
// - Timeout planen
// - Laufende Ausführung abbrechen
// - Timeout-Notification ausgeben
// - Optionalen Docker-Container aufräumen

import type { Logger } from "@shared/logger";
import type { ProcessExecution } from "../../process-execution-port";
import type { ExecutionState } from "../execution-manager";
import { cleanupDockerContainer } from "./cleanup-phase";

interface TimeoutScheduler {
  schedule(timeoutMs: number | null, callback: () => void): void;
}

interface TimeoutCallbacks {
  onOutput: (line: string, isComplete?: boolean) => void;
}

export interface TimeoutDependencies {
  processExecutor: ProcessExecution;
  logger: Logger;
}

/**
 * Bricht die laufende Ausführung ab.
 */
export function abortExecution(state: ExecutionState, signal: NodeJS.Signals = "SIGKILL"): void {
  state.processController.kill(signal);
}

/**
 * Behandelt einen abgelaufenen Execution-Timeout.
 */
export function handleExecutionTimeout(
  executionTimeout: number | undefined,
  state: ExecutionState,
  callbacks: TimeoutCallbacks,
  deps: TimeoutDependencies,
): void {
  abortExecution(state);
  callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);

  void cleanupDockerContainer(state.currentContainerName, deps);
}

/**
 * Plant den Execution-Timeout über den TimeoutManager.
 */
export function scheduleExecutionTimeout(
  timeoutManager: TimeoutScheduler,
  executionTimeout: number | undefined,
  state: ExecutionState,
  callbacks: TimeoutCallbacks,
  deps: TimeoutDependencies,
): void {
  const timeoutMs = executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null;

  timeoutManager.schedule(timeoutMs, () => {
    handleExecutionTimeout(executionTimeout, state, callbacks, deps);
  });
}
