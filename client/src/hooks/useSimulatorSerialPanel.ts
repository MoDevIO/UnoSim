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
  clearSerialOutput: (port?: number) => void;
  /** The port the monitor shows: typing and Clear act on it (0 = `Serial`). */
  serialPort?: number;
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
  const serialPort = params.serialPort ?? 0;

  const handleSerialSend = useCallback(
    (message: string, port = 0) => {
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

      sendMessage({ type: "serial_input", data: message, ...(port === 0 ? {} : { port }) });
      setSerialInputValue("");
    },
    [ensureBackendConnected, simulationStatus, toast, setTxActivity, sendMessage, setSerialInputValue, params.capabilities],
  );

  const handleSerialInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSerialSend(serialInputValue, serialPort);
      }
    },
    [handleSerialSend, serialInputValue, serialPort],
  );

  const handleClearOutput = useCallback(() => {
    if (serialPort === 0) clearSerialOutput();
    else clearSerialOutput(serialPort);
  }, [clearSerialOutput, serialPort]);

  return {
    handleSerialSend,
    handleSerialInputKeyDown,
    handleClearSerialOutput: handleClearOutput,
  };
}
