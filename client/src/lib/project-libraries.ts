import type { BoardId, RuntimeKind } from "@shared/boards";
import {
  canonicalLibraries,
  hasEquivalentInclude,
  type IncludeContext,
  libraryKey,
  type LibraryRequirement,
  type OfferedLibraryPackage,
  resolveLibraryGraph,
  runtimeCompatibility,
} from "@shared/libraries";
import { ENGINE_LABELS } from "@/lib/runtime/runtime-selection";

/**
 * Client rules of the project libraries (ssot/ssot_function_definition_Libraries.md)
 * that do not depend on React: what the dialog shows and offers, whether a run
 * may start, and the notice of the source download.
 */

/** One entry of the dialog's library list: an offered package or a required version, once per name and version. */
export interface LibraryListEntry extends LibraryRequirement {
  /** The catalog package of exactly this version; absent when the server does not offer it. */
  readonly offered?: OfferedLibraryPackage;
  /** The project selects exactly this name and version. */
  readonly inProject: boolean;
  /** This deployment provides it; a required version the server lacks is not available. */
  readonly available: boolean;
}

/** The offered packages and the required versions missing on this server in one sorted list (§5.2). */
export function libraryListEntries(catalog: readonly OfferedLibraryPackage[], libraries: readonly LibraryRequirement[]): LibraryListEntry[] {
  const selected = new Set(libraries.map(libraryKey));
  const entries = new Map<string, LibraryListEntry>();
  for (const entry of catalog) {
    entries.set(libraryKey(entry), { name: entry.name, version: entry.version, offered: entry, inProject: selected.has(libraryKey(entry)), available: entry.available });
  }
  for (const requirement of libraries) {
    if (!entries.has(libraryKey(requirement))) entries.set(libraryKey(requirement), { name: requirement.name, version: requirement.version, inProject: true, available: false });
  }
  return canonicalLibraries([...entries.values()]);
}

/** What the details offer for a package: Einbinden, Include einfügen, Bereits eingebunden, or nothing. */
export type IncludeAction = "include" | "insert-include" | "already-included" | "unavailable" | "other-version";

export function includeAction(
  entry: OfferedLibraryPackage,
  libraries: readonly LibraryRequirement[],
  activeSource: string,
  context: IncludeContext,
): IncludeAction {
  if (!entry.available) return "unavailable";
  const selected = libraries.find((requirement) => requirement.name === entry.name);
  if (!selected) return "include";
  if (selected.version !== entry.version) return "other-version";
  return entry.includes.every((header) => hasEquivalentInclude(activeSource, header, context)) ? "already-included" : "insert-include";
}

/**
 * The selection with `requirement` added once; `added` is false when the name is selected already.
 * A selected version is never changed (there is no version change in the first stage, §4).
 */
export function addRequirement(libraries: readonly LibraryRequirement[], requirement: LibraryRequirement): { libraries: LibraryRequirement[]; added: boolean } {
  if (libraries.some((entry) => entry.name === requirement.name)) return { libraries: [...libraries], added: false };
  return { libraries: canonicalLibraries([...libraries, { name: requirement.name, version: requirement.version }]), added: true };
}

/**
 * Why a run of this selection may not start on this board and engine: a package that explicitly does
 * not support the runtime blocks every start path (§9); untested ones do not. Names an offered engine
 * that is not unsupported, but never switches it.
 */
export function startBlockReason(
  libraries: readonly LibraryRequirement[],
  catalog: readonly OfferedLibraryPackage[],
  board: BoardId,
  runtime: RuntimeKind,
  offeredRuntimes: readonly RuntimeKind[],
): string | undefined {
  const { packages } = resolveLibraryGraph(libraries, catalog);
  for (const entry of packages) {
    const statement = runtimeCompatibility(entry, board, runtime);
    if (statement.status !== "unsupported") continue;
    const alternative = offeredRuntimes.find((kind) => kind !== runtime && runtimeCompatibility(entry, board, kind).status !== "unsupported");
    const reason = statement.reason ? `: ${statement.reason}` : ".";
    const hint = alternative ? ` Choose ${ENGINE_LABELS[alternative]} in Settings.` : "";
    return `${entry.name} ${entry.version} does not run in the ${ENGINE_LABELS[runtime]} engine${reason}${hint}`;
  }
  return undefined;
}
