import { useCallback, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";

import type { ToastFn } from "@/hooks/use-toast";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { SimulationStatus } from "@/hooks/use-simulation-controls";
import type { ServerCapabilities } from "@/lib/server-capabilities";

export function useSimulatorSerialPanel(params: {
  capabilities?: ServerCapabilities;
  sendMessage: (message: IncomingArduinoMessage) => void;
  simulationStatus: SimulationStatus;
  toast: ToastFn;
  setTxActivity: Dispatch<SetStateAction<number>>;
  serialInputValue: string;
  setSerialInputValue: Dispatch<SetStateAction<string>>;
  clearSerialOutput: () => void;
  ensureBackendConnected: (actionLabel: string) => boolean;
}) {
  const {
    sendMessage,
    simulationStatus,
    toast,
    setTxActivity,
    serialInputValue,
    setSerialInputValue,
    clearSerialOutput,
    ensureBackendConnected,
  } = params;

  const handleSerialSend = useCallback(
    (message: string) => {
      if (params.capabilities && !params.capabilities.canUseRealtimeControls) return;
      if (!ensureBackendConnected("Serial senden")) return;

      if (simulationStatus !== "running") {
        toast({
          title:
            simulationStatus === "paused"
              ? "Simulation paused"
              : "Simulation not running",
          description:
            simulationStatus === "paused"
              ? "Resume the simulation to send serial input."
              : "Start the simulation to send serial input.",
          variant: "destructive",
        });
        return;
      }

      // Trigger TX LED blink when client sends data
      setTxActivity((prev) => prev + 1);

      sendMessage({ type: "serial_input", data: message });
      setSerialInputValue("");
    },
    [ensureBackendConnected, simulationStatus, toast, setTxActivity, sendMessage, setSerialInputValue, params.capabilities],
  );

  const handleSerialInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSerialSend(serialInputValue);
      }
    },
    [handleSerialSend, serialInputValue],
  );

  const handleClearOutput = useCallback(() => {
    clearSerialOutput();
  }, [clearSerialOutput]);

  return {
    handleSerialSend,
    handleSerialInputKeyDown,
    handleClearSerialOutput: handleClearOutput,
  };
}
