import React, { useEffect, useMemo, useRef } from "react";
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  getWorkspaceDefaultSizes,
  getWorkspaceResizePairs,
  type WorkspaceColumn,
  type WorkspaceColumnSizes,
  type WorkspaceColumnVisibility,
} from "@/lib/experimental-workspace-layout";

interface WorkspaceCodeColumnProps {
  readonly codeSlot: React.ReactNode;
  readonly compileSlot: React.ReactNode;
  readonly outputPanelRef: React.Ref<ImperativePanelHandle>;
  readonly compilationPanelSize: number;
  readonly outputPanelMinPercent: number;
  readonly outputPanelManuallyResizedRef: React.MutableRefObject<boolean>;
  readonly compilePanelClassName?: string;
  readonly compilePanelStyle?: React.CSSProperties;
  readonly groupId: string;
  readonly editorPanelId: string;
  readonly outputPanelId: string;
  readonly outputResizerTestId: string;
}

export function WorkspaceCodeColumn({
  codeSlot,
  compileSlot,
  outputPanelRef,
  compilationPanelSize,
  outputPanelMinPercent,
  outputPanelManuallyResizedRef,
  compilePanelClassName,
  compilePanelStyle,
  groupId,
  editorPanelId,
  outputPanelId,
  outputResizerTestId,
}: WorkspaceCodeColumnProps) {
  return (
    <ResizablePanelGroup
      direction="vertical"
      className="h-full workspace-code-layout"
      id={groupId}
    >
      <ResizablePanel
        defaultSize={97}
        minSize={30}
        id={editorPanelId}
        className="workspace-editor-panel"
      >
        <div className="h-full flex flex-col">{codeSlot}</div>
      </ResizablePanel>
      <ResizableHandle
        withHandle
        data-testid={outputResizerTestId}
        className="workspace-editor-output-handle"
        onDragging={(isDragging) => {
          if (isDragging) outputPanelManuallyResizedRef.current = true;
        }}
      />
      <ResizablePanel
        ref={outputPanelRef}
        defaultSize={Math.max(compilationPanelSize, outputPanelMinPercent)}
        minSize={outputPanelMinPercent}
        id={outputPanelId}
        className={compilePanelClassName}
        style={compilePanelStyle}
      >
        {compileSlot}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface WorkspaceVisibilityControlsProps {
  readonly visibility: WorkspaceColumnVisibility;
  readonly onColumnToggle: (column: WorkspaceColumn) => void;
  readonly onRestoreDefault: () => void;
}

function getWorkspaceColumnLabel(column: WorkspaceColumn) {
  switch (column) {
    case "code":
      return "Code";
    case "simulation":
      return "Simulation";
    case "tutor":
      return "Tutor";
  }
}

function getWorkspaceEmptyStateLabel(column: WorkspaceColumn) {
  switch (column) {
    case "code":
      return "Code anzeigen";
    case "simulation":
      return "Simulation anzeigen";
    case "tutor":
      return "Tutor anzeigen";
  }
}

export function WorkspaceVisibilityControls({
  visibility,
  onColumnToggle,
  onRestoreDefault,
}: WorkspaceVisibilityControlsProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2"
      data-testid="experimental-workspace-controls"
    >
      <span className="mr-2 text-ui-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Workspace
      </span>
      {(["code", "simulation", "tutor"] as WorkspaceColumn[]).map((column) => {
        const label = getWorkspaceColumnLabel(column);
        return (
          <Button
            key={column}
            type="button"
            size="sm"
            variant={visibility[column] ? "default" : "outline"}
            aria-pressed={visibility[column]}
            aria-label={`${label}-Spalte ${visibility[column] ? "ausblenden" : "einblenden"}`}
            onClick={() => onColumnToggle(column)}
            data-testid={`workspace-toggle-${column}`}
          >
            {label}
          </Button>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRestoreDefault}
        data-testid="workspace-restore-default"
      >
        Standardlayout wiederherstellen
      </Button>
    </div>
  );
}

function TutorPlaceholder({
  className,
  style,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
}) {
  return (
    <section
      className={`h-full w-full overflow-auto bg-background ${className ?? ""}`}
      style={style}
      aria-label="Tutor"
      data-testid="tutor-panel"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-[var(--ui-header-height)] shrink-0 items-center border-b border-border bg-muted px-3">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground" style={{ fontSize: "var(--fs-body-xs)" }}>
            Tutor
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Lernfragen-Panel</p>
            <p className="mt-2 text-ui-sm">Platzhalter für die spätere Tutor-Integration.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TutorWorkspacePlaceholder({
  className,
  style,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
}) {
  return <TutorPlaceholder className={className} style={style} />;
}

interface ExperimentalWorkspaceProps {
  readonly visibility: WorkspaceColumnVisibility;
  readonly visibleColumns: WorkspaceColumn[];
  readonly sizes: WorkspaceColumnSizes;
  readonly setColumnVisible: (column: WorkspaceColumn, value: boolean) => void;
  readonly restoreDefaultLayout: () => void;
  readonly setSizes: React.Dispatch<React.SetStateAction<WorkspaceColumnSizes>>;
  readonly codeColumn: React.ReactNode;
  readonly simulationColumn: React.ReactNode;
}

export function ExperimentalWorkspace({
  visibility,
  visibleColumns,
  sizes,
  setColumnVisible,
  restoreDefaultLayout,
  setSizes,
  codeColumn,
  simulationColumn,
}: ExperimentalWorkspaceProps) {
  const groupRef = useRef<ImperativePanelGroupHandle | null>(null);
  const visibleKey = useMemo(() => visibleColumns.join(","), [visibleColumns]);
  const resizePairs = useMemo(() => getWorkspaceResizePairs(visibleColumns), [visibleColumns]);

  useEffect(() => {
    if (visibleColumns.length === 0) return;
    const timer = globalThis.setTimeout(() => {
      const group = groupRef.current;
      if (group?.getLayout().length !== visibleColumns.length) return;
      group.setLayout(getWorkspaceDefaultSizes(visibleColumns, sizes));
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [visibleKey]);

  const columns: Record<WorkspaceColumn, React.ReactNode> = {
    code: codeColumn,
    simulation: simulationColumn,
    tutor: <TutorPlaceholder />,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="experimental-workspace">
      <WorkspaceVisibilityControls
        visibility={visibility}
        onColumnToggle={(column) => setColumnVisible(column, !visibility[column])}
        onRestoreDefault={restoreDefaultLayout}
      />
      {visibleColumns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6" data-testid="workspace-empty-state">
          <div className="max-w-lg rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
            <h2 className="text-lg font-semibold">Keine Ansicht geöffnet</h2>
            <p className="mt-2 text-ui-sm text-muted-foreground">
              Blende mindestens einen Workspace-Bereich ein, um weiterzuarbeiten.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {(["code", "simulation", "tutor"] as WorkspaceColumn[]).map((column) => (
                <Button
                  key={column}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setColumnVisible(column, true)}
                  data-testid={`workspace-empty-show-${column}`}
                >
                  {getWorkspaceEmptyStateLabel(column)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          ref={groupRef}
          direction="horizontal"
          className="min-h-0 flex-1 workspace-experimental-main-layout"
          id="experimental-main-layout"
          onLayout={(layout) => {
            setSizes((current) => {
              const next = { ...current };
              visibleColumns.forEach((column, index) => {
                const size = layout[index];
                if (typeof size === "number" && size > 0) next[column] = size;
              });
              return next;
            });
          }}
        >
          {visibleColumns.map((column, index) => (
            <React.Fragment key={column}>
              <ResizablePanel
                id={`experimental-${column}-panel`}
                data-testid={`workspace-column-${column}`}
                defaultSize={getWorkspaceDefaultSizes(visibleColumns, sizes)[index]}
                minSize={20}
                className={`workspace-experimental-${column}-panel min-w-0`}
              >
                {columns[column]}
              </ResizablePanel>
              {resizePairs[index] && (
                <ResizableHandle
                  withHandle
                  data-testid={`workspace-resizer-${resizePairs[index][0]}-${resizePairs[index][1]}`}
                  className="workspace-experimental-horizontal-handle"
                />
              )}
            </React.Fragment>
          ))}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
