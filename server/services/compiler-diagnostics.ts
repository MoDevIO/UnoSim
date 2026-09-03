import { CompilerOutputParser, type CompilationError } from "./compiler/compiler-output-parser";

export function parseCompilerDiagnostics(stderr: string, lineOffset = 0): CompilationError[] {
  return CompilerOutputParser.parseErrors(stderr, lineOffset);
}
