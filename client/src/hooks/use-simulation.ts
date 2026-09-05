import { useRef } from "react";
import { useSimulationControls, UseSimulationControlsParams, SimulationStatus } from "./use-simulation-controls";

// re-export types removed (unused exports per knip)

// The hook accepts the same parameters as `useSimulationControls` plus a few
// extras that are required by the lifecycle automation.  A parent may also
// provide an optional `startSimulationRef` so it can invoke the start action
// before the hook itself is instantiated (used by the page when wiring up
// the compilation hook).
type UseSimulationParams = UseSimulationControlsParams & {
  startSimulationRef?: React.MutableRefObject<(() => void) | null>;
  // forwarded to lifecycle hook
  code: string;
  clearOutputs?: () => void;
  handlePause?: () => void;
  handleResume?: () => void;
  handleReset?: () => void;
  hasCompilationErrors?: boolean;
};

interface UseSimulationResult {
  // state values (mirrors useSimulationControls)
  simulationStatus: SimulationStatus;
  setSimulationStatus: React.Dispatch<React.SetStateAction<SimulationStatus>>;
  hasCompiledOnce: boolean;
  setHasCompiledOnce: React.Dispatch<React.SetStateAction<boolean>>;
  simulationTimeout: number;
  setSimulationTimeout: React.Dispatch<React.SetStateAction<number>>;

  // mutations returned by the underlying controls hook (for tests/inspection)
  startMutation: ReturnType<typeof useSimulationControls>["startMutation"];
  stopMutation: ReturnType<typeof useSimulationControls>["stopMutation"];
  pauseMutation: ReturnType<typeof useSimulationControls>["pauseMutation"];
  resumeMutation: ReturnType<typeof useSimulationControls>["resumeMutation"];

  // action helpers (same names as before to minimise page changes)
  handleStart: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleReset: () => void;

  // allow external callers (eg. useCompilation) to start the sim directly
  startSimulation: () => void;

  // lifecycle helper: caller can suppress the auto-stop behaviour once
  suppressAutoStopOnce: () => void;

  // ref that will be populated with the "real" start function
  startSimulationRef: React.MutableRefObject<(() => void) | null>;
}

export function useSimulation(params: UseSimulationParams): UseSimulationResult {
  // honour an external ref if supplied; otherwise create our own
  const internalRef = useRef<(() => void) | null>(null);
  const startSimulationRef = params.startSimulationRef ?? internalRef;

  // delegate to the existing controls hook; this preserves all existing
  // behaviour including stop/start/pause/resume/reset.  we still spread the
  // ref so the underlying hook can populate it for callers.
  const controls = useSimulationControls({ ...params, startSimulationRef });

  return {
    ...controls,
    suppressAutoStopOnce: controls.suppressAutoStopOnce,
    startSimulationRef,
    startSimulation: controls.handleStart,
  };
}
