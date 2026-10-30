import type { LibraryRequirement } from "@shared/libraries";

/**
 * The notice of "Download all files" when the project selects libraries
 * (ssot/ssot_function_definition_Libraries.md §8.1); undefined without any.
 * Kept free of the library rules, which load with the catalog.
 */
export function downloadNotice(libraries: readonly LibraryRequirement[]): string | undefined {
  if (libraries.length === 0) return undefined;
  const names = [...libraries].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => `${entry.name} ${entry.version}`).join(", ");
  return "Der Download enthält nur Quelltextdateien. Bibliotheksauswahl und Versionen sind nicht enthalten und müssen beim erneuten Laden wieder hinzugefügt werden. " +
    `Bibliotheken: ${names}`;
}
