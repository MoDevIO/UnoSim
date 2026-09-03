import { useState } from "react";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { DockerGccPhase } from "./use-compile-and-run";

export function useSimulationControllerState() {
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("idle");
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [simulationTimeout, setSimulationTimeout] = useState(60);
  const [dockerGccPhase, setDockerGccPhase] = useState<DockerGccPhase>("idle");
  return { simulationStatus, setSimulationStatus, hasCompiledOnce, setHasCompiledOnce,
    simulationTimeout, setSimulationTimeout, dockerGccPhase, setDockerGccPhase };
}
