import React from "react";
import { AppHeader } from "@/components/features/app-header";
import type { SimulationStatus } from "@shared/types/arduino.types";

interface SimulationControlsProps {
  readonly isMobile: boolean;
  readonly simulationStatus: SimulationStatus;
  readonly simulateDisabled: boolean;
  readonly isCompiling: boolean;
  readonly isStarting: boolean;
  readonly isStopping: boolean;
  readonly isPausing: boolean;
  readonly isResuming: boolean;
  readonly onSimulate: () => void;
  readonly onStop: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly board: string;
  readonly baudRate: number;
  readonly simulationTimeout: number;
  readonly onTimeoutChange: (timeout: number) => void;
  readonly isMac: boolean;
  readonly onFileAdd: () => void;
  readonly onFileRename: () => void;
  readonly onFormatCode: () => void;
  readonly onLoadFiles: () => void;
  readonly onDownloadAllFiles: () => void;
  readonly onSettings: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCut: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onSelectAll: () => void;
  readonly onGoToLine: () => void;
  readonly onFind: () => void;
  readonly onCompile: () => void;
  readonly onCompileAndStart: () => void;
  readonly onOutputPanelToggle: () => void;
  readonly showCompilationOutput: boolean;
  readonly rightSlot?: React.ReactNode;
}

export function SimulationControls(props: SimulationControlsProps) {
  return <AppHeader {...props} />;
}
