import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { ToastOptions } from "@/hooks/use-toast";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { SimulationStatus } from "@/hooks/use-simulation-controls";
import type { PinState } from "@/hooks/use-simulation-store";

export function useSimulatorPinControls(params: {
  sendMessage: (message: IncomingArduinoMessage) => void;
  simulationStatus: SimulationStatus;
  toast: (options: ToastOptions) => { id: string; dismiss: () => void; update: (options: ToastOptions) => void };
  setPinStates: Dispatch<SetStateAction<PinState[]>>;
}) {
  const { sendMessage, simulationStatus, toast, setPinStates } = params;

  const showSimulationNotActiveToast = useCallback(() => {
    toast({
      title: "Simulation not active",
      description: "Start the simulation to change pin values.",
      variant: "destructive",
    });
  }, [toast]);

  const handlePinToggle = useCallback(
    (pin: number, newValue: number) => {
      if (simulationStatus === "stopped") {
        showSimulationNotActiveToast();
        return;
      }

      // Send the new pin value to the server
      sendMessage({ type: "set_pin_value", pin, value: newValue });

      // Update local pin state immediately for responsive UI
      setPinStates((prev) => {
        const newStates = [...prev];
        const existingIndex = newStates.findIndex((p) => p.pin === pin);
        if (existingIndex >= 0) {
          newStates[existingIndex] = {
            ...newStates[existingIndex],
            value: newValue,
          };
        }
        return newStates;
      });
    },
    [simulationStatus, sendMessage, setPinStates, showSimulationNotActiveToast],
  );

  const handleAnalogChange = useCallback(
    (pin: number, newValue: number) => {
      if (simulationStatus === "stopped") {
        showSimulationNotActiveToast();
        return;
      }

      sendMessage({ type: "set_pin_value", pin, value: newValue });

      // Update local pin state immediately for responsive UI
      setPinStates((prev) => {
        const newStates = [...prev];
        const existingIndex = newStates.findIndex((p) => p.pin === pin);
        if (existingIndex >= 0) {
          newStates[existingIndex] = {
            ...newStates[existingIndex],
            value: newValue,
            type: "analog",
          };
        } else {
          newStates.push({ pin, mode: "INPUT", value: newValue, type: "analog" });
        }
        return newStates;
      });
    },
    [simulationStatus, sendMessage, setPinStates, showSimulationNotActiveToast],
  );

  return {
    handlePinToggle,
    handleAnalogChange,
  };
}
