/**
 * Pure virtual source-project model and local include resolver.
 *
 * This module deliberately has no filesystem, network, React, or Node.js
 * dependencies. It provides the deterministic source view consumed by
 * project-aware static analyzers.
 */

export interface SourceProject {
  entryFile: string;
  files: Readonly<Record<string, string>>;
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export type SourceProjectDiagnosticCode =
  | "INVALID_PATH"
  | "MISSING_ENTRY"
  | "DUPLICATE_PATH"
  | "MISSING_LOCAL_INCLUDE"
  | "INCLUDE_CYCLE"
  | "UNSUPPORTED_CONDITIONAL_INCLUDE";

export interface SourceProjectDiagnostic {
  code: SourceProjectDiagnosticCode;
  message: string;
  file?: string;
  line?: number;
  include?: string;
}

export interface SourceProjectValidationResult {
  valid: boolean;
  project?: SourceProject;
  errors: SourceProjectDiagnostic[];
}

export interface ResolvedSourceProject {
  entryFile: string;
  /** Include-ordered source text. */
  source: string;
  /** One origin for every generated source line. */
  lineOrigins: readonly SourceLocation[];
  /** Entry first, followed by files in DFS expansion order. */
  reachableFiles: readonly string[];
  diagnostics: readonly SourceProjectDiagnostic[];
  complete: boolean;
}

const INCLUDE_PATTERN = /^\s*#\s*include\s*"([^"\r\n]+)"/;
const CONDITIONAL_PATTERN = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/;
const CONDITIONAL_START_PATTERN = /^\s*#\s*(if|ifdef|ifndef)\b/;
const CONDITIONAL_END_PATTERN = /^\s*#\s*endif\b/;
const GUARD_IFNDEF_PATTERN = /^\s*#\s*ifndef\s+([A-Za-z_]\w*)\s*$/;
const GUARD_DEFINE_PATTERN = /^\s*#\s*define\s+([A-Za-z_]\w*)\s*$/;

function diagnostic(
  code: SourceProjectDiagnosticCode,
  message: string,
  location?: SourceLocation,
  include?: string,
): SourceProjectDiagnostic {
  return {
    code,
    message,
    ...(location ? { file: location.file, line: location.line } : {}),
    ...(include ? { include } : {}),
  };
}

/** Normalize a relative POSIX path, returning undefined for unsafe paths. */
export function normalizeSourcePath(value: string): string | undefined {
  if (!value || value.includes("\\") || value.includes("\0")) return undefined;
  if (value.startsWith("/") || value.startsWith("//")) return undefined;

  const segments = value.split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment) return undefined;
    if (segment === ".") continue;
    if (segment === "..") {
      if (normalized.length === 0) return undefined;
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.length > 0 ? normalized.join("/") : undefined;
}

function pathDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function resolveIncludePath(fromFile: string, include: string): string | undefined {
  if (!include || include.includes("\\") || include.includes("\0")) return undefined;
  const base = pathDirectory(fromFile);
  return normalizeSourcePath(base ? `${base}/${include}` : include);
}

function hasOwnProperty(object: object, property: PropertyKey): boolean {
  return Object.getOwnPropertyDescriptor(object, property) !== undefined;
}

interface StringMaskState {
  quote: '"' | "'" | null;
  escaped: boolean;
}

function maskBlockCommentCharacter(
  source: string,
  index: number,
): { text: string; consumed: number; closed: boolean } {
  if (source[index] === "*" && source[index + 1] === "/") {
    return { text: "  ", consumed: 2, closed: true };
  }
  return {
    text: source[index] === "\n" ? "\n" : " ",
    consumed: 1,
    closed: false,
  };
}

function maskLineComment(source: string, start: number): { text: string; nextIndex: number } {
  let nextIndex = start;
  let text = "";
  while (nextIndex < source.length && source[nextIndex] !== "\n") {
    text += " ";
    nextIndex++;
  }
  return { text, nextIndex };
}

function advanceStringMask(state: StringMaskState, current: string): StringMaskState {
  if (state.escaped) return { quote: state.quote, escaped: false };
  if (current === "\\") return { quote: state.quote, escaped: true };
  if (current === state.quote) return { quote: null, escaped: false };
  return state;
}

function maskCommentsPreservingLines(source: string): string {
  const result: string[] = [];
  let inBlockComment = false;
  let stringState: StringMaskState = { quote: null, escaped: false };
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (inBlockComment) {
      const masked = maskBlockCommentCharacter(source, index);
      result.push(masked.text);
      index += masked.consumed;
      inBlockComment = !masked.closed;
      continue;
    }

    if (stringState.quote) {
      result.push(current);
      stringState = advanceStringMask(stringState, current);
      index++;
      continue;
    }

    if (current === '"' || current === "'") {
      stringState = { quote: current, escaped: false };
      result.push(current);
      index++;
      continue;
    }
    if (current === "/" && next === "*") {
      result.push("  ");
      index += 2;
      inBlockComment = true;
      continue;
    }
    if (current === "/" && next === "/") {
      const masked = maskLineComment(source, index);
      result.push(masked.text);
      index = masked.nextIndex;
      continue;
    }
    result.push(current);
    index++;
  }
  return result.join("");
}

interface IncludeGuard {
  ifndefLine: number;
  defineLine: number;
  endifLine: number;
  macro: string;
}

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function isCanonicalGuardEnd(line: string): boolean {
  const directive = line.trim().slice(1).trimStart();
  if (!line.trim().startsWith("#") || !directive.startsWith("endif")) return false;

  const suffix = directive.slice("endif".length);
  if (suffix.length === 0) return true;
  if (!isWhitespace(suffix[0])) return false;
  return suffix.trimStart().startsWith("//");
}

function detectIncludeGuard(maskedLines: string[]): IncludeGuard | undefined {
  const nonEmpty = maskedLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0);
  const first = nonEmpty[0];
  const second = nonEmpty[1];
  const last = nonEmpty.at(-1);
  if (!first || !second || !last) return undefined;

  const ifndef = GUARD_IFNDEF_PATTERN.exec(first.line);
  const define = GUARD_DEFINE_PATTERN.exec(second.line);
  const macro = ifndef?.[1];
  if (!macro || macro !== define?.[1]) return undefined;
  if (!isCanonicalGuardEnd(last.line)) return undefined;

  return {
    ifndefLine: first.index,
    defineLine: second.index,
    endifLine: last.index,
    macro,
  };
}

function emptyResolvedProject(
  entryFile: string,
  diagnostics: SourceProjectDiagnostic[],
): ResolvedSourceProject {
  return {
    entryFile,
    source: "",
    lineOrigins: [],
    reachableFiles: [],
    diagnostics,
    complete: false,
  };
}

/** Validate and normalize all project paths without touching the filesystem. */
export function validateSourceProject(input: SourceProject): SourceProjectValidationResult {
  const errors: SourceProjectDiagnostic[] = [];
  const normalizedFiles: Record<string, string> = Object.create(null) as Record<string, string>;
  const caseFolded = new Map<string, string>();

  if (!isSourceFileRecord(input?.files)) {
    return {
      valid: false,
      errors: [diagnostic("INVALID_PATH", "Source project files must be a record")],
    };
  }

  for (const [rawPath, content] of Object.entries(input.files)) {
    addValidatedSourceFile(rawPath, content, normalizedFiles, caseFolded, errors);
  }

  const entryFile = typeof input.entryFile === "string"
    ? normalizeSourcePath(input.entryFile)
    : undefined;
  if (!entryFile) {
    errors.push(diagnostic("INVALID_PATH", `Invalid entry file: ${String(input.entryFile)}`));
  } else if (!hasOwnProperty(normalizedFiles, entryFile)) {
    errors.push(diagnostic("MISSING_ENTRY", `Entry file is not present in project: ${entryFile}`, { file: entryFile, line: 1 }));
  }

  if (errors.length > 0) return { valid: false, errors };
  if (!entryFile) return { valid: false, errors };
  return {
    valid: true,
    project: { entryFile, files: normalizedFiles },
    errors: [],
  };
}

function isSourceFileRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addValidatedSourceFile(
  rawPath: string,
  content: unknown,
  normalizedFiles: Record<string, string>,
  caseFolded: Map<string, string>,
  errors: SourceProjectDiagnostic[],
): void {
  const path = normalizeSourcePath(rawPath);
  if (!path) {
    errors.push(diagnostic("INVALID_PATH", `Invalid source path: ${rawPath}`, { file: rawPath, line: 1 }));
    return;
  }
  if (typeof content !== "string") {
    errors.push(diagnostic("INVALID_PATH", `Source content must be a string: ${rawPath}`, { file: rawPath, line: 1 }));
    return;
  }
  if (hasOwnProperty(normalizedFiles, path)) {
    errors.push(diagnostic("DUPLICATE_PATH", `Duplicate normalized source path: ${path}`, { file: path, line: 1 }));
    return;
  }

  const folded = path.toLocaleLowerCase("en-US");
  const foldedExisting = caseFolded.get(folded);
  if (foldedExisting && foldedExisting !== path) {
    errors.push(diagnostic(
      "DUPLICATE_PATH",
      `Case-folded source paths collide: ${foldedExisting} and ${path}`,
      { file: path, line: 1 },
    ));
    return;
  }

  caseFolded.set(folded, path);
  normalizedFiles[path] = content;
}

interface SourceResolverContext {
  project: SourceProject;
  outputLines: string[];
  lineOrigins: SourceLocation[];
  reachableFiles: string[];
  diagnostics: SourceProjectDiagnostic[];
  expanded: Set<string>;
  stack: string[];
  guardMacros: Set<string>;
  guardByFile: Map<string, IncludeGuard>;
}

function addResolvedLine(
  context: SourceResolverContext,
  text: string,
  location: SourceLocation,
): void {
  context.outputLines.push(text);
  context.lineOrigins.push(location);
}

function reportIncludeProblem(
  context: SourceResolverContext,
  code: "MISSING_LOCAL_INCLUDE" | "INCLUDE_CYCLE" | "UNSUPPORTED_CONDITIONAL_INCLUDE",
  message: string,
  location?: SourceLocation,
  include?: string,
  sourceLine?: string,
): void {
  context.diagnostics.push(diagnostic(code, message, location, include));
  if (location && sourceLine !== undefined) addResolvedLine(context, sourceLine, location);
}

function processConditionalDirective(
  context: SourceResolverContext,
  maskedLine: string,
  rawLine: string,
  location: SourceLocation,
  lineIndex: number,
  guard: IncludeGuard | undefined,
  conditionalDepth: number,
): number | undefined {
  const isGuardLine = guard !== undefined && (
    lineIndex === guard.ifndefLine ||
    lineIndex === guard.defineLine ||
    lineIndex === guard.endifLine
  );
  if (isGuardLine || !CONDITIONAL_PATTERN.test(maskedLine)) return undefined;

  const startsConditional = CONDITIONAL_START_PATTERN.test(maskedLine);
  if (startsConditional && conditionalDepth === 0) {
    context.diagnostics.push(diagnostic(
      "UNSUPPORTED_CONDITIONAL_INCLUDE",
      "Conditional preprocessing is not evaluated by the source resolver",
      location,
    ));
  }

  let nextDepth = conditionalDepth;
  if (CONDITIONAL_END_PATTERN.test(maskedLine)) {
    nextDepth = Math.max(0, conditionalDepth - 1);
  } else if (startsConditional) {
    nextDepth++;
  }
  addResolvedLine(context, rawLine, location);
  return nextDepth;
}

function isUnguardedCycle(context: SourceResolverContext, target: string): boolean {
  if (!context.stack.includes(target)) return false;
  const targetGuard = context.guardByFile.get(target);
  return !targetGuard || !context.guardMacros.has(targetGuard.macro);
}

function resolveLocalInclude(
  context: SourceResolverContext,
  fromFile: string,
  include: string,
  location: SourceLocation,
  sourceLine: string,
  conditionalDepth: number,
): void {
  if (conditionalDepth > 0) {
    reportIncludeProblem(
      context,
      "UNSUPPORTED_CONDITIONAL_INCLUDE",
      `Conditional local include was not resolved: ${include}`,
      location,
      include,
      sourceLine,
    );
    return;
  }

  const target = resolveIncludePath(fromFile, include);
  if (!target) {
    reportIncludeProblem(
      context,
      "MISSING_LOCAL_INCLUDE",
      `Invalid local include path: ${include}`,
      location,
      include,
      sourceLine,
    );
    return;
  }
  if (!hasOwnProperty(context.project.files, target)) {
    reportIncludeProblem(
      context,
      "MISSING_LOCAL_INCLUDE",
      `Local include was not found: ${target}`,
      location,
      include,
      sourceLine,
    );
    return;
  }
  if (isUnguardedCycle(context, target)) {
    reportIncludeProblem(
      context,
      "INCLUDE_CYCLE",
      `Include cycle detected while resolving ${target}`,
      location,
      include,
      sourceLine,
    );
    return;
  }
  expandSourceFile(context, target, location, include);
}

function processSourceLine(
  context: SourceResolverContext,
  file: string,
  rawLine: string,
  maskedLine: string,
  lineIndex: number,
  guard: IncludeGuard | undefined,
  conditionalDepth: number,
): number {
  const location: SourceLocation = { file, line: lineIndex + 1 };
  const nextDepth = processConditionalDirective(
    context,
    maskedLine,
    rawLine,
    location,
    lineIndex,
    guard,
    conditionalDepth,
  );
  if (nextDepth !== undefined) return nextDepth;

  const include = INCLUDE_PATTERN.exec(maskedLine)?.[1];
  if (include) {
    resolveLocalInclude(context, file, include, location, rawLine, conditionalDepth);
  } else {
    addResolvedLine(context, rawLine, location);
  }
  return conditionalDepth;
}

function expandSourceFile(
  context: SourceResolverContext,
  file: string,
  includeLocation?: SourceLocation,
  includeText?: string,
): void {
  const guard = context.guardByFile.get(file);
  if (guard && context.guardMacros.has(guard.macro)) return;
  if (context.stack.includes(file)) {
    reportIncludeProblem(
      context,
      "INCLUDE_CYCLE",
      `Include cycle detected while resolving ${file}`,
      includeLocation,
      includeText,
    );
    return;
  }
  if (context.expanded.has(file)) return;

  const content = context.project.files[file];
  if (content === undefined) {
    reportIncludeProblem(
      context,
      "MISSING_LOCAL_INCLUDE",
      `Local include was not found: ${file}`,
      includeLocation,
      includeText,
    );
    return;
  }

  context.expanded.add(file);
  context.reachableFiles.push(file);
  context.stack.push(file);
  if (guard) context.guardMacros.add(guard.macro);

  const rawLines = content.split("\n");
  const maskedLines = maskCommentsPreservingLines(content).split("\n");
  let conditionalDepth = 0;
  for (let index = 0; index < rawLines.length; index++) {
    conditionalDepth = processSourceLine(
      context,
      file,
      rawLines[index] ?? "",
      maskedLines[index] ?? "",
      index,
      guard,
      conditionalDepth,
    );
  }
  context.stack.pop();
}

function createResolverContext(project: SourceProject): SourceResolverContext {
  const guardByFile = new Map<string, IncludeGuard>();
  for (const [file, content] of Object.entries(project.files)) {
    const guard = detectIncludeGuard(maskCommentsPreservingLines(content).split("\n"));
    if (guard) guardByFile.set(file, guard);
  }
  return {
    project,
    outputLines: [],
    lineOrigins: [],
    reachableFiles: [],
    diagnostics: [],
    expanded: new Set<string>(),
    stack: [],
    guardMacros: new Set<string>(),
    guardByFile,
  };
}

/**
 * Resolve only local quoted includes reachable from the entry file.
 * Include expansion is depth-first and each canonical file is emitted once.
 */
export function resolveSourceProject(input: SourceProject): ResolvedSourceProject {
  const validation = validateSourceProject(input);
  if (!validation.valid || !validation.project) {
    return emptyResolvedProject(input?.entryFile ?? "", validation.errors);
  }

  const project = validation.project;
  const context = createResolverContext(project);
  expandSourceFile(context, project.entryFile);
  const incomplete = context.diagnostics.some(({ code }) =>
    code === "MISSING_LOCAL_INCLUDE" ||
    code === "INCLUDE_CYCLE" ||
    code === "UNSUPPORTED_CONDITIONAL_INCLUDE",
  );
  return {
    entryFile: project.entryFile,
    source: context.outputLines.join("\n"),
    lineOrigins: context.lineOrigins,
    reachableFiles: context.reachableFiles,
    diagnostics: context.diagnostics,
    complete: !incomplete,
  };
}
