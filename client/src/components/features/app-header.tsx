import React from "react";
import { Cpu, Loader2, Play, Square, Pause } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import type { SimulationStatus } from "@shared/types/arduino.types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

interface AppHeaderProps {
  readonly isMobile?: boolean;
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

function _getSimulateAriaLabel(status: SimulationStatus): string {
  if (status === "running") return "Stop Simulation";
  if (status === "paused") return "Resume Simulation";
  return "Start Simulation";
}

function _getSimulateText(status: SimulationStatus): string {
  if (status === "running") return "Stop";
  if (status === "paused") return "Resume";
  return "Start";
}

function _getDesktopSimulateButtonClass(
  status: SimulationStatus,
  disabled: boolean,
): string {
  return clsx(
    "h-[var(--ui-button-height)] px-4 pr-12 min-w-[10rem] flex items-center justify-center gap-2 relative",
    "!text-white font-medium transition-colors",
    {
      "!bg-status-warning hover:!bg-accent-amber": status === "running" && !disabled,
      "!bg-status-success hover:!bg-status-success-dark":
        (status === "stopped" || status === "paused") && !disabled,
      "opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500": disabled,
    },
  );
}

function getMobileSimulateIcon(isLoading: boolean, isRunning: boolean): JSX.Element {
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />;
  if (isRunning) return <Square className="h-4 w-4 flex-shrink-0" />;
  return <Play className="h-4 w-4 flex-shrink-0" />;
}

function _getMobileSimulateButtonClass(
  status: SimulationStatus,
  disabled: boolean,
): string {
  return clsx(
    "h-[var(--ui-button-height)] px-6 pr-12 flex items-center justify-center gap-2 relative",
    "!text-white font-medium transition-colors whitespace-nowrap",
    {
      "!bg-orange-600 hover:!bg-orange-700": status === "running" && !disabled,
      "!bg-green-600 hover:!bg-green-700":
        (status === "stopped" || status === "paused") && !disabled,
      "opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500": disabled,
    },
  );
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
        className={clsx("absolute inset-0 m-auto h-4 w-4 transition-opacity duration-150", {
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
    <div
      role="menubar"
      className="app-menu no-drag flex items-center gap-0 flex-shrink-0"
      aria-label="Application menu"
    >
      {/* File Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="inline-flex items-center justify-center px-2 py-1" tabIndex={0}>
            File
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>File</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onFileAdd()}>
            New File
            <DropdownMenuShortcut>
              {isMac ? "⇧⌥⌘N" : "Ctrl+Alt+Shift+N"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onFileRename()}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onFormatCode()}>
            Format Code
            <DropdownMenuShortcut>
              {isMac ? "⇧⌘F" : "Ctrl+Shift+F"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onLoadFiles()}>
            Load Files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDownloadAllFiles()}>
            Download All Files
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSettings()}>
            Settings
            <DropdownMenuShortcut>
              {isMac ? "⌘," : "Ctrl+,"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="inline-flex items-center justify-center px-2 py-1" tabIndex={0}>
            Edit
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Edit</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onUndo()}>
            Undo
            <DropdownMenuShortcut>
              {isMac ? "⌘Z" : "Ctrl+Z"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRedo()}>
            Redo
            <DropdownMenuShortcut>
              {isMac ? "⇧⌘Z" : "Ctrl+Y"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onCut()}>
            Cut
            <DropdownMenuShortcut>
              {isMac ? "⌘X" : "Ctrl+X"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCopy()}>
            Copy
            <DropdownMenuShortcut>
              {isMac ? "⌘C" : "Ctrl+C"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onPaste()}>
            Paste
            <DropdownMenuShortcut>
              {isMac ? "⌘V" : "Ctrl+V"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectAll()}>
            Select All
            <DropdownMenuShortcut>
              {isMac ? "⌘A" : "Ctrl+A"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onGoToLine()}>
            Go to Line…
            <DropdownMenuShortcut>
              {isMac ? "⌘G" : "Ctrl+G"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onFind()}>
            Find
            <DropdownMenuShortcut>
              {isMac ? "⌘F" : "Ctrl+F"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sketch Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="inline-flex items-center justify-center px-2 py-1" tabIndex={0}>
            Sketch
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem onSelect={() => onCompile()}>
            Compile
            <DropdownMenuShortcut>F5</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onCompileAndStart()}>
            Compile/Upload
            <DropdownMenuShortcut>
              {isMac ? "⌘U" : "Ctrl+U"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onOutputPanelToggle()}>
            <div className="flex items-center justify-between w-full">
              <span>Output Panel</span>
              {showCompilationOutput && (
                <span className="text-ui-xs">✓</span>
              )}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tools Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="inline-flex items-center justify-center px-2 py-1" tabIndex={0}>
            Tools
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Tools</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-default"
            onSelect={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between w-full">
              <span>Board:</span>
              <span className="text-ui-xs text-muted-foreground">
                {board}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-default"
            onSelect={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between w-full">
              <span>Baud Rate:</span>
              <span className="text-ui-xs text-muted-foreground">
                {baudRate}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="w-full text-left">
              Timeout
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={String(simulationTimeout)}
                onValueChange={(v) => onTimeoutChange(Number(v))}
              >
                <DropdownMenuRadioItem value="5">5s</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="10">10s</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="30">30s</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="60">60s</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="120">2min</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="300">5min</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="600">10min</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="0">∞</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Help Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="inline-flex items-center justify-center px-2 py-1" tabIndex={0}>
            Help
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem
            onSelect={() => {
              globalThis.open(
                "https://github.com/MoDevIO/UnoSim",
                "_blank",
                "noopener",
              );
            }}
          >
            Github
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  const simulateLabel = _getSimulateAriaLabel(simulationStatus);
  const simulateText = _getSimulateText(simulationStatus);
  const isRunning = simulationStatus === "running";
  const pauseProps = { isPausing, simulateDisabled, isLoading, onPause };

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
          <Button
            onClick={simulateAction}
            disabled={simulateDisabled}
            className={_getDesktopSimulateButtonClass(simulationStatus, simulateDisabled)}
            data-testid="button-simulate-toggle"
            aria-label={simulateLabel}
          >
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
              <DesktopSimulateIcon isLoading={isLoading} isRunning={isRunning} />
              <span className="font-semibold leading-none">{simulateText}</span>
            </div>
            {isRunning && <PauseButton {...pauseProps} />}
          </Button>
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
      <div className="flex items-center gap-2">
        <Button
          onClick={simulateAction}
          disabled={simulateDisabled}
          className={_getMobileSimulateButtonClass(simulationStatus, simulateDisabled)}
          data-testid="button-simulate-toggle-mobile"
          aria-label={simulateLabel}
        >
          <MobileSimulateContent isLoading={isLoading} isRunning={isRunning} text={simulateText} />
          {isRunning && <PauseButton {...pauseProps} />}
        </Button>
      </div>
    </header>
  );
};

// default export removed; use named export AppHeader only

