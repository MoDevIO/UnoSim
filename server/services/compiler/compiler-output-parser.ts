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
    // match patterns like 'file:line:column: error: message' or
    // 'file:line: error: message' (column optional)
    const regex = /^([^:\n]+):(\d+)(?::(\d+))?: +(warning|error): +([^\n]*)$/gm; // NOSONAR S5843
    const results: CompilationError[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr))) {
      let [_, file, lineStr, colStr, type, message] = match;
      // shorten to basename so frontend sees just the filename
      file = basename(file);
      let lineNum = Number.parseInt(lineStr, 10);
      if (lineOffset > 0) {
        lineNum = Math.max(1, lineNum - lineOffset);
      }
      const colNum = colStr ? Number.parseInt(colStr, 10) : 0;
      const item: CompilationError = {
        file,
        line: lineNum,
        column: colNum,
        type: type as 'error' | 'warning',
        message,
      };
      const key = `${file}:${lineNum}:${colNum}:${type}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }

    const memoryOverflow = parseMemoryOverflow(stderr);
    if (memoryOverflow && !results.some((result) => result.message === memoryOverflow.message)) {
      results.push(memoryOverflow);
    }

    for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
      const libraryWarning = parseLibraryScanWarning(line);
      if (libraryWarning && !results.some((result) => result.message === libraryWarning.message)) {
        results.push(libraryWarning);
      }
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
