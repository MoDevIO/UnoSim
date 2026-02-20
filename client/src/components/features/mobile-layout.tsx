import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@/components/ui/button";
import { Cpu, Wrench, Terminal, Monitor } from "lucide-react";
import clsx from "clsx";

export type MobilePanel = "code" | "compile" | "serial" | "board" | null;

export interface MobileLayoutProps {
  isMobile: boolean;
  mobilePanel: MobilePanel;
  setMobilePanel: React.Dispatch<React.SetStateAction<MobilePanel>>;
  headerHeight: number;
  overlayZ: number;

  // slots
  codeSlot?: React.ReactNode;
  compileSlot?: React.ReactNode;
  serialSlot?: React.ReactNode;
  boardSlot?: React.ReactNode;

  portalContainer?: HTMLElement | null;
  className?: string;
  testId?: string;
  onOpenPanel?: (panel: MobilePanel) => void;
  onClosePanel?: () => void;
}

export const MobileLayout = React.memo(function MobileLayout({
  isMobile,
  mobilePanel,
  setMobilePanel,
  headerHeight,
  overlayZ,
  codeSlot,
  compileSlot,
  serialSlot,
  boardSlot,
  portalContainer = typeof document !== "undefined" ? document.body : null,
  className,
  testId = "mobile-layout",
  onOpenPanel,
  onClosePanel,
}: MobileLayoutProps) {
  // helpers
  const handleToggle = React.useCallback(
    (panel: MobilePanel) => {
      setMobilePanel((prev: MobilePanel) => (prev === panel ? null : panel));
      if (panel === mobilePanel) {
        onClosePanel?.();
      } else {
        onOpenPanel?.(panel);
      }
    },
    [mobilePanel, setMobilePanel, onOpenPanel, onClosePanel],
  );

  // render fab bar via portal
  const fabBar = (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: overlayZ }}
      data-testid="mobile-fab-container"
    >
      <div
        className="absolute inset-0 flex items-end justify-end p-8"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 32px)",
          paddingRight: "env(safe-area-inset-right, 32px)",
        }}
      >
        <div className="pointer-events-auto sticky mr-4 mb-4" style={{ alignSelf: "flex-end" }}>
          <div className="bg-black/95 rounded-full shadow-lg p-1 flex flex-col items-center space-y-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Code Editor"
              onClick={() => handleToggle("code")}
              className={clsx(
                "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                mobilePanel === "code"
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-transparent text-muted-foreground",
              )}
            >
              <Cpu className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Compilation Output"
              onClick={() => handleToggle("compile")}
              className={clsx(
                "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                mobilePanel === "compile"
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-transparent text-muted-foreground",
              )}
            >
              <Wrench className="w-5 h-5 opacity-80" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Serial Output"
              onClick={() => handleToggle("serial")}
              className={clsx(
                "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                mobilePanel === "serial"
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-transparent text-muted-foreground",
              )}
            >
              <Terminal className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Arduino Board"
              onClick={() => handleToggle("board")}
              className={clsx(
                "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                mobilePanel === "board"
                  ? "bg-sky-600 text-white hover:bg-sky-700"
                  : "bg-transparent text-muted-foreground",
              )}
            >
              <Monitor className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isMobile && portalContainer && ReactDOM.createPortal(fabBar, portalContainer)}
      {mobilePanel && (
        <div
          className={clsx("fixed left-0 right-0 bottom-0 bg-card p-0 flex flex-col w-screen", className)}
          style={{
            top: `${headerHeight}px`,
            height: `calc(100vh - ${headerHeight}px)`,
            zIndex: overlayZ,
          }}
          data-testid={testId}
        >
          <div className="flex-1 overflow-auto w-screen h-full">
            {mobilePanel === "code" && codeSlot}
            {mobilePanel === "compile" && compileSlot}
            {mobilePanel === "serial" && serialSlot}
            {mobilePanel === "board" && boardSlot}
          </div>
        </div>
      )}
    </>
  );
});

MobileLayout.displayName = "MobileLayout";
