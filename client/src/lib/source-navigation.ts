import type { SourceLocation } from "@shared/source-project";

export interface SourceNavigationTab {
  id: string;
  name: string;
  path?: string;
}

/** Resolve only the full project path; basenames are intentionally ambiguous. */
export function findTabForSourceLocation(
  tabs: readonly SourceNavigationTab[],
  location: SourceLocation,
): SourceNavigationTab | undefined {
  const exactPath = tabs.find((tab) => tab.path === location.file);
  if (exactPath) return exactPath;

  // Legacy tabs may have no path. Only use their name when it is unique;
  // never guess between duplicate basenames.
  const legacyMatches = tabs.filter(
    (tab) => !tab.path && tab.name === location.file,
  );
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}
