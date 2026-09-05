// prepare-phase.ts
// Preparation and compilation phase for simulation execution
// Extracted from ExecutionManager.performCompilation()

import { config } from "../../../config";
import { Logger } from "@shared/logger";
import type { RunSketchOptions } from "../../run-sketch-types";
import type { ExecutionState } from "../execution-manager";
import { SimulationState } from "../execution-manager";
import type { LocalCompiler } from "../../local-compiler";
import { getUnifiedGatekeeper } from "../../unified-gatekeeper";

export interface PrepareContext {
  localCompiler: LocalCompiler;
  logger: Logger;
  transitionTo: (state: ExecutionState, newState: SimulationState) => boolean;
}

/**
 * Perform compilation with gatekeeper control
 * 
 * @param sketchFile - Path to the sketch file
 * @param exeFile - Path to the executable file
 * @param opts - Run options with compile callbacks
 * @param state - Current execution state
 * @param context - Dependency injection context
 * @returns Promise that resolves when compilation completes
 */
export async function performCompilation(
  sketchFile: string,
  exeFile: string,
  opts: RunSketchOptions,
  state: ExecutionState,
  context: PrepareContext,
): Promise<void> {
  const WAIT_TIMEOUT_MS = config.timeouts.compileGatekeeperAcquireMs;
  const gatekeeper = getUnifiedGatekeeper();
  let release: () => void;

  try {
    release = await Promise.race([
      gatekeeper.acquireCompileSlotHighPriority(
        "simulation-start",
        opts.onCompileQueued,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("compile-gatekeeper timeout")), WAIT_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    context.logger.error(`Gatekeeper wait failed: ${err instanceof Error ? err.message : String(err)}`);
    context.transitionTo(state, SimulationState.ERROR);
    throw err;
  }

  try {
    if (state.processController && context.localCompiler) {
      await context.localCompiler.compile(sketchFile, exeFile);
      if (opts.onCompileSuccess) opts.onCompileSuccess();
      await context.localCompiler.makeExecutable(exeFile);
    }
  } finally {
    try {
      release();
    } catch {
      // should never happen
    }
  }
}
