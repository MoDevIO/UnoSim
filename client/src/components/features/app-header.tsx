import React from "react";
import { Cpu, Loader2, Play, Square, Pause } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import type { SimulationStatus, ClientState } from "@shared/types/arduino.types";
import type { CompilationStatus } from "@/types/compilation.types";
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarShortcut,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarRadioGroup,
  MenubarRadioItem,
} from "@/components/ui/menubar";

interface AppHeaderProps {
  readonly isMobile?: boolean;
  readonly simulationStatus: SimulationStatus;
  readonly compilationStatus: CompilationStatus;
  readonly dockerGccPhase: "idle" | "queued" | "active";
  readonly pendingExternalStart?: boolean;
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

// ─── Module-level helpers (keep AppHeader CC below 15) ───────────────────────

function _computeHeaderCenter(
  headerEl: HTMLElement,
  leftEl: HTMLElement,
  centerEl: HTMLElement,
): number {
  const headerRect = headerEl.getBoundingClientRect();
  const leftRect = leftEl.getBoundingClientRect();
  const centerRect = centerEl.getBoundingClientRect();
  const gap = 12;
  const leftEdge = leftRect.left - headerRect.left;
  const minCenter = leftEdge + leftRect.width + gap + centerRect.width / 2;
  return Math.max(headerRect.width / 2, minCenter);
}

function _getSimulateAction(
  status: SimulationStatus,
  onStop: () => void,
  onResume: () => void,
  onSimulate: () => void,
): () => void {
  if (status === "running") return onStop;
  if (status === "paused") return onResume;
  return onSimulate;
}

function _getSimulateAriaLabel(clientState: ClientState): string {
  if (clientState === "RUNNING") return "Stop Simulation";
  if (clientState === "PAUSED") return "Resume Simulation";
  if (clientState === "QUEUED_FOR_COMPILING") return "Waiting for compile slot";
  if (clientState === "COMPILING") return "Compiling code";
  if (clientState === "QUEUED_FOR_SIMULATION") return "Waiting for simulation slot";
  return "Start Simulation";
}

function _getSimulateText(clientState: ClientState): string {
  if (clientState === "PAUSED") return "Resume";
  if (clientState === "IDLE" || clientState === "ERROR") return "Start";
  return "Stop";
}

function _getDesktopSimulateButtonClass(
  clientState: ClientState,
  disabled: boolean,
): string {
  return clsx(
    "h-[var(--ui-button-height)] px-4 pr-12 min-w-[10rem] flex items-center justify-center gap-2 relative",
    "text-white font-medium transition-colors",
    {
      "bg-orange-500 hover:bg-orange-600": clientState === "RUNNING" && !disabled,
      "bg-green-600 hover:bg-green-700":
        (clientState === "IDLE" || clientState === "PAUSED" || clientState === "ERROR") && !disabled,
      "bg-blue-600 hover:bg-blue-700": (clientState === "QUEUED_FOR_COMPILING" || clientState === "COMPILING") && !disabled,
      "bg-violet-600 hover:bg-violet-700": clientState === "QUEUED_FOR_SIMULATION" && !disabled,
      "opacity-50 cursor-not-allowed bg-gray-500 hover:bg-gray-500": disabled,
    },
  );
}

function getMobileSimulateIcon(isLoading: boolean, isRunning: boolean): JSX.Element {
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />;
  if (isRunning) return <Square className="h-4 w-4 flex-shrink-0" />;
  return <Play className="h-4 w-4 flex-shrink-0" />;
}

function _getMobileSimulateButtonClass(
  clientState: ClientState,
  disabled: boolean,
): string {
  return clsx(
    "h-[var(--ui-button-height)] px-6 pr-12 flex items-center justify-center gap-2 relative",
    "!text-white font-medium transition-colors whitespace-nowrap",
    {
      "!bg-orange-600 hover:!bg-orange-700": clientState === "RUNNING" && !disabled,
      "!bg-green-600 hover:!bg-green-700":
        (clientState === "IDLE" || clientState === "PAUSED" || clientState === "ERROR") && !disabled,
      "!bg-blue-600 hover:!bg-blue-700": (clientState === "QUEUED_FOR_COMPILING" || clientState === "COMPILING") && !disabled,
      "!bg-violet-600 hover:!bg-violet-700": clientState === "QUEUED_FOR_SIMULATION" && !disabled,
      "opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500": disabled,
    },
  );
}

// ─── ClientState derivation for button ───────────────────────────────────────

function _deriveClientStateForButton(
  simulationStatus: SimulationStatus,
  compilationStatus: CompilationStatus,
  dockerGccPhase: "idle" | "queued" | "active",
  pendingExternalStart: boolean,
): ClientState {
  if (pendingExternalStart) return "QUEUED_FOR_COMPILING";
  if (compilationStatus === "compiling") return "COMPILING";
  // simulationStatus takes priority over dockerGccPhase: once a runner is
  // acquired the server sends simulation_status:running then immediately
  // compilation_status:compiling (Docker g++ starting inside the runner).
  // If both arrive in the same React batch the button must still show RUNNING
  // so the E2E locator /stop simulation/i matches immediately.
  if (simulationStatus === "running") return "RUNNING";
  if (simulationStatus === "paused") return "PAUSED";
  if (dockerGccPhase === "queued") return "QUEUED_FOR_COMPILING";
  if (dockerGccPhase === "active") return "COMPILING";
  if (simulationStatus === "queued") return "QUEUED_FOR_SIMULATION";
  if (compilationStatus === "error") return "ERROR";
  return "IDLE";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PauseButtonProps {
  readonly isPausing: boolean;
  readonly simulateDisabled: boolean;
  readonly isLoading: boolean;
  readonly onPause: () => void;
}

function PauseButton({ isPausing, simulateDisabled, isLoading, onPause }: PauseButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!simulateDisabled && !isLoading) onPause();
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (!simulateDisabled && !isLoading) onPause();
    }
  };
  return (
    <button
      type="button"
      className="absolute right-0 top-0 bottom-0 pl-2 border-l border-orange-500/50 flex items-center bg-yellow-400/90 hover:bg-yellow-400 pr-2 rounded-r z-10 cursor-pointer"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      aria-label="Pause Simulation"
      title="Pause"
    >
      {isPausing ? (
        <Loader2 className="h-3 w-3 animate-spin text-orange-900" />
      ) : (
        <Pause className="h-3 w-3 text-orange-900" />
      )}
    </button>
  );
}

interface DesktopSimulateIconProps {
  readonly isLoading: boolean;
  readonly isRunning: boolean;
}

function DesktopSimulateIcon({ isLoading, isRunning }: DesktopSimulateIconProps) {
  return (
    <div className="relative w-4 h-4">
      <Play
        className={clsx("absolute inset-0 m-auto h-4 w-4 transition-all duration-200", {
          "opacity-100 scale-100": !isLoading && !isRunning,
          "opacity-0 scale-75": isLoading || isRunning,
        })}
      />
      <Square
        className={clsx("absolute inset-0 m-auto h-4 w-4 transition-all duration-200", {
          "opacity-100 scale-100": !isLoading && isRunning,
          "opacity-0 scale-75": isLoading || !isRunning,
        })}
      />
      <Loader2
        className={clsx("absolute inset-0 m-auto h-4 w-4 animate-spin transition-opacity duration-150", {
          "opacity-100": isLoading,
          "opacity-0": !isLoading,
        })}
      />
    </div>
  );
}

interface MobileSimulateContentProps {
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly text: string;
}

function MobileSimulateContent({ isLoading, isRunning, text }: MobileSimulateContentProps) {
  const icon = getMobileSimulateIcon(isLoading, isRunning);
  return (
    <div
      className={clsx("flex items-center gap-2", {
        "absolute left-1/2 -translate-x-1/2": !isRunning,
      })}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}

interface DesktopMenuBarProps {
  readonly isMac: boolean;
  readonly board: string;
  readonly baudRate: number;
  readonly simulationTimeout: number;
  readonly showCompilationOutput: boolean;
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
  readonly onTimeoutChange: (timeout: number) => void;
}

function DesktopMenuBar({
  isMac,
  board,
  baudRate,
  simulationTimeout,
  showCompilationOutput,
  onFileAdd,
  onFileRename,
  onFormatCode,
  onLoadFiles,
  onDownloadAllFiles,
  onSettings,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onGoToLine,
  onFind,
  onCompile,
  onCompileAndStart,
  onOutputPanelToggle,
  onTimeoutChange,
}: DesktopMenuBarProps) {
  return (
    <Menubar className="app-menu no-drag border-0 bg-transparent p-0 h-auto flex-shrink-0">
      {/* File Menu */}
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarLabel>File</MenubarLabel>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onFileAdd()}>
            New File
            <MenubarShortcut>
              {isMac ? "⇧⌥⌘N" : "Ctrl+Alt+Shift+N"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onFileRename()}>
            Rename
          </MenubarItem>
          <MenubarItem onSelect={() => onFormatCode()}>
            Format Code
            <MenubarShortcut>
              {isMac ? "⇧⌘F" : "Ctrl+Shift+F"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onLoadFiles()}>
            Load Files
          </MenubarItem>
          <MenubarItem onSelect={() => onDownloadAllFiles()}>
            Download All Files
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onSettings()}>
            Settings
            <MenubarShortcut>
              {isMac ? "⌘," : "Ctrl+,"}
            </MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Edit Menu */}
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarLabel>Edit</MenubarLabel>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onUndo()}>
            Undo
            <MenubarShortcut>
              {isMac ? "⌘Z" : "Ctrl+Z"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onRedo()}>
            Redo
            <MenubarShortcut>
              {isMac ? "⇧⌘Z" : "Ctrl+Y"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onCut()}>
            Cut
            <MenubarShortcut>
              {isMac ? "⌘X" : "Ctrl+X"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onCopy()}>
            Copy
            <MenubarShortcut>
              {isMac ? "⌘C" : "Ctrl+C"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onPaste()}>
            Paste
            <MenubarShortcut>
              {isMac ? "⌘V" : "Ctrl+V"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onSelectAll()}>
            Select All
            <MenubarShortcut>
              {isMac ? "⌘A" : "Ctrl+A"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onGoToLine()}>
            Go to Line…
            <MenubarShortcut>
              {isMac ? "⌘G" : "Ctrl+G"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => onFind()}>
            Find
            <MenubarShortcut>
              {isMac ? "⌘F" : "Ctrl+F"}
            </MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Sketch Menu */}
      <MenubarMenu>
        <MenubarTrigger>Sketch</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => onCompile()}>
            Compile
            <MenubarShortcut>F5</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onCompileAndStart()}>
            Compile/Upload
            <MenubarShortcut>
              {isMac ? "⌘U" : "Ctrl+U"}
            </MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => onOutputPanelToggle()}>
            <div className="flex items-center justify-between w-full">
              <span>Output Panel</span>
              {showCompilationOutput && (
                <span className="text-ui-xs">✓</span>
              )}
            </div>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Tools Menu */}
      <MenubarMenu>
        <MenubarTrigger>Tools</MenubarTrigger>
        <MenubarContent>
          <MenubarLabel>Tools</MenubarLabel>
          <MenubarSeparator />
          <MenubarItem
            className="cursor-default"
            onSelect={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between w-full">
              <span>Board:</span>
              <span className="text-ui-xs text-muted-foreground">
                {board}
              </span>
            </div>
          </MenubarItem>
          <MenubarItem
            className="cursor-default"
            onSelect={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between w-full">
              <span>Baud Rate:</span>
              <span className="text-ui-xs text-muted-foreground">
                {baudRate}
              </span>
            </div>
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger className="w-full text-left">
              Timeout
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup
                value={String(simulationTimeout)}
                onValueChange={(v) => onTimeoutChange(Number(v))}
              >
                <MenubarRadioItem value="5">5s</MenubarRadioItem>
                <MenubarRadioItem value="10">10s</MenubarRadioItem>
                <MenubarRadioItem value="30">30s</MenubarRadioItem>
                <MenubarRadioItem value="60">60s</MenubarRadioItem>
                <MenubarRadioItem value="120">2min</MenubarRadioItem>
                <MenubarRadioItem value="300">5min</MenubarRadioItem>
                <MenubarRadioItem value="600">10min</MenubarRadioItem>
                <MenubarRadioItem value="0">∞</MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      {/* Help Menu */}
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem
            onSelect={() => {
              globalThis.open(
                "https://github.com/MoDevIO/UnoSim",
                "_blank",
                "noopener",
              );
            }}
          >
            Github
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

/**
 * Unified App Header Component
 * 
 * Provides consistent layout for:
 * - Desktop navbar with menu buttons and centered simulate button
 * - Mobile header with centered simulate button
 * 
 * Features:
 * - Consistent button sizing via --ui-button-height
 * - Proper spacing and overflow handling
 * - Responsive design
 * - Accessibility support
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  isMobile = false,
  simulationStatus,
  compilationStatus,
  dockerGccPhase,
  pendingExternalStart,
  simulateDisabled,
  isCompiling,
  isStarting,
  isStopping,
  isPausing,
  isResuming,
  onSimulate,
  onStop,
  onPause,
  onResume,
  board,
  baudRate,
  simulationTimeout,
  onTimeoutChange,
  isMac,
  onFileAdd,
  onFileRename,
  onFormatCode,
  onLoadFiles,
  onDownloadAllFiles,
  onSettings,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onGoToLine,
  onFind,
  onCompile,
  onCompileAndStart,
  onOutputPanelToggle,
  showCompilationOutput,
  rightSlot,
}) => {
  const isLoading =
    isCompiling || isStarting || isStopping || isPausing || isResuming;

  const headerRef = React.useRef<HTMLElement | null>(null);
  const leftGroupRef = React.useRef<HTMLDivElement | null>(null);
  const centerGroupRef = React.useRef<HTMLDivElement | null>(null);
  const [centerLeft, setCenterLeft] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (isMobile) return;
    const headerEl = headerRef.current;
    const leftEl = leftGroupRef.current;
    const centerEl = centerGroupRef.current;
    if (!headerEl || !leftEl || !centerEl) return;

    const computeCenter = () => {
      setCenterLeft(_computeHeaderCenter(headerEl, leftEl, centerEl));
    };

    computeCenter();
    const observer = new ResizeObserver(computeCenter);
    observer.observe(headerEl);
    observer.observe(leftEl);
    observer.observe(centerEl);
    return () => observer.disconnect();
  }, [isMobile]);

  const simulateAction = _getSimulateAction(simulationStatus, onStop, onResume, onSimulate);
  const clientState = _deriveClientStateForButton(
    simulationStatus,
    compilationStatus,
    dockerGccPhase,
    pendingExternalStart ?? false,
  );
  const simulateLabel = _getSimulateAriaLabel(clientState);
  const simulateText = _getSimulateText(clientState);
  const isRunning = simulationStatus === "running";
  const isLoadingFull =
    isLoading ||
    clientState === "QUEUED_FOR_COMPILING" || clientState === "COMPILING" ||
    clientState === "QUEUED_FOR_SIMULATION";
  const pauseProps = { isPausing, simulateDisabled, isLoading: isLoadingFull, onPause };

  // Desktop Header
  if (!isMobile) {
    return (
      <header
        ref={headerRef}
        className="app-navbar app-region-drag backdrop-blur shadow-lg bg-card border-b border-border px-[var(--header-padding-x)] py-[var(--header-padding-y)] relative flex items-center overflow-x-hidden overflow-y-hidden whitespace-nowrap w-full h-[var(--ui-header-height)]"
      >
        {/* Left: Logo + Title */}
        <div
          ref={leftGroupRef}
          className="flex items-center gap-4 min-w-0 flex-shrink-0 justify-start"
        >
          <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <Cpu
              className="text-white opacity-95 h-5 w-5 flex-shrink-0"
              strokeWidth={1.67}
            />
            <h1 className="text-ui-sm font-semibold truncate select-none">
              Arduino UNO Simulator
            </h1>
          </div>

          {/* Menu Bar */}
          <DesktopMenuBar
            isMac={isMac}
            board={board}
            baudRate={baudRate}
            simulationTimeout={simulationTimeout}
            showCompilationOutput={showCompilationOutput}
            onFileAdd={onFileAdd}
            onFileRename={onFileRename}
            onFormatCode={onFormatCode}
            onLoadFiles={onLoadFiles}
            onDownloadAllFiles={onDownloadAllFiles}
            onSettings={onSettings}
            onUndo={onUndo}
            onRedo={onRedo}
            onCut={onCut}
            onCopy={onCopy}
            onPaste={onPaste}
            onSelectAll={onSelectAll}
            onGoToLine={onGoToLine}
            onFind={onFind}
            onCompile={onCompile}
            onCompileAndStart={onCompileAndStart}
            onOutputPanelToggle={onOutputPanelToggle}
            onTimeoutChange={onTimeoutChange}
          />
        </div>

        <div className="flex-1" />

        {/* Center: Simulate Button */}
        <div
          ref={centerGroupRef}
          className="absolute top-1/2"
          style={{
            left: centerLeft ? `${centerLeft}px` : "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="relative flex items-stretch h-fit">
            <Button
              onClick={simulateAction}
              disabled={simulateDisabled}
              variant="ghost"
              className={_getDesktopSimulateButtonClass(clientState, simulateDisabled)}
              data-testid="button-simulate-toggle"
              aria-label={simulateLabel}
            >
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                <DesktopSimulateIcon isLoading={isLoadingFull} isRunning={isRunning} />
                <span className="font-semibold leading-none">{simulateText}</span>
              </div>
            </Button>
            {isRunning && <PauseButton {...pauseProps} />}
          </div>
        </div>

        {/* Right: Optional telemetry/extra controls */}
        <div className="flex-1 flex items-center justify-end min-w-0">
          {rightSlot}
        </div>
      </header>
    );
  }

  // Mobile Header (simplified)
  return (
    <header
      data-mobile-header
      className="bg-card border-b border-border px-4 h-[var(--ui-header-height)] flex items-center justify-center flex-nowrap overflow-hidden w-full"
    >
      <div className="flex items-center gap-2 relative h-full">
        <Button
          onClick={simulateAction}
          disabled={simulateDisabled}
          variant="ghost"
          className={_getMobileSimulateButtonClass(clientState, simulateDisabled)}
          data-testid="button-simulate-toggle-mobile"
          aria-label={simulateLabel}
        >
          <MobileSimulateContent isLoading={isLoadingFull} isRunning={isRunning} text={simulateText} />
        </Button>
        {isRunning && <PauseButton {...pauseProps} />}
      </div>
    </header>
  );
};

// default export removed; use named export AppHeader only

