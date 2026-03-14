import React from "react";
import { AppHeader } from "@/components/features/app-header";

export interface SimulationControlsProps {
  isMobile: boolean;
  simulationStatus: "idle" | "running" | "compiling" | "stopped" | "paused";
  simulateDisabled: boolean;
  isCompiling: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isPausing: boolean;
  isResuming: boolean;
  onSimulate: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  board: string;
  baudRate: number;
  simulationTimeout: number;
  onTimeoutChange: (timeout: number) => void;
  isMac: boolean;
  onFileAdd: () => void;
  onFileRename: () => void;
  onFormatCode: () => void;
  onLoadFiles: () => void;
  onDownloadAllFiles: () => void;
  onSettings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onGoToLine: () => void;
  onFind: () => void;
  onCompile: () => void;
  onCompileAndStart: () => void;
  onOutputPanelToggle: () => void;
  showCompilationOutput: boolean;
  rightSlot?: React.ReactNode;
}

export function SimulationControls(props: SimulationControlsProps) {
  return <AppHeader {...props} />;
}
