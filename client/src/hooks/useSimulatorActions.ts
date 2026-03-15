/**
 * useSimulatorActions Hook
 * 
 * Encapsulates simulator control actions (start, stop, reset, compile & run).
 * Provides a clean interface for simulator control components.
 * 
 * This hook wraps and centralizes the simulator action handlers that were
 * previously scattered across ArduinoSimulatorPage, reducing coupling and
 * improving testability.
 */

import { useCallback } from "react";

/**
 * Actions that can be performed on the simulator
 */
interface SimulatorActions {
  /** Start a previously compiled sketch or return early if already running */
  handleStart: () => void;
  
  /** Stop the running simulation and clean up state */
  handleStop: () => void;
  
  /** Pause a running simulation (preserves state) */
  handlePause: () => void;
  
  /** Resume a paused simulation */
  handleResume: () => void;
  
  /** Reset simulator state (clear outputs, reset pins) */
  handleReset: () => void;
  
  /** Compile the current sketch and start simulation on success */
  handleCompileAndStart: () => void;
}

/**
 * Parameters required by useSimulatorActions
 */
interface UseSimulatorActionsParams {
  // Action implementations from parent hooks (useCompileAndRun, useSimulation, etc.)
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onCompileAndStart: () => void;
}

/**
 * Hook that manages simulator control actions.
 * 
 * Acts as an organizational layer that:
 * - Centralizes simulator action handlers
 * - Provides a consistent interface for components
 * - Ensures proper sequencing and state management
 * 
 * @param params Action implementations from useCompileAndRun hook
 * @returns SimulatorActions interface with memoized handlers
 */
export function useSimulatorActions(params: UseSimulatorActionsParams): SimulatorActions {
  // Memoize all handlers to prevent unnecessary re-renders in child components
  const handleStart = useCallback(() => {
    params.onStart();
  }, [params]);

  const handleStop = useCallback(() => {
    params.onStop();
  }, [params]);

  const handlePause = useCallback(() => {
    params.onPause();
  }, [params]);

  const handleResume = useCallback(() => {
    params.onResume();
  }, [params]);

  const handleReset = useCallback(() => {
    params.onReset();
  }, [params]);

  const handleCompileAndStart = useCallback(() => {
    params.onCompileAndStart();
  }, [params]);

  return {
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleReset,
    handleCompileAndStart,
  };
}
