import type { IProcessController } from "../../process-controller";
import type { ExecutionState } from "../execution-manager";
import type { SimulationState } from "../../simulation-state-machine";
import { DockerCommandBuilder } from "../../docker-command-builder";
import { SANDBOX_CONFIG } from "../execution-manager";

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
 * Context für die Docker-Start-Phase
 * Enthält nur die minimal benötigten Abhängigkeiten für Docker-Spawn
 */
export interface DockerStartContext {
  processController: IProcessController;
  transitionTo: TransitionToFn;
}

/**
 * Parameter für Docker-Start
 */
export interface DockerStartParams {
  sketchDir: string;
  containerName: string;
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

/**
 * Docker-Start-Phase: Startet den Docker-Container für Compile + Run
 * 
 * Verantwortlichkeit:
 * - Docker-Command-Build
 * - Docker-Spawn
 * - processStartTime setzen
 * - State-Transition zu RUNNING
 * 
 * NICHT enthalten:
 * - Semaphore-Acquire (Gatekeeper-Phase)
 * - setupDockerHandlers (Stream-Phase)
 * - onClose-Cleanup (Cleanup-Phase)
 */
export async function runDockerStart(
  params: DockerStartParams,
  state: ExecutionState,
  context: DockerStartContext,
): Promise<string[]> {
  const { processController, transitionTo } = context;

  // Docker-Command bauen
  const dockerArgs = DockerCommandBuilder.buildSecureRunCommand({
    sketchDir: params.sketchDir,
    memoryMB: SANDBOX_CONFIG.maxMemoryMB,
    cpuLimit: SANDBOX_CONFIG.cpuLimit,
    pidsLimit: 50,
    imageName: SANDBOX_CONFIG.dockerImage,
    command: DockerCommandBuilder.buildCompileAndRunCommand(),
    containerName: params.containerName,
  });

  // Process-Spawn
  state.processController.clearListeners();
  await processController.spawn("docker", dockerArgs);
  
  // Startzeit setzen
  state.processStartTime = Date.now();
  
  // State-Transition zu RUNNING
  transitionTo(state, "running");

  return dockerArgs;
}
