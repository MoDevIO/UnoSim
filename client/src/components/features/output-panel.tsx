import React from "react";

export interface OutputPanelProps {
  compileSlot: React.ReactNode;
  serialSlot: React.ReactNode;
}

// Lightweight wrapper used in the simplified layout. In the real main branch
// this component contains the tab UI and auto-sizing behaviour; tests
// exercise that logic independently so the stub is sufficient for compile.
export const OutputPanel: React.FC<OutputPanelProps> = ({
  compileSlot,
  serialSlot,
}) => {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">{compileSlot}</div>
      <div className="flex-1 overflow-auto">{serialSlot}</div>
    </div>
  );
};
