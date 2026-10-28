import { Logger } from "@shared/logger";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProcessOutputLimitError } from "../process-executor";
import type { ProcessExecution } from "../process-execution-port";
import type { CompilationError } from "./compiler-output-parser";
import { limitCompilerDiagnostics, MAX_COMPILER_OUTPUT_BYTES, parseCompilerDiagnostics } from "../compiler-diagnostics";
import { config as appConfig } from "../../config";
import { findBoardByFqbn } from "@shared/boards";

const logger = new Logger("CLIRunner");

export interface CLICompileConfig {
  fqbn: string;
  buildPath?: string;
  buildCachePath?: string;
}

export interface CLICompileResult {
  success: boolean;
  output: string;
  errors?: string;
  parsedErrors?: CompilationError[];
  binary?: Buffer;
  /** ELF of the same build, for the symbols of the artifact; never part of a response. */
  elf?: Buffer;
}

/** `arduino-cli compile` flags that influence the output; part of the build identity (plan E15). */
export const FIXED_BUILD_FLAGS: readonly string[] = ["--verbose"];

/**
 * Builds arduino-cli compile arguments.
 */
export function buildCompileArgs(
  config: CLICompileConfig,
  sketchDir: string,
): string[] {
  const args = [
    "compile",
    "--fqbn",
    config.fqbn,
    ...FIXED_BUILD_FLAGS,
  ];

  if (config.buildPath) {
    args.push("--build-path", config.buildPath);
  }
  args.push(sketchDir);
  return args;
}

/** What one `arduino-cli compile` printed, wherever it ran (backend or compile sandbox). */
export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Build outputs by file name (`<sketch>.ino.hex`, `<sketch>.ino.elf`, …). */
export type BuildFiles = ReadonlyMap<string, Buffer>;

interface CliRunContext {
  readonly config: CLICompileConfig;
  /** The sketch path as the compiler saw it; diagnostics name it `sketch.ino`. */
  readonly sketchFile: string;
  /** Read only after a successful run. */
  readonly outputs: () => Promise<BuildFiles>;
}

/**
 * Executes arduino-cli compilation.
 */
export async function compileWithArduinoCli(
  sketchFile: string,
  config: CLICompileConfig,
  processExecutor: ProcessExecution,
): Promise<CLICompileResult> {
  // Arduino CLI expects the sketch directory; the public compiler passes the .ino path.
  const sketchDir = dirname(sketchFile);
  const args = buildCompileArgs(config, sketchDir);

  logger.info(`Executing arduino-cli ${args.join(" ")}`);

  try {
    const result = await processExecutor.execute("arduino-cli", args, {
      timeout: appConfig.compilation.timeoutMs,
      stdio: "pipe",
      maxOutputBytes: MAX_COMPILER_OUTPUT_BYTES,
    });
    // A diagnostics flood is a failed compile with truncated output, not a missing CLI.
    const outputLimited = result.error instanceof ProcessOutputLimitError;

    // ProcessExecutor also reports a non-zero exit code as `error`. Only code
    // -1 means that arduino-cli itself could not be started (e.g. ENOENT).
    if (result.error && !outputLimited && (result.code === -1 || isCliSpawnError(result.error))) {
      const errorMessage = withPathHint(`Failed to execute arduino-cli: ${result.error.message}.`);
      logger.error(errorMessage);
      return systemFailure(errorMessage);
    }

    return await interpretCliRun(
      { code: result.code, stdout: result.stdout || "", stderr: result.stderr || "" },
      { config, sketchFile, outputs: () => readBuildFiles(config.buildPath || sketchDir) },
    );
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const errorMessage = withPathHint(`Failed to execute arduino-cli: ${errorText}.`, error);
    const errorType = error instanceof Error ? error.name : typeof error;
    const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? `, ${error.code}`
      : "";
    logger.error(`Failed to execute arduino-cli (${errorType}${errorCode}, ${Buffer.byteLength(errorMessage)} diagnostic bytes)`);
    return systemFailure(errorMessage);
  }
}

/** Success with HEX (and ELF), or the compiler's diagnostics with sketch paths replaced. */
export async function interpretCliRun(run: CliRun, context: CliRunContext): Promise<CLICompileResult> {
  const diagnosticOutput = selectDiagnosticOutput(run.stdout, run.stderr);
  if (run.code === 0) {
    return successResult(run.stdout, diagnosticOutput, context.config, selectBuildOutputs(await context.outputs()));
  }
  const cleanedErrors = limitCompilerDiagnostics(cleanErrorMessage(diagnosticOutput, context.sketchFile));
  return {
    success: false,
    output: hasMemoryUsage(diagnosticOutput) ? parseCompilerOutput(diagnosticOutput, context.config.fqbn) : "",
    errors: cleanedErrors,
    parsedErrors: parseCompilerDiagnostics(cleanedErrors, 0),
  };
}

/** A compile that did not get to the compiler's own diagnostics. */
export function systemFailure(message: string): CLICompileResult {
  return {
    success: false,
    output: "",
    errors: message,
    parsedErrors: [{ file: "system", line: 0, column: 0, type: "error", message }],
  };
}

/**
 * Names the sketch `sketch.ino` and the other project files (headers) by their
 * own name: neither the backend's temp directory nor the sandbox mount shows.
 */
function cleanErrorMessage(errors: string, sketchFile: string): string {
  if (!sketchFile) return errors;
  return errors.replaceAll(sketchFile, "sketch.ino").replaceAll(`${dirname(sketchFile)}/`, "");
}

function withPathHint(message: string, error?: unknown): string {
  return `${message}${error === undefined || isCliSpawnError(error) ? " Make sure arduino-cli is installed and in PATH." : ""}`;
}

function isCliSpawnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "ENOENT" ||
    (typeof candidate.message === "string" && /\bspawn\b.*(?:ENOENT|not found|cannot find)/i.test(candidate.message))
  );
}

function selectDiagnosticOutput(stdout: string, stderr: string): string {
  const outputLines = stdout.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      isMemoryLine(trimmed) ||
      isLibraryScanLine(trimmed) ||
      /^(?:[^:\n]+:\d+(?::\d+)?:\s*)?(?:warning|error):/i.test(trimmed)
    );
  });

  return [...outputLines, stderr].filter(Boolean).join("\n");
}

function isMemoryLine(line: string): boolean {
  return /^(?:sketch uses|global variables use|der sketch verwendet|globale variablen verwenden|not enough memory|data section exceeds available space|compilation error:\s*data section exceeds available space)/i.test(line);
}

function isLibraryScanLine(line: string): boolean {
  return /(?:warning\s*:\s*library\b|multiple libraries were found|library .*\b(?:not found|incompatible|failed)\b)/i.test(line);
}

function hasMemoryUsage(output: string): boolean {
  return /^(?:sketch uses|global variables use|der sketch verwendet|globale variablen verwenden)\b/im.test(output);
}

async function successResult(output: string, diagnosticOutput: string, config: CLICompileConfig, outputs: { binary?: Buffer; elf?: Buffer }): Promise<CLICompileResult> {
  const parsedWarnings = parseCompilerDiagnostics(diagnosticOutput, 0).filter((diagnostic) => diagnostic.type === "warning");
  return {
    success: true,
    output: parseCompilerOutput(output, config.fqbn),
    errors: "",
    parsedErrors: parsedWarnings,
    binary: outputs.binary,
    ...(outputs.elf ? { elf: outputs.elf } : {}),
  };
}

/** The HEX and ELF files of a build directory; empty when it cannot be read. */
async function readBuildFiles(buildOutputDir: string): Promise<BuildFiles> {
  const files = new Map<string, Buffer>();
  let entries: string[];
  try {
    entries = await readdir(buildOutputDir);
  } catch (error) {
    logger.debug(`[CompileCache] failed to read build hex output: ${error instanceof Error ? error.message : String(error)}`);
    return files;
  }
  for (const entry of entries.filter((name) => name.endsWith(".hex") || name.endsWith(".ino.elf"))) {
    try {
      files.set(entry, await readFile(join(buildOutputDir, entry)));
    } catch {
      // A file that vanished or cannot be read is no build output.
    }
  }
  return files;
}

/**
 * The HEX of the build (the one without bootloader when both exist) and, if
 * there is a HEX, the ELF next to it (`<sketch>.ino.elf`).
 */
export function selectBuildOutputs(files: BuildFiles): { binary?: Buffer; elf?: Buffer } {
  const names = [...files.keys()].sort((a, b) => a.localeCompare(b));
  const hexNames = names.filter((name) => name.endsWith(".hex"));
  const hexName = hexNames.find((name) => !name.includes("with_bootloader")) ?? hexNames[0];
  if (!hexName) return {};
  const elfName = names.find((name) => name.endsWith(".ino.elf"));
  return { binary: files.get(hexName), ...(elfName ? { elf: files.get(elfName) } : {}) };
}

/**
 * Parses arduino-cli output to extract memory usage and format it.
 */
function parseCompilerOutput(output: string, fqbn: string): string {
  const board = `Board: ${findBoardByFqbn(fqbn)?.displayName ?? fqbn}`;
  const progSizeRegex = /(Sketch uses[^\n]*\.|Der Sketch verwendet[^\n]*\.)/;
  const ramSizeRegex = /(Global variables use[^\n]*\.|Globale Variablen verwenden[^\n]*\.)/;

  const progSizeMatch = progSizeRegex.exec(output);
  const ramSizeMatch = ramSizeRegex.exec(output);

  if (progSizeMatch && ramSizeMatch) {
    return `${progSizeMatch[0]}\n${ramSizeMatch[0]}\n\n${board}`;
  } else if (progSizeMatch || ramSizeMatch) {
    // Partial memory info
    const parts = [];
    if (progSizeMatch) parts.push(progSizeMatch[0]);
    if (ramSizeMatch) parts.push(ramSizeMatch[0]);
    return `${parts.join("\n")}\n\n${board}`;
  } else {
    // No memory info - check if there's any success output
    const trimmed = output.trim();
    if (trimmed) {
      // If output looks like a generic success message, use (Simulation) suffix
      if (trimmed.toLowerCase().includes("success") || trimmed.toLowerCase().includes("done")) {
        return `${trimmed}\n\n${board} (Simulation)`;
      }
      return `${trimmed}\n\n${board}`;
    }
    return `${board} (Simulation)`;
  }
}
