import { useState, useEffect, useCallback } from "react";

interface UsePinStateParams {
  resetPinStates: () => void;
}

export function usePinState({ resetPinStates }: UsePinStateParams) {
  // Analog pins detected in the code that need sliders (internal pin numbers 14..19)
  const [analogPinsUsed, setAnalogPinsUsed] = useState<number[]>([]);

  // Detected explicit pinMode(...) declarations found during parsing.
  // We store modes for pins so that we can apply them when the simulation starts.
  const [detectedPinModes, setDetectedPinModes] = useState<
    Record<number, "INPUT" | "OUTPUT" | "INPUT_PULLUP">
  >({});

  // Pins that have a detected pinMode(...) declaration which conflicts with analogRead usage
  const [pendingPinConflicts, setPendingPinConflicts] = useState<number[]>([]);

  // Pin Monitor visibility state (persisted to localStorage)
  const [pinMonitorVisible, setPinMonitorVisible] = useState<boolean>(() => {
    try {
      return globalThis.localStorage.getItem("unoPinMonitorVisible") === "1";
    } catch {
      return false; // Hidden by default
    }
  });

  // Listen for pin monitor visibility change events from settings dialog
  useEffect(() => {
    const handler = (ev: any) => {
      try {
        const newValue = Boolean(ev?.detail?.value);
        setPinMonitorVisible(newValue);
      } catch {
        // ignore
      }
    };
    document.addEventListener("pinMonitorVisibleChange", handler as EventListener);
    return () =>
      document.removeEventListener("pinMonitorVisibleChange", handler as EventListener);
  }, []);

  // Centralized helper to reset UI pin-related state. Pass { keepDetected: true }
  // to preserve detected pinMode declarations and pending conflicts when desired.
  const resetPinUI = useCallback(
    (opts?: { keepDetected?: boolean }) => {
      resetPinStates();
      // Only clear detected/derived data when keepDetected is not requested.
      if (!opts?.keepDetected) {
        setAnalogPinsUsed([]);
        setDetectedPinModes({});
        setPendingPinConflicts([]);
      }
    },
    [resetPinStates],
  );

  // Helper function to convert pin strings to numbers (A0-A5 → 14-19, digital → as-is)
  const pinToNumber = (pinStr: string): number | null => {
    if (/^\d+$/.test(pinStr)) {
      return Number.parseInt(pinStr, 10);
    }
    if (/^A\d+$/i.test(pinStr)) {
      const analogIndex = Number.parseInt(pinStr.slice(1), 10);
      if (analogIndex >= 0 && analogIndex <= 5) {
        return 14 + analogIndex; // A0->14, A1->15, ..., A5->19
      }
    }
    return null;
  };

  return {
    analogPinsUsed,
    setAnalogPinsUsed,
    detectedPinModes,
    setDetectedPinModes,
    pendingPinConflicts,
    setPendingPinConflicts,
    pinMonitorVisible,
    setPinMonitorVisible,
    resetPinUI,
    pinToNumber,
  };
}
