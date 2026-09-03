import { useCompileControllerState } from "./use-compile-controller-state";
import { useSimulationControllerState } from "./use-simulation-controller-state";

/** Owns the mutable compile/simulation state shared by the controller actions. */
export function useSimulatorControllerState() {
  return { ...useCompileControllerState(), ...useSimulationControllerState() };
}
