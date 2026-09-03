import { useState } from "react";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import type { CompilerError } from "@/types/websocket";
import type { SimulationStatus } from "@shared/types/arduino.types";
import type { DockerGccPhase } from "./use-compile-and-run";

/** Owns the mutable compile/simulation state shared by the controller actions. */
export function useSimulatorControllerState() {
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("ready");
  const [arduinoCliStatus, setArduinoCliStatus] = useState<"idle" | "compiling" | "success" | "error">("idle");
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<CompilationResultType>(null);
  const [cliOutput, setCliOutput] = useState("");
  const [compilerErrors, setCompilerErrors] = useState<CompilerError[]>([]);
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("idle");
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [simulationTimeout, setSimulationTimeout] = useState(60);
  const [dockerGccPhase, setDockerGccPhase] = useState<DockerGccPhase>("idle");

  return {
    compilationStatus, setCompilationStatus, arduinoCliStatus, setArduinoCliStatus,
    hasCompilationErrors, setHasCompilationErrors, lastCompilationResult,
    setLastCompilationResult, cliOutput, setCliOutput, compilerErrors, setCompilerErrors,
    simulationStatus, setSimulationStatus, hasCompiledOnce, setHasCompiledOnce,
    simulationTimeout, setSimulationTimeout, dockerGccPhase, setDockerGccPhase,
  };
}
