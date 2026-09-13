import type { IOPinRecord } from "@shared/schema";
import type { SimulationStatus } from "@shared/types/arduino.types";

/**
 * Runtime snapshots are authoritative while a simulation is running (or
 * paused). Before the first runtime snapshot, and after the run has ended,
 * the current static analysis remains visible.
 */
export function getEffectiveIoRegistry(
  staticIoRegistry: IOPinRecord[],
  runtimeIoRegistry: IOPinRecord[] | null,
  simulationStatus: SimulationStatus,
): IOPinRecord[] {
  const simulationActive =
    simulationStatus === "running" || simulationStatus === "paused";

  return simulationActive && runtimeIoRegistry !== null
    ? runtimeIoRegistry
    : staticIoRegistry;
}
