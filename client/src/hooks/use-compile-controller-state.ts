import { useState } from "react";
import type { CompilationStatus, CompilationResultType } from "@/types/compilation.types";
import type { CompilerError } from "@/types/websocket";

export function useCompileControllerState() {
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("ready");
  const [arduinoCliStatus, setArduinoCliStatus] = useState<"idle" | "compiling" | "success" | "error">("idle");
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<CompilationResultType>(null);
  const [cliOutput, setCliOutput] = useState("");
  const [compilerErrors, setCompilerErrors] = useState<CompilerError[]>([]);
  return { compilationStatus, setCompilationStatus, arduinoCliStatus, setArduinoCliStatus,
    hasCompilationErrors, setHasCompilationErrors, lastCompilationResult,
    setLastCompilationResult, cliOutput, setCliOutput, compilerErrors, setCompilerErrors };
}
