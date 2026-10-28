import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { BoardId, RuntimeKind } from "@shared/boards";
import type { LibraryIncludeHint, LibraryRequirement, OfferedLibraryPackage } from "@shared/libraries";
import { ToastAction } from "@/components/ui/toast";
import type { ToastFn } from "@/hooks/use-toast";
import { buildSourceProject, type ClientSourceTab } from "@/lib/source-project";

/**
 * The library selection of the open sketch and the actions of the Libraries
 * dialog (ssot/ssot_function_definition_Libraries.md §4–§9). The selection
 * lives with the sketch in the page state: a reload restores neither (§8.1).
 */

export interface LibraryEditorApi {
  getValue: () => string;
  /** Replaces the text of the open file as one undoable editor change. */
  replaceContent?: (text: string) => void;
}

export interface UseProjectLibrariesParams {
  readonly board: BoardId | undefined;
  readonly runtime: RuntimeKind | undefined;
  readonly offeredRuntimes: readonly RuntimeKind[];
  readonly tabs: readonly ClientSourceTab[];
  readonly activeTabId: string | null | undefined;
  /** Content of the open file. */
  readonly code: string;
  readonly editorRef: MutableRefObject<LibraryEditorApi | null>;
  /** Writes the open file when there is no editor to do it. */
  readonly setCode?: (code: string) => void;
  readonly setIsModified: (modified: boolean) => void;
  readonly toast: ToastFn;
}

export interface LibraryCatalogState {
  readonly status: "loading" | "ready" | "error";
  /** Packages the server offers; only `available` ones can be used. */
  readonly packages: readonly OfferedLibraryPackage[];
  readonly retry: () => Promise<void>;
}

export interface ActiveLibraryFile {
  readonly path: string;
  /** A source file includes can be inserted into. */
  readonly editable: boolean;
  readonly content: string;
  readonly localHeaders: readonly string[];
}

/** What the "Rückgängig" of the last Einbinden may take back, while nothing changed since. */
interface UndoRecord {
  readonly tabId: string;
  readonly before: string;
  readonly after: string;
  readonly addedRequirement?: LibraryRequirement;
  readonly librariesAfter: readonly LibraryRequirement[];
  readonly board: BoardId | undefined;
  readonly runtime: RuntimeKind | undefined;
  readonly dismiss: () => void;
}

/** The library rules, loaded with the catalog: without a catalog there is nothing to include or check. */
interface LibraryRules {
  readonly shared: typeof import("@shared/libraries");
  readonly local: typeof import("@/lib/project-libraries");
}

const sameLibraries = (a: readonly LibraryRequirement[], b: readonly LibraryRequirement[]) =>
  a.length === b.length && a.every((entry, index) => entry.name === b[index]?.name && entry.version === b[index]?.version);

export function useProjectLibraries(params: UseProjectLibrariesParams) {
  const [libraries, setLibraries] = useState<LibraryRequirement[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<LibraryCatalogState["status"]>("loading");
  const [packages, setPackages] = useState<OfferedLibraryPackage[]>([]);
  const [rules, setRules] = useState<LibraryRules | undefined>();
  const latest = useRef({ params, libraries, rules });
  latest.current = { params, libraries, rules };
  const undoRecord = useRef<UndoRecord | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogStatus("loading");
    try {
      // Schema and rules come with the catalog: they are not part of the initial load path.
      const [response, { libraryCatalogResponseSchema }, shared, local] = await Promise.all([
        fetch("/api/libraries"),
        import("@shared/library-catalog-schema"),
        import("@shared/libraries"),
        import("@/lib/project-libraries"),
      ]);
      const parsed = response.ok ? libraryCatalogResponseSchema.safeParse(await response.json()) : undefined;
      if (!parsed?.success) throw new Error("invalid library catalog");
      setRules({ shared, local });
      setPackages(parsed.data.packages);
      setCatalogStatus("ready");
    } catch {
      // A failed fetch keeps the project selection; the dialog offers a retry.
      setCatalogStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const available = useMemo(() => packages.filter((entry) => entry.available), [packages]);

  const activeFile = useMemo<ActiveLibraryFile | undefined>(() => {
    const tab = params.tabs.find((candidate) => candidate.id === params.activeTabId);
    if (!tab) return undefined;
    const path = tab.path ?? tab.name;
    return {
      path,
      editable: /\.(?:ino|h|hpp)$/i.test(path),
      content: params.code,
      localHeaders: params.tabs.map((candidate) => candidate.path ?? candidate.name),
    };
  }, [params.tabs, params.activeTabId, params.code]);

  const hints = useMemo<LibraryIncludeHint[]>(() => {
    const project = buildSourceProject(params.tabs, params.activeTabId ?? null, params.code);
    return project && rules ? rules.shared.findLibraryIncludeHints(project, libraries, available) : [];
  }, [params.tabs, params.activeTabId, params.code, libraries, available, rules]);

  const currentSource = () => latest.current.params.editorRef.current?.getValue() ?? latest.current.params.code;

  const writeSource = (text: string) => {
    const { editorRef, setCode } = latest.current.params;
    if (editorRef.current?.replaceContent) editorRef.current.replaceContent(text);
    else setCode?.(text);
  };

  const changeLibraries = (next: LibraryRequirement[]) => {
    latest.current = { ...latest.current, libraries: next };
    setLibraries(next);
    latest.current.params.setIsModified(true);
  };

  const undoIsCurrent = (record: UndoRecord): boolean => {
    const { params: current, libraries: selection } = latest.current;
    return current.activeTabId === record.tabId
      && currentSource() === record.after
      && current.board === record.board
      && current.runtime === record.runtime
      && sameLibraries(selection, record.librariesAfter);
  };

  const undo = (record: UndoRecord) => {
    if (undoRecord.current !== record || !undoIsCurrent(record)) {
      latest.current.params.toast({ title: "Rückgängig nicht mehr möglich", description: "Seit dem Einbinden wurde weiter bearbeitet." });
      return;
    }
    undoRecord.current = null;
    record.dismiss();
    if (record.before !== record.after) writeSource(record.before);
    const added = record.addedRequirement;
    if (added) changeLibraries(latest.current.libraries.filter((entry) => entry.name !== added.name));
  };

  // Any later change of source, selection or context ends the joint undo; it never writes an old snapshot.
  useEffect(() => {
    const record = undoRecord.current;
    if (record && !undoIsCurrent(record)) {
      undoRecord.current = null;
      record.dismiss();
    }
  });

  /** "Einbinden" (§6); true when the package and its include are in place, false when nothing changed. */
  const include = (entry: OfferedLibraryPackage): boolean => {
    const { toast, board, runtime, activeTabId } = latest.current.params;
    const loaded = latest.current.rules;
    if (!loaded) return false;
    if (!activeFile?.editable || !activeTabId) {
      toast({ title: "Einbinden nicht möglich", description: "Öffne eine .ino- oder .h-Datei, in die das Include eingefügt werden kann.", variant: "destructive" });
      return false;
    }
    const selected = latest.current.libraries.find((requirement) => requirement.name === entry.name);
    if (selected && selected.version !== entry.version) {
      toast({ title: "Einbinden nicht möglich", description: `${entry.name} ist im Projekt bereits in Version ${selected.version} festgelegt.`, variant: "destructive" });
      return false;
    }
    const next = loaded.local.addRequirement(latest.current.libraries, entry);
    const resolution = loaded.shared.resolveLibraryGraph(next.libraries, available);
    if (resolution.problems.length > 0) {
      toast({ title: "Einbinden nicht möglich", description: resolution.problems.map(loaded.shared.describeResolutionProblem).join("; "), variant: "destructive" });
      return false;
    }
    const before = currentSource();
    const insertion = loaded.shared.insertIncludes(before, entry.includes, { localHeaders: activeFile.localHeaders, fromFile: activeFile.path });
    if (insertion.inserted.length > 0) writeSource(insertion.content);
    if (next.added) changeLibraries(next.libraries);

    const title = `${entry.name} ${entry.version} eingebunden`;
    const description = insertion.inserted.length > 0 ? `Include in ${activeFile.path} ergänzt.` : `Include in ${activeFile.path} war bereits vorhanden.`;
    let record: UndoRecord | undefined;
    const shown = toast({
      title,
      description,
      action: <ToastAction altText="Einbinden rückgängig machen" onClick={() => record && undo(record)}>Rückgängig</ToastAction>,
    });
    record = {
      tabId: activeTabId,
      before,
      after: insertion.content,
      ...(next.added ? { addedRequirement: { name: entry.name, version: entry.version } } : {}),
      librariesAfter: latest.current.libraries,
      board,
      runtime,
      dismiss: shown.dismiss,
    };
    undoRecord.current = record;
    return true;
  };

  const insertInclude = (entry: OfferedLibraryPackage) => {
    const { toast } = latest.current.params;
    const loaded = latest.current.rules;
    if (!loaded || !activeFile?.editable) return;
    const insertion = loaded.shared.insertIncludes(currentSource(), entry.includes, { localHeaders: activeFile.localHeaders, fromFile: activeFile.path });
    if (insertion.inserted.length === 0) return;
    writeSource(insertion.content);
    const headers = insertion.inserted.map((header) => "<" + header + ">").join(", ");
    toast({ title: "Include eingefügt", description: `${headers} in ${activeFile.path}` });
  };

  /** Registers a requirement without touching the source (the hint of a written include, §7). */
  const addRequirement = (requirement: LibraryRequirement) => {
    const next = latest.current.rules?.local.addRequirement(latest.current.libraries, requirement);
    if (!next?.added) return;
    changeLibraries(next.libraries);
    latest.current.params.toast({ title: `${requirement.name} ${requirement.version} hinzugefügt`, description: "Die vorhandene Include-Zeile bleibt unverändert." });
  };

  /** The selection of a newly loaded sketch or example; an example without one has none (§8). */
  const replaceLibraries = useCallback((next: readonly LibraryRequirement[]) => {
    undoRecord.current = null;
    latest.current = { ...latest.current, libraries: [...next] };
    setLibraries([...next]);
  }, []);

  const startBlockReason = () => {
    const { board, runtime, offeredRuntimes } = latest.current.params;
    if (!board || !runtime) return undefined;
    return latest.current.rules?.local.startBlockReason(latest.current.libraries, packages, board, runtime, offeredRuntimes);
  };

  return {
    libraries,
    catalog: { status: catalogStatus, packages, retry: loadCatalog } satisfies LibraryCatalogState,
    activeFile,
    hints,
    include,
    insertInclude,
    addRequirement,
    replaceLibraries,
    startBlockReason,
  };
}
