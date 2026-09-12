/**
 * Pure virtual source-project model and local include resolver.
 *
 * This module deliberately has no filesystem, network, React, or Node.js
 * dependencies. It provides the deterministic source view consumed by
 * project-aware static analyzers.
 */

export type SourcePath = string;

export interface SourceProject {
  entryFile: SourcePath;
  files: Readonly<Record<SourcePath, string>>;
}

export interface SourceLocation {
  file: SourcePath;
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
  file?: SourcePath;
  line?: number;
  include?: string;
}

export interface SourceProjectValidationResult {
  valid: boolean;
  project?: SourceProject;
  errors: SourceProjectDiagnostic[];
}

export interface ResolvedSourceProject {
  entryFile: SourcePath;
  /** Include-ordered source text. */
  source: string;
  /** One origin for every generated source line. */
  lineOrigins: readonly SourceLocation[];
  /** Entry first, followed by files in DFS expansion order. */
  reachableFiles: readonly SourcePath[];
  diagnostics: readonly SourceProjectDiagnostic[];
  complete: boolean;
}

const INCLUDE_PATTERN = /^\s*#\s*include\s*"([^"\r\n]+)"/;
const SYSTEM_INCLUDE_PATTERN = /^\s*#\s*include\s*<[^>\r\n]+>/;
const CONDITIONAL_PATTERN = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/;
const CONDITIONAL_START_PATTERN = /^\s*#\s*(if|ifdef|ifndef)\b/;
const CONDITIONAL_END_PATTERN = /^\s*#\s*endif\b/;
const GUARD_IFNDEF_PATTERN = /^\s*#\s*ifndef\s+([A-Za-z_]\w*)\s*$/;
const GUARD_DEFINE_PATTERN = /^\s*#\s*define\s+([A-Za-z_]\w*)\s*$/;
const GUARD_END_PATTERN = /^\s*#\s*endif(?:\s*\/\/.*)?\s*$/;

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
export function normalizeSourcePath(value: string): SourcePath | undefined {
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

function pathDirectory(path: SourcePath): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function resolveIncludePath(fromFile: SourcePath, include: string): SourcePath | undefined {
  if (!include || include.includes("\\") || include.includes("\0")) return undefined;
  const base = pathDirectory(fromFile);
  return normalizeSourcePath(base ? `${base}/${include}` : include);
}

function maskCommentsPreservingLines(source: string): string {
  let result = "";
  let inBlockComment = false;
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        result += "  ";
        index++;
        inBlockComment = false;
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === inString) {
        inString = null;
      }
      continue;
    }

    if ((current === '"' || current === "'") && !inString) {
      inString = current;
      result += current;
    } else if (current === "/" && next === "*") {
      result += "  ";
      index++;
      inBlockComment = true;
    } else if (current === "/" && next === "/") {
      result += "  ";
      index++;
      while (index + 1 < source.length && source[index + 1] !== "\n") {
        index++;
        result += " ";
      }
    } else {
      result += current;
    }
  }
  return result;
}

interface IncludeGuard {
  ifndefLine: number;
  defineLine: number;
  endifLine: number;
  macro: string;
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
  if (!ifndef || !define || ifndef[1] !== define[1]) return undefined;
  if (!GUARD_END_PATTERN.test(last.line)) return undefined;

  return {
    ifndefLine: first.index,
    defineLine: second.index,
    endifLine: last.index,
    macro: ifndef[1],
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

  if (
    !input ||
    typeof input !== "object" ||
    !input.files ||
    typeof input.files !== "object" ||
    Array.isArray(input.files)
  ) {
    return {
      valid: false,
      errors: [diagnostic("INVALID_PATH", "Source project files must be a record")],
    };
  }

  for (const [rawPath, content] of Object.entries(input.files)) {
    const path = normalizeSourcePath(rawPath);
    if (!path) {
      errors.push(diagnostic("INVALID_PATH", `Invalid source path: ${rawPath}`, { file: rawPath, line: 1 }));
      continue;
    }
    if (typeof content !== "string") {
      errors.push(diagnostic("INVALID_PATH", `Source content must be a string: ${rawPath}`, { file: rawPath, line: 1 }));
      continue;
    }

    const existing = normalizedFiles[path];
    if (existing !== undefined) {
      errors.push(diagnostic("DUPLICATE_PATH", `Duplicate normalized source path: ${path}`, { file: path, line: 1 }));
      continue;
    }

    const folded = path.toLocaleLowerCase("en-US");
    const foldedExisting = caseFolded.get(folded);
    if (foldedExisting && foldedExisting !== path) {
      errors.push(diagnostic(
        "DUPLICATE_PATH",
        `Case-folded source paths collide: ${foldedExisting} and ${path}`,
        { file: path, line: 1 },
      ));
      continue;
    }

    caseFolded.set(folded, path);
    normalizedFiles[path] = content;
  }

  const entryFile = typeof input.entryFile === "string"
    ? normalizeSourcePath(input.entryFile)
    : undefined;
  if (!entryFile) {
    errors.push(diagnostic("INVALID_PATH", `Invalid entry file: ${String(input.entryFile)}`));
  } else if (!Object.prototype.hasOwnProperty.call(normalizedFiles, entryFile)) {
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
  const outputLines: string[] = [];
  const lineOrigins: SourceLocation[] = [];
  const reachableFiles: string[] = [];
  const diagnostics: SourceProjectDiagnostic[] = [];
  const expanded = new Set<string>();
  const stack: string[] = [];
  const guardMacros = new Set<string>();
  const guardByFile = new Map<string, IncludeGuard>();
  for (const [file, content] of Object.entries(project.files)) {
    const guard = detectIncludeGuard(maskCommentsPreservingLines(content).split("\n"));
    if (guard) guardByFile.set(file, guard);
  }

  const addLine = (text: string, file: string, line: number) => {
    outputLines.push(text);
    lineOrigins.push({ file, line });
  };

  const expand = (file: string, includeLocation?: SourceLocation, includeText?: string): void => {
    const guard = guardByFile.get(file);
    if (guard && guardMacros.has(guard.macro)) return;
    if (stack.includes(file)) {
      diagnostics.push(diagnostic(
        "INCLUDE_CYCLE",
        `Include cycle detected while resolving ${file}`,
        includeLocation,
        includeText,
      ));
      return;
    }
    if (expanded.has(file)) return;

    const content = project.files[file];
    if (content === undefined) {
      diagnostics.push(diagnostic(
        "MISSING_LOCAL_INCLUDE",
        `Local include was not found: ${file}`,
        includeLocation,
        includeText,
      ));
      return;
    }

    expanded.add(file);
    reachableFiles.push(file);
    stack.push(file);

    const rawLines = content.split("\n");
    const maskedLines = maskCommentsPreservingLines(content).split("\n");
    if (guard) guardMacros.add(guard.macro);
    let conditionalDepth = 0;

    for (let index = 0; index < rawLines.length; index++) {
      const rawLine = rawLines[index] ?? "";
      const maskedLine = maskedLines[index] ?? "";
      const location: SourceLocation = { file, line: index + 1 };

      const isGuardLine = guard && (
        index === guard.ifndefLine ||
        index === guard.defineLine ||
        index === guard.endifLine
      );
      const conditional = CONDITIONAL_PATTERN.test(maskedLine);
      if (conditional && !isGuardLine) {
        const end = CONDITIONAL_END_PATTERN.test(maskedLine);
        const start = CONDITIONAL_START_PATTERN.test(maskedLine);
        if (start && conditionalDepth === 0) {
          diagnostics.push(diagnostic(
            "UNSUPPORTED_CONDITIONAL_INCLUDE",
            "Conditional preprocessing is not evaluated by the source resolver",
            location,
          ));
        }
        if (end) conditionalDepth = Math.max(0, conditionalDepth - 1);
        else if (start) conditionalDepth++;
        addLine(rawLine, file, index + 1);
        continue;
      }

      const include = INCLUDE_PATTERN.exec(maskedLine)?.[1];
      if (include) {
        if (conditionalDepth > 0) {
          diagnostics.push(diagnostic(
            "UNSUPPORTED_CONDITIONAL_INCLUDE",
            `Conditional local include was not resolved: ${include}`,
            location,
            include,
          ));
          addLine(rawLine, file, index + 1);
          continue;
        }

        const target = resolveIncludePath(file, include);
        if (!target) {
          diagnostics.push(diagnostic(
            "MISSING_LOCAL_INCLUDE",
            `Invalid local include path: ${include}`,
            location,
            include,
          ));
          addLine(rawLine, file, index + 1);
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(project.files, target)) {
          diagnostics.push(diagnostic(
            "MISSING_LOCAL_INCLUDE",
            `Local include was not found: ${target}`,
            location,
            include,
          ));
          addLine(rawLine, file, index + 1);
          continue;
        }
        const targetGuard = guardByFile.get(target);
        if (stack.includes(target) && !(targetGuard && guardMacros.has(targetGuard.macro))) {
          diagnostics.push(diagnostic(
            "INCLUDE_CYCLE",
            `Include cycle detected while resolving ${target}`,
            location,
            include,
          ));
          addLine(rawLine, file, index + 1);
          continue;
        }
        expand(target, location, include);
        continue;
      }

      // System includes remain in the parser view but never add project files.
      if (SYSTEM_INCLUDE_PATTERN.test(maskedLine)) {
        addLine(rawLine, file, index + 1);
        continue;
      }

      addLine(rawLine, file, index + 1);
    }

    stack.pop();
  };

  expand(project.entryFile);
  const incomplete = diagnostics.some(({ code }) =>
    code === "MISSING_LOCAL_INCLUDE" ||
    code === "INCLUDE_CYCLE" ||
    code === "UNSUPPORTED_CONDITIONAL_INCLUDE",
  );
  return {
    entryFile: project.entryFile,
    source: outputLines.join("\n"),
    lineOrigins,
    reachableFiles,
    diagnostics,
    complete: !incomplete,
  };
}
