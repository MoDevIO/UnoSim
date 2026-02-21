import React from "react";

// mirror the union type used by useMobileLayout
export type MobilePanelType = "code" | "compile" | "serial" | "board" | null;

export interface MobileLayoutProps {
  isMobile: boolean;
  mobilePanel: MobilePanelType;
  setMobilePanel: React.Dispatch<React.SetStateAction<MobilePanelType>>;
  headerHeight: number;
  overlayZ: number;
  codeSlot: React.ReactNode;
  compileSlot: React.ReactNode;
  serialSlot: React.ReactNode;
  boardSlot: React.ReactNode;
}

// Simple placeholder implementation that renders only when running on
// mobile. It displays the currently selected panel slot. Real behaviour
// lives elsewhere; this stub is enough for compilation and basic layout
// tests in this refactor phase.
export const MobileLayout: React.FC<MobileLayoutProps> = ({
  isMobile,
  mobilePanel,
  codeSlot,
  compileSlot,
  serialSlot,
  boardSlot,
}) => {
  if (!isMobile) return null;

  let content: React.ReactNode = null;
  switch (mobilePanel) {
    case "code":
      content = codeSlot;
      break;
    case "compile":
      content = compileSlot;
      break;
    case "serial":
      content = serialSlot;
      break;
    case "board":
      content = boardSlot;
      break;
    default:
      content = null;
  }

  return <div className="w-full h-full">{content}</div>;
};
