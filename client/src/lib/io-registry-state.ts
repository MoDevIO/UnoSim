import type { BoardId } from "@shared/boards";
import type { IOPinRecord } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";
import { mergeIoRegistry } from "./io-registry-merge";

/**
 * While a simulation runs (or is paused) the static analysis stays and the
 * runtime findings are merged into it, with their origin (plan 4.9, P3.7).
 * Before the first runtime snapshot, and after the run has ended, the current
 * static analysis alone is shown.
 */
export function getEffectiveIoRegistry(
  staticIoRegistry: IOPinRecord[],
  runtimeIoRegistry: IOPinRecord[] | null,
  simulationStatus: SimulationStatus,
  board?: BoardId,
): IOPinRecord[] {
  const simulationActive =
    simulationStatus === "running" || simulationStatus === "paused";

  return simulationActive && runtimeIoRegistry !== null
    ? mergeIoRegistry(staticIoRegistry, runtimeIoRegistry, board)
    : staticIoRegistry;
}
