import React from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

interface SimulatorOutputContainerProps {
  readonly serialSlot: React.ReactNode;
  readonly boardSlot: React.ReactNode;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly panelRef?: React.Ref<ImperativePanelHandle>;
  readonly defaultSize?: number;
  readonly minSize?: number;
  readonly serialPanelClassName?: string;
  readonly boardPanelClassName?: string;
}

export default function SimulatorOutputContainer({
  serialSlot,
  boardSlot,
  className,
  style,
  panelRef,
  defaultSize = 50,
  minSize = 20,
  serialPanelClassName,
  boardPanelClassName,
}: SimulatorOutputContainerProps) {
  return (
    <ResizablePanel ref={panelRef} defaultSize={defaultSize} minSize={minSize} id="output-panel" className={className} style={style}>
      <ResizablePanelGroup direction="vertical" id="output-layout" className="workspace-output-layout">
        <ResizablePanel defaultSize={50} minSize={20} id="serial-panel" className={serialPanelClassName}>
          {serialSlot}
        </ResizablePanel>

        <ResizableHandle withHandle data-testid="vertical-resizer-board" className="workspace-serial-board-handle" />

        <ResizablePanel defaultSize={50} minSize={20} id="board-panel" className={boardPanelClassName}>
          {boardSlot}
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
  );
}
