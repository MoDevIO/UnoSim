import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ClipboardCopy, RotateCcw } from "lucide-react";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { useToast } from "@/hooks/use-toast";
import { getStatusTextClass } from "@/lib/status-semantics";
import {
  buildTutorReviewExport, formatTutorReviewStep, TutorReviewExportTooLargeError, tutorReviewStepRefs, type TutorReviewExportResult,
} from "@/lib/tutor-review-export";
import {
  startNewTutorReviewRun, subscribeTutorReview, tutorReviewRemovedRuns, tutorReviewRuns, tutorReviewVersion, type TutorReviewRun,
} from "@/lib/tutor-review-store";

/** The export size is rebuilt this long after the last change, not for every incoming event. */
const SIZE_DELAY_MS = 300;

function runSummary(run: TutorReviewRun) {
  const answers = run.steps.filter((step) => step.kind === "answer").length;
  const questions = run.steps.filter((step) => step.response?.question !== undefined || step.response?.next !== undefined).length;
  const open = run.steps.filter((step) => step.status === "open").length;
  const models = new Set(run.steps.flatMap((step) => {
    const returned = step.events.find((event) => event.modelReturned)?.modelReturned ?? step.response?.model;
    return returned ? [returned] : [];
  }));
  const graphics = run.steps.flatMap((step) => step.server?.entries.flatMap((entry) => entry.kind === "outcome" ? [entry.graphic] : []) ?? []);
  const rendered = run.steps.filter((step) => step.events.some((event) => event.stage === "renderer" && event.outcome === "rendered")).length;
  return { answers, questions, open, models: [...models], kept: graphics.filter((graphic) => graphic === "kept").length, discarded: graphics.filter((graphic) => graphic === "discarded").length, rendered };
}

function StepDetails({ run, index, version }: { readonly run: TutorReviewRun; readonly index: number; readonly version: number }) {
  const [open, setOpen] = useState(false);
  const step = run.steps[index];
  // Large texts are formatted only when a learner opens the step. The store changes its objects in place,
  // so the store version, not object identity, tells when an open step must be formatted again.
  const text = useMemo(() => {
    if (!open || version < 0) return "";
    return formatTutorReviewStep(step, index + 1, tutorReviewStepRefs(run)).join("\n");
  }, [index, open, run, step, version]);
  return <details className="border-b px-3 py-1" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded-sm text-ui-xs focus-visible:ring-2 focus-visible:ring-ring">
      [{index + 1}] {step.kind} · {step.status}{step.request?.action ? ` · ${step.request.action}` : ""}
    </summary>
    {open && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-ui-xs text-foreground" data-testid="tutor-review-step-text">{text}</pre>}
  </details>;
}

type BuiltExport = { readonly version: number; readonly runId: string; readonly result: TutorReviewExportResult | Error } | null;

/** Builds the export; a failure becomes a value, so it cannot break the Debug tab. */
function tryBuild(run: TutorReviewRun): TutorReviewExportResult | Error {
  try {
    return buildTutorReviewExport(run);
  } catch (error) {
    return error instanceof Error ? error : new Error("Tutor review export failed");
  }
}

function failureText(error: Error): string {
  return error instanceof TutorReviewExportTooLargeError ? "export above the size limit" : "export could not be built";
}

function sizeText(built: BuiltExport, run: TutorReviewRun | undefined, version: number): string {
  if (!built || !run || built.runId !== run.runId) return "…";
  if (built.result instanceof Error) return failureText(built.result);
  const updating = built.version === version ? "" : " (updating…)";
  return `${(built.result.bytes / 1024).toFixed(1)} KiB${updating}`;
}

function completenessText(run: TutorReviewRun): string {
  if (run.incomplete.size === 0 && run.notCaptured === 0) return "complete";
  const notCaptured = run.notCaptured ? [`${run.notCaptured} actions not captured`] : [];
  return `incomplete: ${[...run.incomplete, ...notCaptured].join(", ")}`;
}

function RunSelect({ runs, run, onSelect }: { readonly runs: readonly TutorReviewRun[]; readonly run: TutorReviewRun; readonly onSelect: (runId: string) => void }) {
  return <label className="text-muted-foreground">Run <select aria-label="Tutor review run" className="rounded border bg-background px-2 py-1 text-foreground" value={run.runId} onChange={(event) => onSelect(event.target.value)}>
    {runs.map((candidate, position) => <option key={candidate.runId} value={candidate.runId}>#{position + 1} {candidate.startedAt.slice(11, 19)} ({candidate.status})</option>)}
  </select></label>;
}

function RunSummary({ run }: { readonly run: TutorReviewRun }) {
  const summary = runSummary(run);
  const completeness = completenessText(run);
  const open = summary.open ? `, ${summary.open} open` : "";
  const stopped = run.stoppedReason ? ` (${run.stoppedReason})` : "";
  const removed = tutorReviewRemovedRuns();
  return <output className="block px-3 py-1" data-testid="tutor-review-summary">
    {run.steps.length} steps, {run.contexts.length} contexts · complete run, independent of the message filter · {summary.answers} answers, {summary.questions} questions delivered{open} · models: {summary.models.join(", ") || "unknown"} · graphics: {summary.kept} kept, {summary.discarded} discarded, {summary.rendered} rendered · capture: {run.status}{stopped} · <span className={getStatusTextClass(completeness === "complete" ? "success" : "warning")}>{completeness}</span>
    {removed > 0 && ` · ${removed} older run(s) removed (limit 3)`}
  </output>;
}

/**
 * The Tutor review in the Debug tab (LearningQuestions 12.7): a summary of the selected run, its steps as
 * plain text, and one copy action for the complete run regardless of the message filter.
 */
export function TutorReviewPanel() {
  const version = useSyncExternalStore(subscribeTutorReview, tutorReviewVersion);
  const runs = tutorReviewRuns();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const run = runs.find((candidate) => candidate.runId === selectedId) ?? runs.at(-1);
  const [built, setBuilt] = useState<BuiltExport>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(() => setBuilt({ version, runId: run.runId, result: tryBuild(run) }), SIZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [run, version]);

  const copy = async () => {
    if (!run) return;
    // The copied text is built from the state at the click, so size and counts describe exactly that text.
    const result = tryBuild(run);
    setBuilt({ version, runId: run.runId, result });
    if (result instanceof Error) {
      toast({ title: "Copy failed", description: `The Tutor review ${failureText(result)}; nothing was copied.`, variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(result.text);
      toast({ title: "Tutor review copied", description: `${result.steps} steps, ${result.contexts} contexts, ${(result.bytes / 1024).toFixed(1)} KiB` });
    } catch {
      toast({ title: "Copy failed", description: "The browser did not allow writing to the clipboard; nothing was copied.", variant: "destructive" });
    }
  };

  const size = sizeText(built, run, version);
  return <section aria-label="Tutor review" className="shrink-0 border-b text-ui-xs" data-testid="tutor-review-panel">
    <p className="px-3 py-1 text-muted-foreground">
      Tutor review records questions, answers, feedback and the sent code while Debug mode is on. It stays in this tab&apos;s memory until Clear or reload; copying shares it.
    </p>
    {run ? <>
      <div className="flex flex-wrap items-center gap-2 px-3 py-1">
        {runs.length > 1 && <RunSelect runs={runs} run={run} onSelect={setSelectedId} />}
        <ToolbarIconButton icon={<ClipboardCopy />} label="Copy Tutor review" onClick={() => void copy()} />
        <span data-testid="tutor-review-size">{size}</span>
        <ToolbarIconButton icon={<RotateCcw />} label="Start new Tutor review" onClick={startNewTutorReviewRun} />
      </div>
      <RunSummary run={run} />
      <details className="px-3 py-1">
        <summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring">Review steps ({run.steps.length})</summary>
        <div className="max-h-64 overflow-y-auto">
          {run.steps.map((step, index) => <StepDetails key={step.stepId} run={run} index={index} version={version} />)}
        </div>
      </details>
    </> : <p className="px-3 py-1 text-muted-foreground">No Tutor review recorded yet. Use the Tutor while Debug mode is on.</p>}
  </section>;
}
