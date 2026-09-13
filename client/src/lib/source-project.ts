import type { SourceProject } from "@shared/source-project";

export interface ClientSourceTab {
  id: string;
  name: string;
  content: string;
  /** Project-relative path when supplied by an external example or file loader. */
  path?: string;
}

function tabPath(tab: ClientSourceTab): string {
  return tab.path ?? tab.name;
}

function isInoPath(path: string): boolean {
  return path.toLowerCase().endsWith(".ino");
}

function isHeaderPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".h") || lower.endsWith(".hpp");
}

/** Choose the stable project entry without depending on the selected tab. */
export function findSourceProjectEntry(
  tabs: readonly ClientSourceTab[],
): string | null {
  const inoTab = tabs.find((tab) => isInoPath(tabPath(tab)));
  if (inoTab) return tabPath(inoTab);

  // Legacy single-file sketches may have a non-extension name. Never promote
  // a header-only project to an entry file.
  const mainTab = tabs[0];
  if (mainTab && !isHeaderPath(tabPath(mainTab))) return tabPath(mainTab);
  return null;
}

/**
 * Build an immutable analysis snapshot from the current client tab state.
 * The editor's `code` wins for the selected tab because tabs are persisted
 * separately and may lag behind Monaco's latest change.
 */
export function buildSourceProject(
  tabs: readonly ClientSourceTab[],
  activeTabId: string | null,
  code: string,
): SourceProject | null {
  const entryFile = findSourceProjectEntry(tabs);
  if (!entryFile) return null;

  const files: Record<string, string> = {};
  const seenPaths = new Set<string>();
  for (const tab of tabs) {
    const path = tabPath(tab);
    const foldedPath = path.toLocaleLowerCase("en-US");
    if (seenPaths.has(foldedPath)) return null;
    seenPaths.add(foldedPath);
    files[path] = tab.id === activeTabId ? code : tab.content;
  }
  return { entryFile, files };
}
