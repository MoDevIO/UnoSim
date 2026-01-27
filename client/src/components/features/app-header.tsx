import React from "react";
import { Cpu, Loader2, Play, Square, Pause } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
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
  isMobile?: boolean;
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
}) => {
  const isLoading =
    isCompiling || isStarting || isStopping || isPausing || isResuming;

  const isPauseResumeVisible =
    simulationStatus === "running" || simulationStatus === "paused";
  const pauseResumeLabel =
    simulationStatus === "paused" ? "Resume" : "Pause";
  const pauseResumeIcon = simulationStatus === "paused" ? (
    <Play className="h-4 w-4 flex-shrink-0" />
  ) : (
    <Pause className="h-4 w-4 flex-shrink-0" />
  );

  // Desktop Header
  if (!isMobile) {
    return (
      <header className="app-navbar bg-card border-b border-border px-4 h-[var(--ui-header-height)] grid grid-cols-[1fr_auto_1fr] items-center overflow-x-hidden overflow-y-hidden whitespace-nowrap w-full min-h-[var(--ui-header-height)]">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-4 min-w-0 flex-shrink-0 justify-start">
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
          <nav
            className="app-menu no-drag flex items-center gap-0 flex-shrink-0"
            role="menubar"
            aria-label="Application menu"
          >
            {/* File Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="menu-item" tabIndex={0}>
                  File
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>File</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onFileAdd()}>
                  New File
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
                <Button variant="ghost" className="menu-item" tabIndex={0}>
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
                <Button variant="ghost" className="menu-item" tabIndex={0}>
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
                <Button variant="ghost" className="menu-item" tabIndex={0}>
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
                <Button variant="ghost" className="menu-item" tabIndex={0}>
                  Help
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem
                  onSelect={() => {
                    window.open(
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
          </nav>
        </div>

        {/* Center: Simulate Button */}
        <div className="flex justify-center items-center gap-3">
          <Button
            onClick={
              simulationStatus === "running" || simulationStatus === "paused"
                ? onStop
                : onSimulate
            }
            disabled={simulateDisabled}
            className={clsx(
              "h-[var(--ui-button-height)] px-10 min-w-[16rem] max-w-[32rem] w-full flex items-center justify-center gap-2 mx-auto flex-shrink",
              "!text-white font-medium transition-colors whitespace-nowrap",
              "overflow-hidden text-ellipsis",
              {
                "!bg-orange-600 hover:!bg-orange-700":
                  (simulationStatus === "running" ||
                    simulationStatus === "paused") &&
                  !simulateDisabled,
                "!bg-green-600 hover:!bg-green-700":
                  simulationStatus === "stopped" && !simulateDisabled,
                "opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500":
                  simulateDisabled,
              },
            )}
            data-testid="button-simulate-toggle"
            aria-label={
              simulationStatus === "running" || simulationStatus === "paused"
                ? "Stop Simulation"
                : "Start Simulation"
            }
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            ) : simulationStatus === "running" ||
              simulationStatus === "paused" ? (
              <Square className="h-4 w-4 flex-shrink-0" />
            ) : (
              <Play className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="truncate block">
              {simulationStatus === "running" || simulationStatus === "paused"
                ? "Stop"
                : "Start"}
            </span>
          </Button>

          {isPauseResumeVisible && (
            <Button
              onClick={
                simulationStatus === "paused" ? onResume : onPause
              }
              disabled={simulateDisabled || isLoading}
              variant="outline"
              className={clsx(
                "h-[var(--ui-button-height)] px-4 min-w-[8rem] flex items-center gap-2",
                simulationStatus === "paused"
                  ? "bg-green-600/20 text-white"
                  : "bg-orange-600/20 text-white",
              )}
              data-testid="button-pause-resume"
              aria-label={`${pauseResumeLabel} Simulation`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              ) : (
                pauseResumeIcon
              )}
              <span className="truncate block">{pauseResumeLabel}</span>
            </Button>
          )}
        </div>

        {/* Right: Empty for symmetry */}
        <div />
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
          onClick={
            simulationStatus === "running" || simulationStatus === "paused"
              ? onStop
              : onSimulate
          }
          disabled={simulateDisabled}
          className={clsx(
            "h-[var(--ui-button-height)] px-6 flex items-center justify-center gap-2",
            "!text-white font-medium transition-colors whitespace-nowrap",
            {
              "!bg-orange-600 hover:!bg-orange-700":
                (simulationStatus === "running" ||
                  simulationStatus === "paused") &&
                !simulateDisabled,
              "!bg-green-600 hover:!bg-green-700":
                simulationStatus === "stopped" && !simulateDisabled,
              "opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500":
                simulateDisabled,
            },
          )}
          data-testid="button-simulate-toggle-mobile"
          aria-label={
            simulationStatus === "running" || simulationStatus === "paused"
              ? "Stop Simulation"
              : "Start Simulation"
          }
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          ) : simulationStatus === "running" || simulationStatus === "paused" ? (
            <Square className="h-4 w-4 flex-shrink-0" />
          ) : (
            <Play className="h-4 w-4 flex-shrink-0" />
          )}
          <span>
            {simulationStatus === "running" || simulationStatus === "paused"
              ? "Stop"
              : "Start"}
          </span>
        </Button>

        {isPauseResumeVisible && (
          <Button
            onClick={simulationStatus === "paused" ? onResume : onPause}
            disabled={simulateDisabled || isLoading}
            variant="outline"
            className={clsx(
              "h-[var(--ui-button-height)] px-4 flex items-center justify-center gap-2",
              simulationStatus === "paused"
                ? "bg-green-600/20 text-white"
                : "bg-orange-600/20 text-white",
            )}
            data-testid="button-pause-resume-mobile"
            aria-label={`${pauseResumeLabel} Simulation`}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            ) : (
              pauseResumeIcon
            )}
            <span>{pauseResumeLabel}</span>
          </Button>
        )}
      </div>
    </header>
  );
};

export default AppHeader;
