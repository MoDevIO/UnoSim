import React, { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { ArrowUp, CircleHelp, Code2, KeyRound, MessageCircleQuestion, Monitor } from "lucide-react";
import type { TutorPanelState } from "@/hooks/use-tutor";
import { renderMermaidSubset } from "@/lib/tutor-mermaid";
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
      return MessageCircleQuestion;
  }
}

function getWorkspaceColumnClassName(column: WorkspaceColumn): string {
  switch (column) {
    case "code":
      return "bg-background";
    case "simulation":
      return "border-l border-border/40 bg-muted/[0.035]";
    case "tutor":
      return "border-l border-border/40 bg-muted/[0.06]";
  }
}

export function WorkspaceVisibilityControls({
  visibility,
  onColumnToggle,
}: WorkspaceVisibilityControlsProps) {
  return (
    <div
      className="flex items-center gap-1 rounded-md border border-border/70 bg-background/80 p-0.5 shadow-sm"
      data-testid="experimental-workspace-controls"
      aria-label="Workspace-Ansichten"
    >
      {(["code", "simulation", "tutor"] as WorkspaceColumn[]).map((column) => {
        const label = getWorkspaceColumnLabel(column);
        const Icon = getWorkspaceColumnIcon(column);
        const action = visibility[column] ? "ausblenden" : "einblenden";
        return (
          <Button
            key={column}
            type="button"
            size="icon"
            variant="ghost"
            aria-pressed={visibility[column]}
            aria-label={`${label}-Spalte ${action}`}
            title={`${label} ${action}`}
            onClick={() => onColumnToggle(column)}
            data-testid={`workspace-toggle-${column}`}
            className={
              visibility[column]
                ? "h-7 w-7 bg-primary/20 text-primary ring-1 ring-primary/60 shadow-inner hover:bg-primary/25"
                : "h-7 w-7 bg-muted/30 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100"
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

function TutorPlaceholder({
  className,
  style,
  code = "",
  tutor,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly code?: string;
  readonly tutor?: TutorPanelState;
}) {
  const [showKeyView, setShowKeyView] = useState(false);

  return (
    <section
      className={`h-full w-full overflow-hidden bg-background ${className ?? ""}`}
      style={style}
      aria-label="Tutor"
      data-testid="tutor-panel"
    >
      <div className="flex h-full flex-col">
        <PanelHeader
          title="Tutor"
          icon={<MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />}
          centerAction={tutor ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute left-1/2 h-9 w-9 -translate-x-1/2 rounded-full border border-border/70 bg-background/20"
              aria-label="New learning question"
              title="New learning question"
              onClick={() => {
                setShowKeyView(false);
                tutor.resetDialog();
                void tutor.generateQuestion(code);
              }}
              disabled={tutor.isLoading}
              data-testid="tutor-new-question-action"
            >
              <CircleHelp className="!h-6 !w-6" aria-hidden="true" />
            </Button>
          ) : undefined}
          actions={tutor ? (
            <Button
              type="button"
              size="icon"
              variant={showKeyView ? "secondary" : "ghost"}
              className="h-8 w-8"
              aria-label="API key"
              title="API key"
              onClick={() => setShowKeyView(true)}
              data-testid="tutor-api-key-action"
            >
              <KeyRound className="!h-5 !w-5" aria-hidden="true" />
            </Button>
          ) : undefined}
        />
        {tutor ? (
          <TutorPanelContent
            code={code}
            tutor={tutor}
            showKeyView={showKeyView}
            setShowKeyView={setShowKeyView}
          />
        ) : (
          <div className="flex flex-1 items-start justify-start p-4 text-left text-muted-foreground">
            <div className="w-full rounded-md border border-dashed border-border/70 bg-muted/20 p-4">
              <p className="font-medium text-foreground">Learning questions panel</p>
              <p className="mt-1 text-ui-sm">Placeholder for the future Tutor integration.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MermaidPreview({ source }: { readonly source: string }) {
  const renderId = useId().replaceAll(":", "");
  const renderedSvg = renderMermaidSubset(source, `tutor-diagram-${renderId}`);
  if (!renderedSvg) return null;
  return <div className="mt-4 overflow-x-auto text-muted-foreground" data-testid="tutor-mermaid" dangerouslySetInnerHTML={{ __html: renderedSvg }} />;
}

function TutorPanelContent({
  code,
  tutor,
  showKeyView,
  setShowKeyView,
}: {
  readonly code: string;
  readonly tutor: TutorPanelState;
  readonly showKeyView: boolean;
  readonly setShowKeyView: (value: boolean) => void;
}) {
  const { config } = tutor;
  const credentialConfigured = config.mode === "managed" || tutor.credential.length > 0;
  const canRequest = config.mode !== "disabled" && (config.mode === "managed" || credentialConfigured);
  const dialogScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const autoLoadedForRef = useRef<string | null>(null);
  const modelLoadKey = config.mode === "user-key" ? tutor.credential : config.mode;

  useEffect(() => {
    if (!showKeyView) {
      autoLoadedForRef.current = null;
      return;
    }
    if (!credentialConfigured || tutor.modelsLoading || autoLoadedForRef.current === modelLoadKey) return;
    autoLoadedForRef.current = modelLoadKey;
    void tutor.loadModels();
  }, [credentialConfigured, modelLoadKey, showKeyView, tutor.loadModels, tutor.modelsLoading]);

  useEffect(() => {
    if (showKeyView) return;
    const scrollElement = dialogScrollRef.current;
    if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [showKeyView, tutor.history.length, tutor.isLoading, tutor.question?.question]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    const maxHeight = 160;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [tutor.answer]);

  if (showKeyView) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-auto p-4 text-left" data-testid="tutor-api-key-view">
        <div className="mx-auto w-full max-w-xl rounded-md border border-border/70 bg-muted/20 p-4">
          {config.mode === "user-key" && (
            <div>
              <label htmlFor="tutor-api-key" className="text-ui-xs font-medium text-foreground">API key</label>
              <div className="mt-1 flex gap-2">
                <input
                  id="tutor-api-key"
                  type="password"
                  value={tutor.credential}
                  onChange={(event) => tutor.setCredential(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {config.mode !== "disabled" && (
            <div className={config.mode === "user-key" ? "mt-4" : undefined}>
              <label htmlFor="tutor-model" className="text-ui-xs font-medium text-foreground">Model</label>
              <select
                id="tutor-model"
                value={tutor.selectedModel}
                onChange={(event) => tutor.setSelectedModel(event.target.value)}
                disabled={tutor.modelsLoading}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground"
              >
                <option value="auto">Automatic</option>
                {tutor.availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </div>
          )}

          <Button
            type="button"
            className="mt-5 w-full"
            onClick={() => setShowKeyView(false)}
            data-testid="tutor-apply-key"
          >
            Apply
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col text-left">
      <div ref={dialogScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5" data-testid="tutor-dialog-scroll">
        <div className="flex w-full flex-col gap-4">
          {tutor.history.map((turn, index) => (
            <div key={`${turn.question}-${index}`} className="space-y-2" data-testid="tutor-history-turn">
              <div className="max-w-[88%] rounded-lg bg-muted/30 px-4 py-3">
                <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Tutor</p>
                <p className="mt-1 leading-relaxed text-foreground">{turn.question}</p>
              </div>
              <div className="ml-auto max-w-[88%] rounded-lg bg-primary/10 px-4 py-3">
                <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Du</p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{turn.answer}</p>
              </div>
              {turn.feedback && (
                <div className="max-w-[88%] rounded-lg border border-border/60 px-4 py-3" data-testid="tutor-history-feedback">
                  <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Tutor feedback</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{turn.feedback}</p>
                </div>
              )}
            </div>
          ))}

          {tutor.question && (
            <div className="max-w-[88%] rounded-lg bg-muted/30 px-4 py-3" data-testid="tutor-question">
              <div className="flex items-center justify-between gap-2 text-ui-xs text-muted-foreground">
                <span>{tutor.question.topic ?? "Learning question"}</span>
                <span>{tutor.question.difficulty ?? ""}</span>
              </div>
              <p className="mt-2 font-medium leading-relaxed text-foreground">{tutor.question.question}</p>
              {tutor.question.mermaid && <MermaidPreview source={tutor.question.mermaid} />}
            </div>
          )}
          {!tutor.question && tutor.history.length === 0 && (
            <div className="flex min-h-32 items-center justify-center text-center text-muted-foreground">
              <p>Start a new learning question from the header.</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="flex w-full flex-col gap-2">
          {tutor.error && <p className="text-ui-sm text-destructive" role="alert">{tutor.error}</p>}
          <div className="relative">
            <textarea
              ref={composerRef}
              id="tutor-answer"
              value={tutor.answer}
              onChange={(event) => tutor.setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                if (!tutor.answer.trim() || tutor.isLoading || !canRequest || !tutor.question) return;
                event.preventDefault();
                void tutor.submitAnswer(code);
              }}
              rows={1}
              maxLength={2_000}
              disabled={!tutor.question || tutor.isLoading}
              placeholder={tutor.question ? "Your answer …" : "Start a new learning question first …"}
              className="min-h-10 max-h-40 min-w-0 w-full resize-none overflow-y-hidden rounded-md border border-input bg-background px-3 py-2 pr-12 text-ui-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Your answer"
            />
            <Button
              type="button"
              size="icon"
              variant="default"
              aria-label="Send answer"
              title="Send answer"
              className="absolute bottom-1.5 right-1.5 h-9 w-9"
              onClick={() => void tutor.submitAnswer(code)}
              disabled={tutor.isLoading || !tutor.answer.trim() || !canRequest || !tutor.question}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TutorWorkspacePlaceholder({
  className,
  style,
  code,
  tutor,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly code?: string;
  readonly tutor?: TutorPanelState;
}) {
  return <TutorPlaceholder className={className} style={style} code={code} tutor={tutor} />;
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
                  className="workspace-experimental-horizontal-handle bg-border/45 transition-colors hover:bg-primary/70 hover:after:bg-primary data-[state=dragging]:bg-primary data-[state=dragging]:after:bg-primary"
                />
              )}
            </React.Fragment>
          ))}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
