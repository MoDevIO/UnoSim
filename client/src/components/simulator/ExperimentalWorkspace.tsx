import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { PanelHeader } from "@/components/ui/panel-header";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { Code2, Ellipsis, GraduationCap, History, MessageCirclePlus, Monitor, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TutorPanelState, TutorSketch } from "@/hooks/use-tutor";
import type { TutorPanelActions } from "./tutor-panel-status";

// The learning step, history and settings load when the Tutor column opens; the page's start does not need them.
const TutorHistoryView = React.lazy(() => import("./tutor-dialog-parts").then((module) => ({ default: module.TutorHistoryView })));
const TutorLearningStep = React.lazy(() => import("./tutor-learning-step").then((module) => ({ default: module.TutorLearningStep })));
const TutorSettingsView = React.lazy(() => import("./tutor-settings-view").then((module) => ({ default: module.TutorSettingsView })));
import { ensureExternalExamplesCatalog } from "@/lib/external-examples";
import { getTutorQuestionVisualState } from "@/lib/tutor-visual-state";
import { getStatusTextClass } from "@/lib/status-semantics";
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

function getWorkspaceColumnIcon(column: WorkspaceColumn) {
  switch (column) {
    case "code":
      return Code2;
    case "simulation":
      return Monitor;
    case "tutor":
      return GraduationCap;
  }
}

function getWorkspaceColumnClassName(column: WorkspaceColumn): string {
  switch (column) {
    case "code":
      return "bg-background";
    case "simulation":
      return "border-l";
    case "tutor":
      return "border-l";
  }
}

function canTutorRequest(tutor: TutorPanelState): boolean {
  return tutor.capabilities.canUseTutor && tutor.credential.trim().length > 0;
}

export function WorkspaceVisibilityControls({
  visibility,
  onColumnToggle,
}: WorkspaceVisibilityControlsProps) {
  return (
    <div
      className="flex items-center gap-1"
      data-testid="experimental-workspace-controls"
      aria-label="Workspace-Ansichten"
    >
      {(["code", "simulation", "tutor"] as WorkspaceColumn[]).map((column) => {
        const label = getWorkspaceColumnLabel(column);
        const Icon = getWorkspaceColumnIcon(column);
        const action = visibility[column] ? "Hide" : "Show";
        const toggleLabel = `${action} ${label.toLowerCase()} workspace`;
        return (
          <ToolbarIconButton
            key={column}
            type="button"
            icon={<Icon className="h-4 w-4" aria-hidden="true" />}
            label={toggleLabel}
            pressed={visibility[column]}
            onClick={() => onColumnToggle(column)}
            data-testid={`workspace-toggle-${column}`}
          />
        );
      })}
    </div>
  );
}

type TutorView = "step" | "history" | "settings";

function TutorStatusIcon({ tutor, tutorReady }: { readonly tutor?: TutorPanelState; readonly tutorReady: boolean }) {
  const visual = getTutorQuestionVisualState({
    tutorReady,
    // The answered question waits for `Weiter`, not for an answer.
    question: tutor && !tutor.awaitingNext ? tutor.question : null,
    isLoading: tutor?.isLoading ?? false,
    error: tutor?.error ?? null,
  });
  const statusClassName = getStatusTextClass(tutorReady ? "success" : "idle");
  const animationClassName = visual.animation ? `toolbar-icon-button-animation-${visual.animation}` : "";
  return (
    <span role="img" aria-label={visual.label} title={visual.label} className="flex" data-testid="tutor-status-icon">
      <GraduationCap className={`${statusClassName} ${animationClassName}`} aria-hidden="true" />
    </span>
  );
}

function TutorMenu({ tutor, tutorReady, onSettings, onNewRound }: {
  readonly tutor: TutorPanelState;
  readonly tutorReady: boolean;
  readonly onSettings: () => void;
  readonly onNewRound: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The trigger needs a ref, which ToolbarIconButton does not pass on. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-foreground hover:border-transparent"
          aria-label="Weitere Tutor-Aktionen"
          title="Weitere Tutor-Aktionen"
          data-testid="tutor-menu"
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuItem onSelect={onSettings} disabled={!tutor.capabilities.canConfigureTutor} data-testid="tutor-api-key-action">
          <Settings aria-hidden="true" />
          Einstellungen
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onNewRound}
          disabled={!tutorReady || tutor.isLoading}
          className="items-start"
          data-testid="tutor-new-round-action"
        >
          <MessageCirclePlus aria-hidden="true" className="mt-0.5" />
          <span className="flex flex-col whitespace-normal">
            <span>Neue Lernrunde starten</span>
            <span className="text-ui-xs text-muted-foreground">Beendet die aktuelle Frage und setzt Verlauf und Lernstand zurück.</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TutorPlaceholder({
  className,
  style,
  code = "",
  sketch,
  tutor,
  debugMode = false,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly code?: string;
  /** The whole project and board; without it the Tutor sees `code` alone. */
  readonly sketch?: TutorSketch;
  readonly tutor?: TutorPanelState;
  readonly debugMode?: boolean;
}) {
  const [view, setView] = useState<TutorView>("step");
  const tutorReady = tutor ? canTutorRequest(tutor) : false;
  const tutorIdentityClassName = getStatusTextClass(tutorReady ? "success" : "idle");
  const request = sketch ?? code;
  const hasHistory = tutor ? tutor.transcript.length > 0 || tutor.focusProgress !== null : false;

  const actions: TutorPanelActions | null = tutor ? {
    startQuestion: () => {
      ensureExternalExamplesCatalog();
      void tutor.generateQuestion(request);
    },
    startNewRound: () => {
      setView("step");
      ensureExternalExamplesCatalog();
      tutor.resetDialog();
      void tutor.generateQuestion(request);
    },
    submitAnswer: () => {
      void tutor.submitAnswer(request);
    },
    requestSupport: (action) => {
      void tutor.requestSupport(action, request);
    },
    openSettings: () => setView("settings"),
    continueToNextQuestion: tutor.continueToNextQuestion,
    retry: tutor.retryFor(request),
  } : null;

  return (
    <section
      className={`h-full w-full overflow-hidden bg-background ${className ?? ""}`}
      style={style}
      aria-label="Tutor"
      data-testid="tutor-panel"
    >
      <div className="flex h-full flex-col">
        <PanelHeader
          title={<span className={tutorIdentityClassName}>Tutor</span>}
          icon={<TutorStatusIcon tutor={tutor} tutorReady={tutorReady} />}
          actions={tutor && actions ? (
            <>
              {debugMode && tutor.lastUsedModel && (
                <span
                  className="max-w-32 truncate text-ui-xs text-muted-foreground"
                  data-testid="tutor-last-used-model"
                  title={`Zuletzt verwendetes Modell: ${tutor.lastUsedModel}`}
                >
                  {tutor.lastUsedModel}
                </span>
              )}
              {hasHistory && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  aria-pressed={view === "history"}
                  onClick={() => setView(view === "history" ? "step" : "history")}
                  data-testid="tutor-history-action"
                >
                  <History aria-hidden="true" />
                  Verlauf
                </Button>
              )}
              <TutorMenu tutor={tutor} tutorReady={tutorReady} onSettings={actions.openSettings} onNewRound={actions.startNewRound} />
            </>
          ) : undefined}
        />
        {tutor && actions ? (
          <TutorPanelContent
            tutor={tutor}
            view={view}
            setView={setView}
            actions={actions}
          />
        ) : (
          <div className="flex flex-1 items-start justify-start p-4 text-left text-muted-foreground">
            <div className="w-full rounded-md border border-dashed p-4">
              <p className="font-medium text-foreground">Learning questions panel</p>
              <p className="mt-1 text-ui-sm">Placeholder for the future Tutor integration.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TutorPanelContent({
  tutor,
  view,
  setView,
  actions,
}: {
  readonly tutor: TutorPanelState;
  readonly view: TutorView;
  readonly setView: (value: TutorView) => void;
  readonly actions: TutorPanelActions;
}) {
  const credentialConfigured = tutor.credential.trim().length > 0;
  const autoLoadedForRef = useRef<string | null>(null);
  const modelLoadKey = tutor.credential;
  const showSettings = view === "settings";

  useEffect(() => {
    if (!showSettings) {
      autoLoadedForRef.current = null;
      return;
    }
    if (!credentialConfigured || tutor.modelsLoading || autoLoadedForRef.current === modelLoadKey) return;
    autoLoadedForRef.current = modelLoadKey;
    void tutor.loadModels();
  }, [credentialConfigured, modelLoadKey, showSettings, tutor.loadModels, tutor.modelsLoading]);

  if (showSettings) {
    return (
      <React.Suspense fallback={null}>
        <TutorSettingsView tutor={tutor} hasQuestion={tutor.question !== null} onApply={() => setView("step")} />
      </React.Suspense>
    );
  }
  if (view === "history") {
    return (
      <React.Suspense fallback={null}>
        <TutorHistoryView
          transcript={tutor.transcript}
          focusProgress={tutor.focusProgress}
          sessionRating={tutor.sessionRating}
          ratedAnswerCount={tutor.ratedAnswerCount}
          onBack={() => setView("step")}
        />
      </React.Suspense>
    );
  }
  return (
    <React.Suspense fallback={null}>
      <TutorLearningStep tutor={tutor} actions={actions} />
    </React.Suspense>
  );
}

export function TutorWorkspacePlaceholder({
  className,
  style,
  code,
  sketch,
  tutor,
  debugMode,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly code?: string;
  readonly sketch?: TutorSketch;
  readonly tutor?: TutorPanelState;
  readonly debugMode?: boolean;
}) {
  return <TutorPlaceholder className={className} style={style} code={code} sketch={sketch} tutor={tutor} debugMode={debugMode} />;
}

interface ExperimentalWorkspaceProps {
  readonly visibleColumns: WorkspaceColumn[];
  readonly sizes: WorkspaceColumnSizes;
  readonly setColumnVisible: (column: WorkspaceColumn, value: boolean) => void;
  readonly restoreDefaultLayout: () => void;
  readonly setSizes: React.Dispatch<React.SetStateAction<WorkspaceColumnSizes>>;
  readonly codeColumn: React.ReactNode;
  readonly simulationColumn: React.ReactNode;
  readonly tutorColumn?: React.ReactNode;
}

export function ExperimentalWorkspace({
  visibleColumns,
  sizes,
  setColumnVisible,
  restoreDefaultLayout,
  setSizes,
  codeColumn,
  simulationColumn,
  tutorColumn,
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
    tutor: tutorColumn ?? <TutorPlaceholder />,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="experimental-workspace">
      {visibleColumns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6" data-testid="workspace-empty-state">
          <div className="max-w-lg rounded-lg border border-dashed border-border p-8 text-center">
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={restoreDefaultLayout}
                data-testid="workspace-restore-default"
              >
                Standardlayout wiederherstellen
              </Button>
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
                order={index}
                data-testid={`workspace-column-${column}`}
                defaultSize={getWorkspaceDefaultSizes(visibleColumns, sizes)[index]}
                minSize={20}
                className={`workspace-experimental-${column}-panel min-w-0 ${getWorkspaceColumnClassName(column)}`}
              >
                {columns[column]}
              </ResizablePanel>
              {resizePairs[index] && (
                <ResizableHandle
                  withHandle
                  data-testid={`workspace-resizer-${resizePairs[index][0]}-${resizePairs[index][1]}`}
                  className="workspace-experimental-horizontal-handle transition-colors hover:after:bg-primary data-[state=dragging]:bg-primary data-[state=dragging]:after:bg-primary"
                />
              )}
            </React.Fragment>
          ))}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
