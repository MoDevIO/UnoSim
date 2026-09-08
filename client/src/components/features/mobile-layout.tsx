import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@/components/ui/button";
import { Cpu, Wrench, Terminal, Monitor } from "lucide-react";
import clsx from "clsx";

export type MobilePanel = "code" | "compile" | "serial" | "board";

interface MobileLayoutProps {
  readonly isMobile: boolean;
  readonly mobilePanel: MobilePanel;
  readonly setMobilePanel: React.Dispatch<React.SetStateAction<MobilePanel>>;
  readonly overlayZ: number;

  readonly portalContainer?: HTMLElement | null;
  readonly className?: string;
  readonly testId?: string;
  readonly onOpenPanel?: (panel: MobilePanel) => void;
}

export const MobileLayout = React.memo(function MobileLayout({
  isMobile,
  mobilePanel,
  setMobilePanel,
  overlayZ,
  portalContainer = typeof document === "undefined" ? null : document.body,
  className,
  testId = "mobile-layout",
  onOpenPanel,
}: MobileLayoutProps) {
  // The panel surfaces themselves stay mounted in the responsive workspace.
  // This component owns navigation only, so selecting a surface never moves
  // or unmounts the Monaco editor.
  const handleToggle = React.useCallback(
    (panel: MobilePanel) => {
      setMobilePanel(panel);
      if (panel !== mobilePanel) onOpenPanel?.(panel);
    },
    [mobilePanel, setMobilePanel, onOpenPanel],
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
          paddingBottom: "env(safe-area-inset-bottom, var(--ui-safe-area-bottom))",
          paddingRight: "env(safe-area-inset-right, var(--ui-safe-area-right))",
        }}
      >
        <div className="pointer-events-auto sticky mr-4 mb-4" style={{ alignSelf: "flex-end" }}>
          <div
            className="bg-black/95 rounded-full shadow-lg p-2 flex flex-col items-center space-y-3"
            data-mobile-fab-toolbar
          >
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
              data-mobile-fab-button
            >
              <Cpu className="!w-10 !h-10" />
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
              data-mobile-fab-button
            >
              <Wrench className="!w-10 !h-10 opacity-80" />
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
              data-mobile-fab-button
            >
              <Terminal className="!w-10 !h-10" />
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
              data-mobile-fab-button
            >
              <Monitor className="!w-10 !h-10" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isMobile && portalContainer && ReactDOM.createPortal(fabBar, portalContainer)}
      {isMobile && (
        <div
          className={clsx("sr-only", className)}
          style={{ zIndex: overlayZ }}
          data-testid={testId}
          aria-live="polite"
        >
          Active mobile panel: {mobilePanel}
        </div>
      )}
    </>
  );
});

MobileLayout.displayName = "MobileLayout";
