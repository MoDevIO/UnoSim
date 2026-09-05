import type { IProcessController } from "../../process-controller";
import type { ExecutionState } from "../execution-manager";
import type { SimulationState } from "../../simulation-state-machine";

/**
 * Typ für die State-Transition-Funktion
 */
export type TransitionToFn = (state: ExecutionState, newState: SimulationState) => boolean;

/**
 * Context für die Local-Start-Phase
 * Enthält nur die minimal benötigten Abhängigkeiten für Process-Spawn
 */
export interface LocalStartContext {
  processController: IProcessController;
  transitionTo: TransitionToFn;
}

/**
 * Local-Start-Phase: Startet den lokalen Simulationsprozess
 * 
 * Verantwortlichkeit:
 * - Process-Spawn
 * - processStartTime setzen
 * - State-Transition zu RUNNING
 * 
 * NICHT enthalten:
 * - Kompilierung (Prepare-Phase)
 * - Event-Handler (Stream-Phase)
 * - Cleanup-Logik (Cleanup-Phase)
 */
export async function runLocalStart(
  exeFile: string,
  state: ExecutionState,
  context: LocalStartContext,
): Promise<void> {
  const { processController, transitionTo } = context;

  // Process-Spawn
  state.processController.clearListeners();
  await processController.spawn(exeFile);
  
  // Startzeit setzen
  state.processStartTime = Date.now();
  
  // State-Transition zu RUNNING
  transitionTo(state, "running");
}
