import type { BoardId, RuntimeKind } from "./boards";
import type { LibraryPackage } from "./library-catalog-schema";
import type { LibraryRequirement } from "./library-requirements";
import { maskCommentsPreservingLines, resolveIncludePath, type SourceProject } from "./source-project";

/**
 * Project libraries (ssot/ssot_function_definition_Libraries.md): the direct
 * requirements of a project, the curated packages the server offers and the
 * pure rules both sides share – graph resolution, compatibility, include
 * placement and the hints for written includes.
 */

export {
  libraryNameSchema,
  libraryRequirementSchema,
  type LibraryRequirement,
  libraryVersionSchema,
  projectLibrariesSchema,
} from "./library-requirements";

export const COMPATIBILITY_STATUSES = ["verified", "untested", "unsupported"] as const;
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];

export interface CompatibilityStatement {
  readonly status: CompatibilityStatus;
  readonly reason?: string;
}

export type { LibraryCatalogResponse, LibraryPackage, OfferedLibraryPackage } from "./library-catalog-schema";

export const libraryKey = (entry: LibraryRequirement): string => `${entry.name}@${entry.version}`;

/** A requirement resolved for one build: package identity and the directory the toolchain sees. */
export interface ResolvedLibrary extends LibraryRequirement {
  readonly sha256: string;
  readonly dir: string;
}

/** Sorted by name: the order of a selection changes neither its resolution nor the build identity. */
export function canonicalLibraries<T extends LibraryRequirement>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

export type LibraryResolutionProblem =
  | { readonly kind: "missing"; readonly name: string; readonly version: string; readonly requiredBy?: string }
  | { readonly kind: "conflict"; readonly name: string; readonly versions: readonly string[] };

export interface LibraryResolution<P extends LibraryPackage> {
  /** The selection with all fixed dependencies, sorted; empty when there is a problem. */
  readonly packages: readonly P[];
  readonly problems: readonly LibraryResolutionProblem[];
}

/** Resolves direct requirements against the offered packages, never substituting another version. */
export function resolveLibraryGraph<P extends LibraryPackage>(requirements: readonly LibraryRequirement[], catalog: readonly P[]): LibraryResolution<P> {
  const byKey = new Map(catalog.map((entry) => [libraryKey(entry), entry]));
  const versions = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const packages: P[] = [];
  const problems: LibraryResolutionProblem[] = [];
  const queue: Array<{ requirement: LibraryRequirement; requiredBy?: string }> = canonicalLibraries(requirements).map((requirement) => ({ requirement }));

  for (let next = queue.shift(); next; next = queue.shift()) {
    const { requirement, requiredBy } = next;
    const key = libraryKey(requirement);
    versions.set(requirement.name, (versions.get(requirement.name) ?? new Set()).add(requirement.version));
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = byKey.get(key);
    if (!entry) {
      problems.push({ kind: "missing", name: requirement.name, version: requirement.version, ...(requiredBy ? { requiredBy } : {}) });
      continue;
    }
    packages.push(entry);
    for (const dependency of entry.dependencies) queue.push({ requirement: dependency, requiredBy: key });
  }

  for (const [name, set] of versions) {
    if (set.size > 1) problems.push({ kind: "conflict", name, versions: [...set].sort((a, b) => a.localeCompare(b)) });
  }
  return { packages: problems.length > 0 ? [] : canonicalLibraries(packages), problems };
}

/** What a resolution problem means for a person, without paths. */
export function describeResolutionProblem(problem: LibraryResolutionProblem): string {
  if (problem.kind === "conflict") return `${problem.name} is required in more than one version (${problem.versions.join(", ")})`;
  const needed = problem.requiredBy ? ` (needed by ${problem.requiredBy})` : "";
  return `${problem.name} ${problem.version} is not available on this server${needed}`;
}

const UNTESTED: CompatibilityStatement = { status: "untested" };

function statementOf(entry: { status: CompatibilityStatus; reason?: string } | undefined): CompatibilityStatement {
  if (!entry) return UNTESTED;
  return entry.reason === undefined ? { status: entry.status } : { status: entry.status, reason: entry.reason };
}

/** Whether the package builds for the board; missing evidence is `untested`. */
export function compileCompatibility(entry: Pick<LibraryPackage, "compatibility">, board: BoardId): CompatibilityStatement {
  return statementOf(entry.compatibility.compile.find((statement) => statement.board === board));
}

/** Whether the package works in this simulation of the board; missing evidence is `untested`. */
export function runtimeCompatibility(entry: Pick<LibraryPackage, "compatibility">, board: BoardId, runtime: RuntimeKind): CompatibilityStatement {
  return statementOf(entry.compatibility.runtime.find((statement) => statement.board === board && statement.runtime === runtime));
}

const INCLUDE_DIRECTIVE = /^\s*#\s*include\s*([<"])([^>"\r\n]+)[>"]/;
const CONDITIONAL = /^#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/;

interface IncludeDirective {
  readonly header: string;
  readonly quoted: boolean;
  /** 1-based. */
  readonly line: number;
}

/** The `#include` directives outside comments. */
function includeDirectives(source: string): IncludeDirective[] {
  return maskCommentsPreservingLines(source).split(/\r?\n/).flatMap((line, index) => {
    const match = INCLUDE_DIRECTIVE.exec(line);
    return match ? [{ header: match[2].trim(), quoted: match[1] === '"', line: index + 1 }] : [];
  });
}

export interface IncludeContext {
  /** Project file paths; a quoted include that resolves to one of them is the own file, not the library. */
  readonly localHeaders?: readonly string[];
  /** The file the source belongs to, for relative quoted includes. */
  readonly fromFile?: string;
}

function isLocalInclude(directive: IncludeDirective, context: IncludeContext): boolean {
  if (!directive.quoted || !context.localHeaders) return false;
  const target = resolveIncludePath(context.fromFile ?? "", directive.header);
  return target !== undefined && context.localHeaders.includes(target);
}

/** Whether `source` already includes `header` of a library, in angle brackets or quotes. */
export function hasEquivalentInclude(source: string, header: string, context: IncludeContext = {}): boolean {
  return includeDirectives(source).some((directive) => directive.header === header && !isLocalInclude(directive, context));
}

export interface IncludeInsertion {
  readonly content: string;
  /** The headers that were missing and are now included. */
  readonly inserted: readonly string[];
  /** 1-based line of the first inserted include. */
  readonly line?: number;
}

/**
 * Adds the missing includes at the top: behind the existing includes there, or
 * in front of the first code line (after a header comment or an include guard).
 * Nothing else of the source changes.
 */
export function insertIncludes(source: string, headers: readonly string[], context: IncludeContext = {}): IncludeInsertion {
  const missing = [...new Set(headers)].filter((header) => !hasEquivalentInclude(source, header, context));
  if (missing.length === 0) return { content: source, inserted: [] };

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const masked = maskCommentsPreservingLines(source).split(/\r?\n/);
  const { lastInclude, firstCode } = scanPrologue(masked);
  const directives = missing.map((header) => `#include <${header}>`);

  if (lastInclude >= 0) {
    lines.splice(lastInclude + 1, 0, ...directives);
    return { content: lines.join(eol), inserted: missing, line: lastInclude + 2 };
  }
  const at = firstCode < 0 ? leadingContentEnd(masked) : firstCode;
  const separator = firstCode >= 0 ? [""] : [];
  lines.splice(at, 0, ...directives, ...separator);
  return { content: lines.join(eol), inserted: missing, line: at + 1 };
}

/** The last include of the include area at the top and the first line of code (-1 when absent). */
function scanPrologue(masked: readonly string[]): { lastInclude: number; firstCode: number } {
  let lastInclude = -1;
  for (let index = 0; index < masked.length; index++) {
    const line = masked[index].trim();
    if (line === "" || /^#\s*(?:define|pragma|undef)\b/.test(line)) continue;
    if (INCLUDE_DIRECTIVE.test(line)) {
      lastInclude = index;
      continue;
    }
    if (index === firstDirective(masked) && isGuardStart(masked, index)) continue;
    if (CONDITIONAL.test(line) || line !== "") return { lastInclude, firstCode: index };
  }
  return { lastInclude, firstCode: -1 };
}

function firstDirective(masked: readonly string[]): number {
  return masked.findIndex((line) => line.trim() !== "");
}

/** `#ifndef NAME` followed by `#define NAME`: the include guard of a header. */
function isGuardStart(masked: readonly string[], index: number): boolean {
  const name = /^#\s*ifndef\s+(\w+)\s*$/.exec(masked[index].trim())?.[1];
  if (!name) return false;
  const next = masked.slice(index + 1).find((line) => line.trim() !== "");
  return next !== undefined && new RegExp(String.raw`^#\s*define\s+${name}\b`).test(next.trim());
}

/** Where content ends in a file without code: after its last non-blank line. */
function leadingContentEnd(masked: readonly string[]): number {
  for (let index = masked.length - 1; index >= 0; index--) {
    if (masked[index].trim() !== "") return index + 1;
  }
  return 0;
}

export interface LibraryIncludeHint {
  readonly header: string;
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** Every offered package that provides the header; none is chosen automatically. */
  readonly candidates: readonly LibraryRequirement[];
}

/**
 * Written or pasted includes of known library headers whose package the project
 * does not select, directly or transitively (SSOT Libraries §7). Own headers,
 * core headers and unknown headers give no hint.
 */
export function findLibraryIncludeHints(
  project: SourceProject,
  selected: readonly LibraryRequirement[],
  catalog: readonly LibraryPackage[],
): LibraryIncludeHint[] {
  const covered = new Set([...selected.map((entry) => entry.name), ...resolveLibraryGraph(selected, catalog).packages.map((entry) => entry.name)]);
  const providers = new Map<string, LibraryRequirement[]>();
  for (const entry of canonicalLibraries(catalog)) {
    for (const header of entry.headers) providers.set(header, [...(providers.get(header) ?? []), { name: entry.name, version: entry.version }]);
  }
  const localHeaders = Object.keys(project.files);
  const hints: LibraryIncludeHint[] = [];
  const reported = new Set<string>();

  for (const [file, source] of Object.entries(project.files)) {
    for (const directive of includeDirectives(source)) {
      const candidates = providers.get(directive.header);
      if (!candidates || reported.has(directive.header) || isLocalInclude(directive, { localHeaders, fromFile: file })) continue;
      if (candidates.some((candidate) => covered.has(candidate.name))) continue;
      reported.add(directive.header);
      hints.push({ header: directive.header, file, line: directive.line, candidates });
    }
  }
  return hints;
}
