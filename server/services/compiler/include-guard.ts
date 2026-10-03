import { normalizeSourcePath, type SourceProject } from "@shared/source-project";

/**
 * Include boundary for the REST compiler, which runs arduino-cli inside the
 * backend instead of a sandbox. The preprocessor reads every included file and
 * echoes its lines in diagnostics, so an include must not name a file outside
 * the submitted project or the toolchain's own include directories.
 *
 * The scan is deliberately conservative: it treats every `#`/`%:` that is
 * preceded on its logical line only by whitespace or comments as a directive,
 * also inside block comments and raw strings. A false positive rejects a sketch
 * with an explicit message; a false negative would let the compiler read a file.
 */

export interface UnsafeInclude {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const FILE_DIRECTIVES = new Set(["include", "include_next", "import", "embed"]);
const DIRECTIVE_START = /(?:#|%:|\?\?=)[ \t\f\v]*/y;
const HAS_INCLUDE = /__has_include(?:_next)?\b/g;
const HEADER_NAME_DELIMITERS: Readonly<Record<string, { close: string; kind: "quoted" | "angled" }>> = {
  '"': { close: '"', kind: "quoted" },
  "<": { close: ">", kind: "angled" },
};

interface LogicalLine {
  readonly text: string;
  readonly line: number;
}

/** Translation phase 2: join backslash-continued physical lines. */
function logicalLines(source: string): LogicalLine[] {
  const physical = source.split(/\r?\n/);
  const lines: LogicalLine[] = [];
  let buffer = "";
  let startLine = 1;
  physical.forEach((text, index) => {
    if (buffer === "") startLine = index + 1;
    if (text.endsWith("\\")) {
      buffer += text.slice(0, -1);
      return;
    }
    lines.push({ text: buffer + text, line: startLine });
    buffer = "";
  });
  if (buffer !== "") lines.push({ text: buffer, line: startLine });
  return lines;
}

/** Skips whitespace and block comments; returns the index of the next token. */
function skipSpaceAndComments(text: string, start: number): number {
  let index = start;
  for (;;) {
    while (index < text.length && /[ \t\f\v]/.test(text[index])) index += 1;
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return text.length;
      index = end + 2;
      continue;
    }
    return index;
  }
}

/** Index where directive candidates may start: after a leading comment tail or comments. */
function directiveCandidateStart(text: string): number {
  // A block comment opened on an earlier line may end on this one; whatever
  // follows its end can still start a directive. Considering both positions
  // keeps the scan conservative.
  return skipSpaceAndComments(text, 0);
}

function parseHeaderName(text: string, start: number): { kind: "quoted" | "angled"; path: string } | null {
  const index = skipSpaceAndComments(text, start);
  const delimiters = HEADER_NAME_DELIMITERS[text[index]];
  if (!delimiters) return null;
  const end = text.indexOf(delimiters.close, index + 1);
  if (end < 0) return null;
  return { kind: delimiters.kind, path: text.slice(index + 1, end) };
}

function directoryOf(file: string): string {
  const separator = file.lastIndexOf("/");
  return separator < 0 ? "" : file.slice(0, separator);
}

function isSafeHeaderName(fromFile: string, header: { kind: "quoted" | "angled"; path: string }): boolean {
  const { path } = header;
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/")) return false;
  if (header.kind === "angled") {
    return path.split("/").every((segment) => segment !== ".." && segment !== "");
  }
  const base = directoryOf(fromFile);
  return normalizeSourcePath(base ? `${base}/${path}` : path) !== undefined;
}

function checkDirective(file: string, line: LogicalLine, at: number): UnsafeInclude | null {
  DIRECTIVE_START.lastIndex = at;
  if (!DIRECTIVE_START.exec(line.text)) return null;
  const nameStart = skipSpaceAndComments(line.text, DIRECTIVE_START.lastIndex);
  const name = /^[A-Za-z0-9_\\$]*/.exec(line.text.slice(nameStart))?.[0] ?? "";
  if (name.includes("\\")) {
    return { file, line: line.line, message: "Escaped preprocessor directive names are not allowed" };
  }
  if (!FILE_DIRECTIVES.has(name)) return null;
  const header = parseHeaderName(line.text, nameStart + name.length);
  if (!header) {
    return { file, line: line.line, message: `#${name} must name a literal "file" or <file>` };
  }
  if (!isSafeHeaderName(file, header)) {
    return { file, line: line.line, message: `#${name} path is outside the sketch project: ${header.path}` };
  }
  return null;
}

function checkHasInclude(file: string, line: LogicalLine): UnsafeInclude | null {
  for (const match of line.text.matchAll(HAS_INCLUDE)) {
    const open = skipSpaceAndComments(line.text, (match.index ?? 0) + match[0].length);
    if (line.text[open] !== "(") {
      return { file, line: line.line, message: `${match[0]} must name a literal "file" or <file>` };
    }
    const header = parseHeaderName(line.text, open + 1);
    if (!header || !isSafeHeaderName(file, header)) {
      return { file, line: line.line, message: `${match[0]} path is not allowed` };
    }
  }
  return null;
}

/** Returns every include that could make the compiler read a file outside the project. */
export function findUnsafeIncludes(project: SourceProject): UnsafeInclude[] {
  return Object.entries(project.files).flatMap(([file, source]) =>
    logicalLines(source).flatMap((line) => scanLine(file, line)),
  );
}

function scanLine(file: string, line: LogicalLine): UnsafeInclude[] {
  const candidates = new Set([directiveCandidateStart(line.text)]);
  const commentTail = line.text.indexOf("*/");
  if (commentTail >= 0) candidates.add(skipSpaceAndComments(line.text, commentTail + 2));
  return [
    ...[...candidates].map((at) => checkDirective(file, line, at)),
    checkHasInclude(file, line),
  ].filter((finding): finding is UnsafeInclude => finding !== null);
}
