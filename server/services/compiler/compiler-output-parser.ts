/**
 * Compiler Output Parser
 * 
 * Centralizes Arduino CLI output parsing logic including:
 * - Error/warning extraction from gcc-style error messages
 * - Deduplication of error entries
 * - Fallback generic error parsing when regex doesn't match
 */

import { basename } from "node:path";

export interface CompilationError {
  file: string;
  line: number;
  column: number;
  type: 'error' | 'warning';
  message: string;
}

export class CompilerOutputParser {
  /**
   * Parse compiler stderr output into structured error list.
   * 
   * Handles patterns like:
   * - 'file:line:column: error: message'
   * - 'file:line: error: message' (column optional)
   * - Falls back to per-line generic errors if regex doesn't match
   * 
   * @param stderr Raw stderr output from arduino-cli
   * @param lineOffset Optional offset to adjust line numbers (e.g., header injection)
   * @returns Array of structured compilation errors/warnings
   */
  static parseErrors(stderr: string, lineOffset: number = 0): CompilationError[] {
    const results = parseStructuredErrors(stderr, lineOffset);
    appendUnique(results, parseMemoryOverflow(stderr));
    for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
      appendUnique(results, parseLibraryScanWarning(line));
    }

    // if nothing parsed but stderr is present, create generic entries per line
    if (results.length === 0 && stderr.trim()) {
      for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
        if (isInformationalCompilerLine(line)) continue;

        const libraryWarning = parseLibraryScanWarning(line);
        if (libraryWarning) {
          results.push(libraryWarning);
          continue;
        }

        results.push({
          file: "",
          line: 0,
          column: 0,
          type: "error",
          message: line.trim(),
        });
      }
    }

    return results;
  }
}

function parseStructuredErrors(stderr: string, lineOffset: number): CompilationError[] {
  const regex = /^([^:\n]+):(\d+)(?::(\d+))?: +(warning|error): +([^\n]*)$/gm; // NOSONAR S5843
  const results: CompilationError[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stderr))) {
    const [, rawFile, lineStr, colStr, type, message] = match;
    const file = basename(rawFile);
    const line = lineOffset > 0
      ? Math.max(1, Number.parseInt(lineStr, 10) - lineOffset)
      : Number.parseInt(lineStr, 10);
    const column = colStr ? Number.parseInt(colStr, 10) : 0;
    const item: CompilationError = {
      file,
      line,
      column,
      type: type as 'error' | 'warning',
      message,
    };
    const duplicate = results.some((result) =>
      result.file === item.file &&
      result.line === item.line &&
      result.column === item.column &&
      result.type === item.type &&
      result.message === item.message,
    );
    if (!duplicate) results.push(item);
  }
  return results;
}

function appendUnique(results: CompilationError[], item: CompilationError | undefined): void {
  if (!item || results.some((result) => result.message === item.message)) return;
  results.push(item);
}

function parseMemoryOverflow(output: string): CompilationError | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasMemoryOverflow = lines.some((line) =>
    /not enough memory|data section exceeds available space(?: in| on) board/i.test(line),
  );

  if (!hasMemoryOverflow) return undefined;

  const flashUsage = lines.find((line) => /^sketch uses\b|^der sketch verwendet\b/i.test(line));
  const sramUsage = lines.find((line) => /^global variables use\b|^globale variablen verwenden\b/i.test(line));
  const details = [flashUsage, sramUsage].filter(Boolean).join(" ");
  const reason = lines.find((line) => /data section exceeds available space/i.test(line));

  return {
    file: "",
    line: 0,
    column: 0,
    type: "error",
    message: [
      "Not enough memory",
      reason ? `${reason}.` : "Memory usage exceeds the board limit.",
      details,
    ].filter(Boolean).join(" "),
  };
}

function parseLibraryScanWarning(line: string): CompilationError | undefined {
  if (!/(?:warning\s*:\s*library\b|multiple libraries were found|library .*\b(?:not found|incompatible|failed)\b)/i.test(line)) {
    return undefined;
  }

  return {
    file: "",
    line: 0,
    column: 0,
    type: "warning",
    message: line.trim().replace(/^warning\s*:\s*/i, ""),
  };
}

function isInformationalCompilerLine(line: string): boolean {
  return /^(?:sketch uses|global variables use|der sketch verwendet|globale variablen verwenden)\b/i.test(line.trim());
}
