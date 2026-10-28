import { useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import type { ActiveLibraryFile, LibraryCatalogState } from "@/hooks/use-project-libraries";
import { includeAction, projectEntries, type ProjectLibraryEntry } from "@/lib/project-libraries";
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
}

type View = "available" | "project";

const STATUS_LABELS: Record<CompatibilityStatement["status"], string> = {
  verified: "geprüft",
  untested: "ungeprüft",
  unsupported: "nicht unterstützt",
};

const keyOf = (entry: LibraryRequirement) => `${entry.name}@${entry.version}`;

function statementText(label: string, statement: CompatibilityStatement): string {
  const reason = statement.reason ? ` – ${statement.reason}` : "";
  return `${label}: ${STATUS_LABELS[statement.status]}${reason}`;
}

/** The badge of a catalog entry: selected, or not provided here. */
function availableBadge(entry: OfferedLibraryPackage, selectedNames: ReadonlySet<string>): string | undefined {
  if (selectedNames.has(entry.name)) return "Im Projekt";
  return entry.available ? undefined : "Nicht verfügbar";
}

function matches(entry: { name: string; description?: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || entry.name.toLowerCase().includes(needle) || (entry.description ?? "").toLowerCase().includes(needle);
}

/**
 * The Libraries dialog (SSOT Libraries §5): search, the offered catalog and
 * the project's selection, details with compatibility, and "Einbinden".
 * Opening, searching and switching views change neither source nor selection.
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
}: LibrariesDialogProps) {
  const [view, setView] = useState<View>("available");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [pendingExample, setPendingExample] = useState<string | undefined>();

  const available = useMemo(() => catalog.packages.filter((entry) => matches(entry, query)), [catalog.packages, query]);
  const inProject = useMemo(
    () => projectEntries(libraries, catalog.packages).filter((entry) => matches({ name: entry.name, description: entry.offered?.description }, query)),
    [libraries, catalog.packages, query],
  );
  const selectedNames = new Set(libraries.map((entry) => entry.name));

  const selectedPackage = view === "available" ? available.find((entry) => keyOf(entry) === selectedKey) : undefined;
  const selectedProjectEntry = view === "project" ? inProject.find((entry) => keyOf(entry) === selectedKey) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-3" aria-describedby="libraries-dialog-context">
        <DialogHeader className="shrink-0">
          <DialogTitle>Libraries</DialogTitle>
          <DialogDescription id="libraries-dialog-context">
            {boardName} · {runtime ? ENGINE_LABELS[runtime] : "–"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="search"
            aria-label="Bibliotheken durchsuchen"
            placeholder="Name oder Beschreibung"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="sm:max-w-xs"
          />
          <Tabs value={view} onValueChange={(value) => { setView(value as View); setSelectedKey(undefined); }}>
            <TabsList>
              <TabsTrigger value="available">Verfügbar</TabsTrigger>
              <TabsTrigger value="project">Im Projekt</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <UnifiedScrollArea orientation="vertical" className="min-h-0 rounded-md border" viewportClassName="p-1">
            <CatalogList
              view={view}
              catalog={catalog}
              query={query}
              available={available}
              inProject={inProject}
              selectedNames={selectedNames}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </UnifiedScrollArea>
          <UnifiedScrollArea orientation="vertical" className="min-h-0 rounded-md border" viewportClassName="p-3">
            {selectedPackage && (
              <PackageDetails boardId={boardId} runtime={runtime} libraries={libraries} activeFile={activeFile} onInclude={onInclude} onInsertInclude={onInsertInclude} entry={selectedPackage} onRequestExample={setPendingExample} />
            )}
            {selectedProjectEntry && (
              selectedProjectEntry.offered
                ? <PackageDetails boardId={boardId} runtime={runtime} libraries={libraries} activeFile={activeFile} onInclude={onInclude} onInsertInclude={onInsertInclude} entry={selectedProjectEntry.offered} onRequestExample={setPendingExample} />
                : <MissingDetails entry={selectedProjectEntry} catalog={catalog.packages} />
            )}
            {!selectedPackage && !selectedProjectEntry && (
              <p className="text-ui-sm text-muted-foreground">Wähle eine Bibliothek, um Details zu sehen.</p>
            )}
          </UnifiedScrollArea>
        </div>

        <AlertDialog open={pendingExample !== undefined} onOpenChange={(open) => !open && setPendingExample(undefined)}>
          <AlertDialogContent>
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

interface CatalogListProps {
  readonly view: View;
  readonly catalog: LibraryCatalogState;
  readonly query: string;
  readonly available: readonly OfferedLibraryPackage[];
  readonly inProject: readonly ProjectLibraryEntry[];
  readonly selectedNames: ReadonlySet<string>;
  readonly selectedKey: string | undefined;
  readonly onSelect: (key: string) => void;
}

function CatalogList({ view, catalog, query, available, inProject, selectedNames, selectedKey, onSelect }: CatalogListProps) {
  const message = (text: string) => <p className="p-2 text-ui-sm text-muted-foreground">{text}</p>;

  if (view === "available") {
    if (catalog.status === "loading") return message("Bibliotheken werden geladen …");
    if (catalog.status === "error") {
      return (
        <div className="flex flex-col items-start gap-2 p-2">
          <p className="text-ui-sm text-destructive">Bibliotheken konnten nicht geladen werden. Die Projektauswahl bleibt erhalten.</p>
          <Button size="sm" variant="outline" onClick={() => void catalog.retry()}>Erneut versuchen</Button>
        </div>
      );
    }
    if (catalog.packages.length === 0) return message("Dieser Server bietet keine Bibliotheken an.");
    if (available.length === 0) return message(`Keine Treffer für „${query.trim()}“.`);
    return (
      <ul className="flex flex-col gap-1">
        {available.map((entry) => (
          <li key={keyOf(entry)}>
            <ListButton
              selected={selectedKey === keyOf(entry)}
              onSelect={() => onSelect(keyOf(entry))}
              title={`${entry.name} ${entry.version}`}
              detail={entry.description}
              badge={availableBadge(entry, selectedNames)}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (inProject.length === 0) {
    return message(query.trim() === "" ? "Diesem Projekt sind noch keine Bibliotheken zugeordnet." : `Keine Treffer für „${query.trim()}“.`);
  }
  return (
    <ul className="flex flex-col gap-1">
      {inProject.map((entry) => (
        <li key={keyOf(entry)}>
          <ListButton
            selected={selectedKey === keyOf(entry)}
            onSelect={() => onSelect(keyOf(entry))}
            title={`${entry.name} ${entry.version}`}
            detail={entry.offered?.description ?? "Auf diesem Server nicht verfügbar"}
            badge={entry.offered ? undefined : "Nicht verfügbar"}
          />
        </li>
      ))}
    </ul>
  );
}

function ListButton(props: { readonly selected: boolean; readonly onSelect: () => void; readonly title: string; readonly detail: string; readonly badge?: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={`flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.selected ? "bg-muted" : "hover:bg-muted/60"}`}
    >
      <span className="flex w-full items-center justify-between gap-2 text-ui-sm font-medium text-foreground">
        {props.title}
        {props.badge && <span className="rounded bg-background px-1.5 text-ui-xs text-muted-foreground">{props.badge}</span>}
      </span>
      <span className="line-clamp-2 text-ui-xs text-muted-foreground">{props.detail}</span>
    </button>
  );
}

interface PackageDetailsProps extends Pick<LibrariesDialogProps, "boardId" | "runtime" | "libraries" | "activeFile" | "onInclude" | "onInsertInclude"> {
  readonly entry: OfferedLibraryPackage;
  readonly onRequestExample: (exampleId: string) => void;
}

function PackageDetails({ entry, boardId, runtime, libraries, activeFile, onInclude, onInsertInclude, onRequestExample }: PackageDetailsProps) {
  const action = activeFile?.editable
    ? includeAction(entry, libraries, activeFile.content, { localHeaders: activeFile.localHeaders, fromFile: activeFile.path })
    : undefined;
  const selected = libraries.some((requirement) => requirement.name === entry.name && requirement.version === entry.version);
  const examples = entry.examples.filter((example) => example.exampleId);

  return (
    <section aria-label={`${entry.name} ${entry.version}`} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-ui-md font-semibold text-foreground">{entry.name} {entry.version}</h3>
          <p className="text-ui-xs text-muted-foreground">{entry.author}</p>
        </div>
        {selected && <span data-testid="library-project-badge" className="rounded bg-muted px-1.5 text-ui-xs">Im Projekt</span>}
      </div>
      <p className="text-ui-sm text-foreground">{entry.description}</p>
      <ul className="text-ui-xs text-muted-foreground">
        <li>{statementText("Kompilierung", compileCompatibility(entry, boardId))}</li>
        {runtime && <li>{statementText(`Simulation (${ENGINE_LABELS[runtime]})`, runtimeCompatibility(entry, boardId, runtime))}</li>}
      </ul>
      <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-ui-xs">{entry.includes.map((header) => `#include <${header}>`).join("\n")}</code>
      <p className="text-ui-xs text-muted-foreground">
        Lizenz {entry.license} · <a className="underline" href={entry.documentationUrl} target="_blank" rel="noreferrer">Dokumentation</a>
      </p>
      {examples.length > 0 && (
        <div className="flex flex-col gap-1">
          {examples.map((example) => (
            <div key={example.path} className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => example.exampleId && onRequestExample(example.exampleId)}>Minimalbeispiel öffnen</Button>
              <span className="text-ui-xs text-muted-foreground">{example.title}</span>
            </div>
          ))}
        </div>
      )}
      <IncludeButton action={action} activeFile={activeFile} onInclude={() => onInclude(entry)} onInsertInclude={() => onInsertInclude(entry)} />
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
  const target = <span className="text-ui-xs text-muted-foreground">in {props.activeFile?.path}</span>;
  switch (props.action) {
    case "include":
      return <div className="flex items-center gap-2"><Button size="sm" onClick={props.onInclude}>Einbinden</Button>{target}</div>;
    case "insert-include":
      return <div className="flex items-center gap-2"><Button size="sm" onClick={props.onInsertInclude}>Include einfügen</Button>{target}</div>;
    case "already-included":
      return <div className="flex items-center gap-2"><Button size="sm" disabled>Bereits eingebunden</Button>{target}</div>;
    case "other-version":
      return <p className="text-ui-xs text-muted-foreground">Das Projekt legt eine andere Version dieser Bibliothek fest.</p>;
    case "unavailable":
      return <p className="text-ui-xs text-muted-foreground">Nicht verfügbar auf diesem Server.</p>;
  }
}

function MissingDetails({ entry, catalog }: { readonly entry: ProjectLibraryEntry; readonly catalog: readonly OfferedLibraryPackage[] }) {
  const listed = catalog.find((candidate) => candidate.name === entry.name && candidate.version === entry.version);
  const reason = listed?.unavailableReason ?? `Version ${entry.version} wird auf diesem Server nicht angeboten. Eine andere Version wird nicht ersatzweise verwendet.`;
  return (
    <section aria-label={`${entry.name} ${entry.version}`} className="flex flex-col gap-2">
      <h3 className="text-ui-md font-semibold text-foreground">{entry.name} {entry.version}</h3>
      <p className="text-ui-sm font-medium text-destructive">Nicht verfügbar</p>
      <p className="text-ui-xs text-muted-foreground">{reason}</p>
    </section>
  );
}
