import { Logger } from "@shared/logger";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProcessExecutor } from "../process-executor";
import type { CompilationError } from "./compiler-output-parser";
import { parseCompilerDiagnostics } from "../compiler-diagnostics";

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
}

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
    "--verbose",
  ];

  if (config.buildPath) {
    args.push("--build-path", config.buildPath);
  }
  args.push(sketchDir);
  return args;
}

/**
 * Executes arduino-cli compilation.
 */
export async function compileWithArduinoCli(
  sketchFile: string,
  config: CLICompileConfig,
  processExecutor: ProcessExecutor,
): Promise<CLICompileResult> {
  // Arduino CLI expects the sketch directory; the public compiler passes the .ino path.
  const sketchDir = dirname(sketchFile);
  const args = buildCompileArgs(config, sketchDir);

  logger.info(`Executing arduino-cli ${args.join(" ")}`);

  try {
    const result = await processExecutor.execute("arduino-cli", args, {
      timeout: 60000, // 60s timeout for compilation
      stdio: "pipe",
    });

    // Check for spawn/execution errors
    if (result.error) {
      const errorMessage = `Failed to execute arduino-cli: ${result.error.message}. Make sure arduino-cli is installed and in PATH.`;
      logger.error(errorMessage);
      return {
        success: false,
        output: "",
        errors: errorMessage,
        parsedErrors: [{
          file: "system",
          line: 0,
          column: 0,
          type: "error",
          message: errorMessage,
        }],
      };
    }

    const output = result.stdout || "";
    const errors = result.stderr || "";
    const code = result.code;

    if (code === 0) {
      const parsedOutput = parseCompilerOutput(output);
      const binary = await discoverBuildBinary(config.buildPath || sketchDir);
      return {
        success: true,
        output: parsedOutput,
        errors: "",
        parsedErrors: [],
        binary,
      };
    } else {
      const cleanedErrors = cleanErrorMessage(errors, sketchFile);
      const parsedErrors = parseCompilerDiagnostics(cleanedErrors, 0);
      return {
        success: false,
        output: "",
        errors: cleanedErrors,
        parsedErrors,
      };
    }
  } catch (error) {
    const errorMessage = `Failed to execute arduino-cli: ${error instanceof Error ? error.message : String(error)}. Make sure arduino-cli is installed and in PATH.`;
    logger.error(errorMessage);
    return {
      success: false,
      output: "",
      errors: errorMessage,
      parsedErrors: [{
        file: "system",
        line: 0,
        column: 0,
        type: "error",
        message: errorMessage,
      }],
    };
  }
}

/**
 * Cleans error messages by removing sketch directory paths.
 */
function cleanErrorMessage(errors: string, sketchDir: string): string {
  let cleanedErrors = errors;
  if (sketchDir) {
    cleanedErrors = cleanedErrors.replaceAll(sketchDir, "sketch.ino");
  }
  return cleanedErrors;
}

/**
 * Reads the HEX artifact emitted by arduino-cli from the build output directory.
 */
async function discoverBuildBinary(buildOutputDir: string): Promise<Buffer | undefined> {
  try {
    const hexCandidates = (await readdir(buildOutputDir))
      .filter((entry) => entry.endsWith(".hex"))
      .sort((a, b) => a.localeCompare(b));
    const preferred = hexCandidates.find((entry) => !entry.includes("with_bootloader")) || hexCandidates[0];
    if (preferred) {
      return await readFile(join(buildOutputDir, preferred));
    }
  } catch (error) {
    logger.debug(`[CompileCache] failed to read build hex output: ${error instanceof Error ? error.message : String(error)}`);
  }
  return undefined;
}

/**
 * Parses arduino-cli output to extract memory usage and format it.
 */
function parseCompilerOutput(output: string): string {
  const progSizeRegex = /(Sketch uses[^\n]*\.|Der Sketch verwendet[^\n]*\.)/;
  const ramSizeRegex = /(Global variables use[^\n]*\.|Globale Variablen verwenden[^\n]*\.)/;

  const progSizeMatch = progSizeRegex.exec(output);
  const ramSizeMatch = ramSizeRegex.exec(output);

  if (progSizeMatch && ramSizeMatch) {
    return `${progSizeMatch[0]}\n${ramSizeMatch[0]}\n\nBoard: Arduino UNO`;
  } else if (progSizeMatch || ramSizeMatch) {
    // Partial memory info
    const parts = [];
    if (progSizeMatch) parts.push(progSizeMatch[0]);
    if (ramSizeMatch) parts.push(ramSizeMatch[0]);
    return `${parts.join("\n")}\n\nBoard: Arduino UNO`;
  } else {
    // No memory info - check if there's any success output
    const trimmed = output.trim();
    if (trimmed) {
      // If output looks like a generic success message, use (Simulation) suffix
      if (trimmed.toLowerCase().includes("success") || trimmed.toLowerCase().includes("done")) {
        return `${trimmed}\n\nBoard: Arduino UNO (Simulation)`;
      }
      return `${trimmed}\n\nBoard: Arduino UNO`;
    }
    return `Board: Arduino UNO (Simulation)`;
  }
}
