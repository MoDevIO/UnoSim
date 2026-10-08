import { CompilerOutputParser, type CompilationError } from "./compiler/compiler-output-parser";

/** Compiler diagnostics returned to a learner; anything beyond is reported as omitted. */
export const MAX_COMPILER_DIAGNOSTIC_CHARS = 256 * 1024;
/** Raw compiler process output captured per compile; above this the compiler is stopped. */
export const MAX_COMPILER_OUTPUT_BYTES = 8 * 1024 * 1024;
/** g++ stops after this many errors; later ones are almost always follow-up noise. */
export const COMPILER_MAX_ERRORS_FLAG = "-fmax-errors=50";

export function parseCompilerDiagnostics(stderr: string, lineOffset = 0): CompilationError[] {
  return CompilerOutputParser.parseErrors(stderr, lineOffset);
}

/** Diagnostics collected while a compiler streams output; keeps at most the shown prefix. */
export interface CompilerDiagnosticsBuffer {
  value: string;
  omittedChars?: number;
}

export function appendCompilerDiagnostics(buffer: CompilerDiagnosticsBuffer, chunk: string): void {
  const room = Math.max(0, MAX_COMPILER_DIAGNOSTIC_CHARS - buffer.value.length);
  if (chunk.length <= room) {
    buffer.value += chunk;
    return;
  }
  buffer.value += chunk.slice(0, room);
  buffer.omittedChars = (buffer.omittedChars ?? 0) + chunk.length - room;
}

/**
 * Cuts diagnostics to MAX_COMPILER_DIAGNOSTIC_CHARS at a line boundary and states how
 * much was left out, so a flood of errors never becomes a huge response or message.
 */
export function limitCompilerDiagnostics(text: string, omittedChars = 0): string {
  let shown = text;
  let omitted = omittedChars;
  if (shown.length > MAX_COMPILER_DIAGNOSTIC_CHARS) {
    const lineEnd = shown.lastIndexOf("\n", MAX_COMPILER_DIAGNOSTIC_CHARS);
    const cut = lineEnd > MAX_COMPILER_DIAGNOSTIC_CHARS / 2 ? lineEnd : MAX_COMPILER_DIAGNOSTIC_CHARS;
    omitted += shown.length - cut;
    shown = shown.slice(0, cut);
  }
  return omitted > 0 ? `${shown.trimEnd()}\n... ${omitted} more characters of compiler output omitted.` : shown;
}
