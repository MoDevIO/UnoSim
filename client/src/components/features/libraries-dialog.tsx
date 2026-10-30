import { Check } from "lucide-react";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import type { ActiveLibraryFile, LibraryCatalogState } from "@/hooks/use-project-libraries";
import { includeAction, type LibraryListEntry, libraryListEntries } from "@/lib/project-libraries";
import { ENGINE_LABELS } from "@/lib/runtime/runtime-selection";
import type { BoardId, RuntimeKind } from "@shared/boards";
import {
  compileCompatibility,
  type CompatibilityStatement,
  type LibraryRequirement,
  type OfferedLibraryPackage,
  runtimeCompatibility,
} from "@shared/libraries";

export interface LibrariesDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly boardId: BoardId;
  readonly boardName: string;
  readonly runtime: RuntimeKind | undefined;
  readonly catalog: LibraryCatalogState;
  readonly libraries: readonly LibraryRequirement[];
  readonly activeFile: ActiveLibraryFile | undefined;
  readonly onInclude: (entry: OfferedLibraryPackage) => void;
  readonly onInsertInclude: (entry: OfferedLibraryPackage) => void;
  /** Loads an example into the current tab; called only after the replacement was confirmed. */
  readonly onOpenExample: (exampleId: string) => void;
  /** Where the focus goes once the dialog closed; the default returns it to the focused element before opening. */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

const keyOf = (entry: LibraryRequirement) => `${entry.name}@${entry.version}`;

/** Only an explicit "not supported" is shown, with its reason; verified and untested stay silent (§5.2). */
function unsupportedText(label: string, statement: CompatibilityStatement): string | undefined {
  if (statement.status !== "unsupported") return undefined;
  const reason = statement.reason ? ` – ${statement.reason}` : "";
  return `${label}: nicht unterstützt${reason}`;
}

/** The project status of a list entry, matched by name and exact version. */
function entryBadges(entry: LibraryListEntry): string[] {
  return [entry.inProject ? "Im Projekt" : undefined, entry.available ? undefined : "Nicht verfügbar"].filter((badge): badge is string => badge !== undefined);
}

function matches(entry: LibraryListEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || entry.name.toLowerCase().includes(needle) || (entry.offered?.description ?? "").toLowerCase().includes(needle);
}

/**
 * The Libraries dialog (SSOT Libraries §5): one list of the offered packages
 * and the required versions missing here, its search, details with
 * compatibility, and "Einbinden". Opening, searching and selecting change
 * neither source nor selection.
 */
export function LibrariesDialog({
  open,
  onOpenChange,
  boardId,
  boardName,
  runtime,
  catalog,
  libraries,
  activeFile,
  onInclude,
  onInsertInclude,
  onOpenExample,
  onCloseAutoFocus,
}: LibrariesDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [pendingExample, setPendingExample] = useState<string | undefined>();
  // "Minimalbeispiel öffnen" that asked; Abbrechen returns the focus to it.
  const exampleTrigger = useRef<HTMLElement | null>(null);

  const entries = useMemo(() => libraryListEntries(catalog.packages, libraries), [catalog.packages, libraries]);
  const listed = useMemo(() => entries.filter((entry) => matches(entry, query)), [entries, query]);
  const selected = listed.find((entry) => keyOf(entry) === selectedKey);
  const requestExample = (exampleId: string, trigger: HTMLElement) => {
    exampleTrigger.current = trigger;
    setPendingExample(exampleId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Fixed height; when the window is too low for the minimum heights of list and details, the dialog scrolls as a whole.
        className="flex h-[min(85vh,36rem)] max-w-3xl flex-col gap-3 overflow-y-auto"
        aria-describedby="libraries-dialog-context"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Libraries</DialogTitle>
          <DialogDescription id="libraries-dialog-context">
            {boardName} · {runtime ? ENGINE_LABELS[runtime] : "–"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-rows-[minmax(10rem,2fr)_minmax(12rem,3fr)] gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-[minmax(14rem,1fr)]">
          {/* Search and list share one column, so both have the same width and edges. */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <Input
              type="search"
              aria-label="Bibliotheken durchsuchen"
              placeholder="Name oder Beschreibung"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full shrink-0"
            />
            <UnifiedScrollArea orientation="vertical" className="min-h-0 flex-1 rounded-md border" viewportClassName="p-1">
              <LibraryList catalog={catalog} query={query} entries={entries} listed={listed} selectedKey={selectedKey} onSelect={setSelectedKey} />
            </UnifiedScrollArea>
          </div>
          <UnifiedScrollArea orientation="vertical" className="min-h-0 min-w-0 rounded-md border" viewportClassName="p-3">
            {selected && (
              selected.offered?.available
                ? <PackageDetails boardId={boardId} runtime={runtime} libraries={libraries} activeFile={activeFile} onInclude={onInclude} onInsertInclude={onInsertInclude} entry={selected.offered} onRequestExample={requestExample} />
                : <MissingDetails entry={selected} />
            )}
          </UnifiedScrollArea>
        </div>

        <AlertDialog open={pendingExample !== undefined} onOpenChange={(open) => !open && setPendingExample(undefined)}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (!exampleTrigger.current?.isConnected) return;
              event.preventDefault();
              exampleTrigger.current.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Aktuellen Sketch ersetzen?</AlertDialogTitle>
              <AlertDialogDescription>
                Das Minimalbeispiel ersetzt die aktuellen Dateien und die Bibliotheksauswahl. Ein laufender Sketch wird beendet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingExample(undefined)}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const exampleId = pendingExample;
                  setPendingExample(undefined);
                  if (exampleId) {
                    exampleTrigger.current = null;
                    onOpenExample(exampleId);
                    onOpenChange(false);
                  }
                }}
              >
                Ersetzen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

interface LibraryListProps {
  readonly catalog: LibraryCatalogState;
  readonly query: string;
  readonly entries: readonly LibraryListEntry[];
  readonly listed: readonly LibraryListEntry[];
  readonly selectedKey: string | undefined;
  readonly onSelect: (key: string) => void;
}

function LibraryList({ catalog, query, entries, listed, selectedKey, onSelect }: LibraryListProps) {
  const message = (text: string) => <p className="p-2 text-ui-sm text-muted-foreground">{text}</p>;

  if (catalog.status === "loading") return message("Bibliotheken werden geladen …");
  if (catalog.status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p className="text-ui-sm text-destructive">Bibliotheken konnten nicht geladen werden. Die Projektauswahl bleibt erhalten.</p>
        <Button size="sm" variant="outline" onClick={() => void catalog.retry()}>Erneut versuchen</Button>
      </div>
    );
  }
  if (entries.length === 0) return message("Dieser Server bietet keine Bibliotheken an.");
  if (listed.length === 0) return message(`Keine Treffer für „${query.trim()}“.`);
  return (
    <ul className="flex flex-col gap-1">
      {listed.map((entry) => (
        <li key={keyOf(entry)}>
          <ListButton
            selected={selectedKey === keyOf(entry)}
            onSelect={() => onSelect(keyOf(entry))}
            title={`${entry.name} ${entry.version}`}
            detail={entry.offered?.description ?? "Auf diesem Server nicht angeboten"}
            badges={entryBadges(entry)}
          />
        </li>
      ))}
    </ul>
  );
}

function ListButton(props: { readonly selected: boolean; readonly onSelect: () => void; readonly title: string; readonly detail: string; readonly badges: readonly string[] }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={`multiline-btn flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.selected ? "bg-muted" : "hover:bg-muted/60"}`}
    >
      <span className="w-full break-words text-ui-sm font-medium text-foreground">{props.title}</span>
      {props.badges.length > 0 && (
        <span className="flex max-w-full flex-wrap gap-1">
          {props.badges.map((badge) => <span key={badge} className="max-w-full break-words rounded bg-background px-1.5 text-ui-xs text-muted-foreground">{badge}</span>)}
        </span>
      )}
      <span className="line-clamp-2 text-ui-xs text-muted-foreground">{props.detail}</span>
    </button>
  );
}

interface PackageDetailsProps extends Pick<LibrariesDialogProps, "boardId" | "runtime" | "libraries" | "activeFile" | "onInclude" | "onInsertInclude"> {
  readonly entry: OfferedLibraryPackage;
  readonly onRequestExample: (exampleId: string, trigger: HTMLElement) => void;
}

function PackageDetails({ entry, boardId, runtime, libraries, activeFile, onInclude, onInsertInclude, onRequestExample }: PackageDetailsProps) {
  const action = activeFile?.editable
    ? includeAction(entry, libraries, activeFile.content, { localHeaders: activeFile.localHeaders, fromFile: activeFile.path })
    : undefined;
  const selected = libraries.some((requirement) => requirement.name === entry.name && requirement.version === entry.version);
  const examples = entry.examples.filter((example) => example.exampleId);
  const exampleTitleId = useId();
  const warnings = [
    unsupportedText("Kompilierung", compileCompatibility(entry, boardId)),
    runtime ? unsupportedText(`Simulation (${ENGINE_LABELS[runtime]})`, runtimeCompatibility(entry, boardId, runtime)) : undefined,
  ].filter((warning): warning is string => warning !== undefined);

  return (
    <section aria-label={`${entry.name} ${entry.version}`} className="flex flex-col gap-3">
      <div className="flex flex-col items-start gap-1">
        <h3 className="break-words text-ui-md font-semibold text-foreground">{entry.name} {entry.version}</h3>
        <p className="text-ui-xs text-muted-foreground">{entry.author}</p>
        {/* "✓ Bereits eingebunden" already says so; the list keeps its "Im Projekt". */}
        {selected && action !== "already-included" && <span data-testid="library-project-badge" className="rounded bg-muted px-1.5 text-ui-xs">Im Projekt</span>}
      </div>
      <IncludeButton action={action} activeFile={activeFile} onInclude={() => onInclude(entry)} onInsertInclude={() => onInsertInclude(entry)} />
      <p className="text-ui-sm text-foreground">{entry.description}</p>
      {warnings.length > 0 && (
        <ul className="text-ui-xs text-destructive">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <p className="text-ui-xs text-muted-foreground">
        Lizenz {entry.license} · <a className="underline" href={entry.documentationUrl} target="_blank" rel="noreferrer">Dokumentation</a>
      </p>
      {examples.length > 0 && (
        <div className="flex flex-col gap-2">
          {examples.map((example, index) => (
            <div key={example.path} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Button
                size="sm"
                variant="outline"
                aria-describedby={examples.length > 1 ? `${exampleTitleId}-${index}` : undefined}
                onClick={(event) => example.exampleId && onRequestExample(example.exampleId, event.currentTarget)}
              >
                Minimalbeispiel öffnen
              </Button>
              {/* A single example needs no title; several are told apart by theirs. */}
              {examples.length > 1 && <span id={`${exampleTitleId}-${index}`} className="min-w-0 break-words text-ui-xs text-muted-foreground">{example.title}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function IncludeButton(props: {
  readonly action: ReturnType<typeof includeAction> | undefined;
  readonly activeFile: ActiveLibraryFile | undefined;
  readonly onInclude: () => void;
  readonly onInsertInclude: () => void;
}) {
  if (!props.action) {
    return <p className="text-ui-xs text-muted-foreground">Öffne eine .ino- oder .h-Datei, um die Bibliothek einzubinden.</p>;
  }
  const withTarget = (action: ReactNode) => (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {action}
      <TargetFile path={props.activeFile?.path ?? ""} />
    </div>
  );
  switch (props.action) {
    case "include":
      return withTarget(<Button size="sm" onClick={props.onInclude}>Einbinden</Button>);
    case "insert-include":
      return withTarget(<Button size="sm" onClick={props.onInsertInclude}>Include einfügen</Button>);
    case "already-included":
      // Nothing changes any more, so no target file.
      return (
        <output className="flex items-center gap-1 text-ui-sm font-medium text-foreground">
          <Check aria-hidden className="h-4 w-4 shrink-0 text-status-success" />
          Bereits eingebunden
        </output>
      );
    case "other-version":
      return <p className="text-ui-xs text-muted-foreground">Das Projekt legt eine andere Version dieser Bibliothek fest.</p>;
    case "unavailable":
      return <p className="text-ui-xs text-muted-foreground">Nicht verfügbar auf diesem Server.</p>;
  }
}

/** The file "Einbinden" changes: its name, and the full path on request when it lies in a folder. */
function TargetFile({ path }: { readonly path: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const label = <>Zieldatei: <strong className="font-medium text-foreground">{name}</strong></>;
  if (name === path) return <p className="break-all text-ui-xs text-muted-foreground">{label}</p>;
  return (
    <details className="min-w-0 max-w-full text-ui-xs text-muted-foreground">
      <summary className="cursor-pointer break-all">{label}</summary>
      <p className="break-all">{path}</p>
    </details>
  );
}

function MissingDetails({ entry }: { readonly entry: LibraryListEntry }) {
  const reason = entry.offered?.unavailableReason ?? `Version ${entry.version} wird auf diesem Server nicht angeboten. Eine andere Version wird nicht ersatzweise verwendet.`;
  return (
    <section aria-label={`${entry.name} ${entry.version}`} className="flex flex-col gap-2">
      <h3 className="break-words text-ui-md font-semibold text-foreground">{entry.name} {entry.version}</h3>
      {entry.inProject && <span className="w-fit rounded bg-muted px-1.5 text-ui-xs">Im Projekt</span>}
      <p className="text-ui-sm font-medium text-destructive">Nicht verfügbar</p>
      <p className="text-ui-xs text-muted-foreground">{reason}</p>
    </section>
  );
}
