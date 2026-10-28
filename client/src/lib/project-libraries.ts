import type { BoardId, RuntimeKind } from "@shared/boards";
import {
  canonicalLibraries,
  hasEquivalentInclude,
  type IncludeContext,
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

export interface ProjectLibraryEntry extends LibraryRequirement {
  /** The offered package, when this deployment provides exactly this version. */
  readonly offered?: OfferedLibraryPackage;
}

/** The direct selection for "Im Projekt", sorted; a version missing here stays visible. */
export function projectEntries(libraries: readonly LibraryRequirement[], catalog: readonly OfferedLibraryPackage[]): ProjectLibraryEntry[] {
  return canonicalLibraries(libraries).map((requirement) => {
    const offered = catalog.find((entry) => entry.available && entry.name === requirement.name && entry.version === requirement.version);
    return offered ? { ...requirement, offered } : { ...requirement };
  });
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
