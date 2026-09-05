import { useCallback, useEffect, useState } from "react";
import type { OutputTab } from "@/types/compilation.types";
import type { ServerStatusEventData } from "@/types/external-api";
import type { IncomingArduinoMessage } from "@/types/websocket";
import type { SimulationStatus } from "@shared/types/arduino.types";
import {
  emitServerStatusEvent,
  emitSimulationStateEvent,
  useExternalApi,
} from "./use-external-api";

type StateSetter<T> = (value: T | ((previous: T) => T)) => void;
type InternalServerStatus = Pick<ServerStatusEventData, "pool" | "compile">;

interface UseSimulatorExternalControlParams {
  allowedOrigin: string;
  backendReachable: boolean;
  isConnected: boolean;
  compileAndStartAction: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  setCode: (code: string) => void;
  setSimulationStatus: StateSetter<SimulationStatus>;
  sendMessage: (message: IncomingArduinoMessage) => void;
  pinStates: Array<{ pin: number; value?: number }>;
  handleSerialSend: (data: string) => void;
  setSimulationTimeout: (timeout: number) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  simulationStatus: SimulationStatus;
  compilationStatus: string;
  serverStatus: InternalServerStatus | null;
}

export function useSimulatorExternalControl(
  params: UseSimulatorExternalControlParams,
): { pendingExternalStart: boolean } {
  const [pendingExternalStart, setPendingExternalStart] = useState(false);

  useEffect(() => {
    if (pendingExternalStart && params.isConnected && params.backendReachable) {
      setPendingExternalStart(false);
      params.compileAndStartAction();
    }
  }, [
    pendingExternalStart,
    params.isConnected,
    params.backendReachable,
    params.compileAndStartAction,
  ]);

  const handleExternalStartSimulation = useCallback(() => {
    if (params.isConnected && params.backendReachable) {
      params.compileAndStartAction();
    } else {
      setPendingExternalStart(true);
      params.setSimulationStatus("queued");
      emitSimulationStateEvent("QUEUED_FOR_COMPILING");
    }
  }, [params]);

  const handleExternalStopSimulation = useCallback(() => {
    setPendingExternalStart(false);
    params.handleStop();
  }, [params]);

  const deriveClientState = useCallback((): string => {
    if (pendingExternalStart) return "QUEUED_FOR_COMPILING";
    if (params.compilationStatus === "compiling") return "COMPILING";
    if (params.simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
    if (params.simulationStatus === "running") return "RUNNING";
    if (params.simulationStatus === "paused") return "PAUSED";
    return "IDLE";
  }, [pendingExternalStart, params.compilationStatus, params.simulationStatus]);

  useExternalApi({
    allowedOrigin: params.allowedOrigin,
    onLoadCode: params.setCode,
    onStartSimulation: handleExternalStartSimulation,
    onStopSimulation: handleExternalStopSimulation,
    onPauseSimulation: params.handlePause,
    onResumeSimulation: params.handleResume,
    onSetPinState: (pin, value) => {
      params.sendMessage({ type: "set_pin_value", pin, value });
    },
    getPinState: (pin) => {
      const found = params.pinStates.find((pinState) => pinState.pin === pin);
      return found?.value ?? 0;
    },
    onSerialInput: params.handleSerialSend,
    onSetSimulationTimeout: params.setSimulationTimeout,
    onSetOutputTab: params.setActiveOutputTab,
    getSimulationState: deriveClientState,
    getServerStatus: () => params.serverStatus && {
      serverReachable: params.backendReachable,
      pool: params.serverStatus.pool,
      compile: params.serverStatus.compile,
    },
  });

  useEffect(() => {
    if (!params.serverStatus) return;
    emitServerStatusEvent({
      serverReachable: params.backendReachable,
      pool: params.serverStatus.pool,
      compile: params.serverStatus.compile,
    });
  }, [params.serverStatus, params.backendReachable]);

  return { pendingExternalStart };
}