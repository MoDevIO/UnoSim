import { useArduinoSimulatorPageCore, type ArduinoSimulatorPageState } from "./useArduinoSimulatorPageImplCore";

export function useArduinoSimulatorPage(): ArduinoSimulatorPageState {
  return useArduinoSimulatorPageCore();
}

export type { ArduinoSimulatorPageState };
