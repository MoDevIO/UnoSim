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

    // if nothing parsed but stderr is present, create generic entries per line
    if (results.length === 0 && stderr.trim()) {
      for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
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
