//arduino-compiler.ts

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Logger } from "@shared/logger";
import { ParserMessage, IOPinRecord } from "@shared/schema";
import { CodeParser } from "@shared/code-parser";
import { detectSketchEntrypoints } from "@shared/utils/sketch-validation";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import { reservedNamesValidator } from "@shared/reserved-names-validator";
import { getUnifiedGatekeeper, TaskPriority } from "./unified-gatekeeper";
import { ProcessExecutor } from "./process-executor";
import { type CompilationError } from "./compiler/compiler-output-parser";
import { config } from "../config";
import { resolvePathWithinRoot } from "../security/safe-paths";
import {
  ensureTempDirs,
  cleanupSketchDirs,
} from "./compiler/temp-fs";
import {
  writeBinaryToStorage,
  writeOutputToCache,
  writeHexToCache,
  runHexCacheCleanup,
  checkCacheHits,
} from "./compiler/cache-manager";
import { processHeaderIncludes } from "./compiler/header-processor";
import { compileWithArduinoCli, type CLICompileConfig } from "./compiler/cli-runner";

// Re-export for backwards compatibility
export type { CompilationError } from "./compiler/compiler-output-parser";

export interface CompilationResult {
  success: boolean;
  output: string;
  // raw stderr text for backwards compatibility and debugging
  stderr?: string;
  // structured list of errors/warnings from the compiler
  errors: CompilationError[];
  binary?: Buffer;
  arduinoCliStatus: "idle" | "compiling" | "success" | "error";
  // gccStatus removed – it was deprecated and is no longer populated
  parserMessages?: ParserMessage[]; // Parser validation messages
  ioRegistry?: IOPinRecord[]; // I/O Registry for visualization
}

export interface CompileRequestOptions {
  fqbn?: string;
  libraries?: string[];
  sketchHash?: string;
  coreFingerprint?: string;
  buildPath?: string;
  buildCachePath?: string;
  hexCacheDir?: string;
}

export class ArduinoCompiler {
  private readonly tempDir = join(process.cwd(), "temp");
  private readonly logger = new Logger("ArduinoCompiler");
  private readonly processExecutor = new ProcessExecutor();
  private readonly defaultFqbn = config.compilation.fqbn;
  private readonly defaultBuildCacheDir = config.compilation.cacheDir;
  // Hex and binary outputs use the shared storage dir (storage/cache) so that
  // both worker-pool compiles and direct-compiler compiles share the same cache.
  private readonly defaultBinaryStorageDir = join(config.compilation.buildCacheDir, "binaries");
  private readonly defaultHexCacheDir = join(config.compilation.buildCacheDir, "hex-cache");
  private readonly defaultBuildCachePath = join(this.defaultBuildCacheDir, "build-cache");

  static async create(): Promise<ArduinoCompiler> {
    const instance = new ArduinoCompiler();
    ensureTempDirs({
      tempDir: instance.tempDir,
      hexCacheDir: instance.defaultHexCacheDir,
      buildCachePath: instance.defaultBuildCachePath,
      binaryStorageDir: instance.defaultBinaryStorageDir,
    });
    return instance;
  }

  private buildSketchHash(
    code: string,
    options?: CompileRequestOptions,
  ): string {
    if (options?.sketchHash) {
      return options.sketchHash;
    }

    const payload = JSON.stringify({
      code,
      fqbn: options?.fqbn || this.defaultFqbn,
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Validates that the sketch contains required entry points (setup and loop).
   * Returns { hasSetup, hasLoop } and error message if validation fails.
   */
  private validateSketchEntrypoints(code: string): {
    valid: boolean;
    hasSetup: boolean;
    hasLoop: boolean;
    errorMessage?: string;
  } {
    const { hasSetup, hasLoop } = detectSketchEntrypoints(code);

    if (!hasSetup || !hasLoop) {
      const missingFunctions = [];
      if (!hasSetup) missingFunctions.push("setup()");
      if (!hasLoop) missingFunctions.push("loop()");

      return {
        valid: false,
        hasSetup,
        hasLoop,
        errorMessage: `Missing Arduino functions: ${missingFunctions.join(" and ")}\n\nArduino sketches require:\n- void setup() { }\n- void loop() { }`,
      };
    }

    return { valid: true, hasSetup, hasLoop };
  }









  async compile(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
    options?: CompileRequestOptions,
  ): Promise<CompilationResult> {
    // GATEKEEPER: Acquire a compile slot to prevent race conditions
    const release = await getUnifiedGatekeeper().acquireCompileSlot(
      TaskPriority.NORMAL,
      30000,
      "arduino-compiler",
    );

    try {
      return await this.compileInternal(code, headers, tempRoot, options);
    } finally {
      release();
    }
  }

  /**
   * Internal compile implementation (wrapped by compile with gatekeeper)
   * Orchestrates compilation by delegating to helper functions for clarity.
   */
  private async compileInternal(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
    options?: CompileRequestOptions,
  ): Promise<CompilationResult> {
    const sketchId = randomUUID();

    // Ensure provided tempRoot exists (important for Worker pool and deterministic tests)
    if (tempRoot) {
      await mkdir(tempRoot, { recursive: true }).catch(() => {});
    }

    // use a unique temporary directory per-call to avoid state conflicts
    const baseTempDir =
      tempRoot || (await mkdtemp(join(getFastTmpBaseDir(), "unosim-")));

    const sketchDir = resolvePathWithinRoot(baseTempDir, sketchId);
    const sketchFile = resolvePathWithinRoot(sketchDir, `${sketchId}.ino`);

    // Pre-compilation validation and parsing
    const parser = new CodeParser();
    const parserMessages = parser.parseAll(code);
    const reservedNameMessages = reservedNamesValidator.validateReservedNames(code);
    const allParserMessages = [...parserMessages, ...reservedNameMessages];
    const ioRegistry: IOPinRecord[] = [];
    const sketchHash = this.buildSketchHash(code, options);
    const hexCacheDir = options?.hexCacheDir || this.defaultHexCacheDir;
    const compileStartedAt = process.hrtime.bigint();

    try {
      // 1. Validate sketch has required entry points
      const validation = this.validateSketchEntrypoints(code);
      if (!validation.valid) {
        return {
          success: false,
          output: "",
          stderr: validation.errorMessage,
          errors: [],
          arduinoCliStatus: "error",
          parserMessages: allParserMessages,
          ioRegistry,
        };
      }

      // 2. Check both instant and hex caches.
      // Only use the cache when the output sidecar (.output.txt) also exists so
      // the full "Sketch uses X bytes … Board: Arduino UNO" message is returned.
      // If cachedOutput is null (e.g. old cache entry written before the sidecar
      // was introduced) we fall through to a fresh compile so the sidecar gets
      // written and the user always sees the complete output.
      const cacheResult = await checkCacheHits(sketchHash, {
        binaryStorageDir: this.defaultBinaryStorageDir,
        hexCacheDir,
      }, compileStartedAt);
      if (cacheResult.cached && cacheResult.binary && cacheResult.cachedOutput !== null) {
        return {
          success: true,
          output: cacheResult.cachedOutput,
          stderr: undefined,
          errors: [],
          binary: cacheResult.binary,
          arduinoCliStatus: "success",
          parserMessages: allParserMessages,
          ioRegistry,
        };
      }

      // 3. Create directories and process headers
      await mkdir(sketchDir, { recursive: true });
      if (options?.buildPath) {
        await mkdir(options.buildPath, { recursive: true }).catch(() => {});
      }
      if (options?.buildCachePath) {
        await mkdir(options.buildCachePath, { recursive: true }).catch(() => {});
      }

      const { processedCode, lineOffset } = await processHeaderIncludes(
        code,
        headers,
        sketchDir,
      );
      await writeFile(sketchFile, processedCode);

      // 4. Run Arduino CLI compilation
      const cliConfig: CLICompileConfig = {
        fqbn: options?.fqbn || this.defaultFqbn,
        buildPath: options?.buildPath,
        buildCachePath: options?.buildCachePath || this.defaultBuildCachePath,
      };
      const cliResult = await compileWithArduinoCli(sketchFile, cliConfig, this.processExecutor);

      // 5. Handle result (success or error)
      let cliOutput = "";
      let cliErrors = "";
      let parsedErrors: CompilationError[] = [];
      let arduinoCliStatus: "success" | "error" = "error";

      if (cliResult.success) {
        arduinoCliStatus = "success";
        const successResult = await this.handleCompilationSuccess(
          sketchHash,
          hexCacheDir,
          cliResult,
        );
        cliOutput = successResult.cliOutput;
        cliErrors = successResult.cliErrors;
        parsedErrors = successResult.parsedErrors;
      } else {
        const errorResult = this.handleCompilationError(
          cliResult.errors || "Compilation failed",
          lineOffset,
          cliResult,
        );
        cliOutput = errorResult.cliOutput;
        cliErrors = errorResult.cliErrors;
        parsedErrors = errorResult.parsedErrors;
      }

      return {
        success: cliResult.success,
        output: cliOutput,
        stderr: cliErrors || undefined,
        errors: parsedErrors,
        binary: cliResult.binary,
        arduinoCliStatus,
        parserMessages: allParserMessages,
        ioRegistry,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        stderr: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        errors: [],
        arduinoCliStatus: "error",
        parserMessages: allParserMessages,
        ioRegistry,
      };
    } finally {
      await this._cleanupSketchDirs(sketchDir, baseTempDir, tempRoot);
    }
  }



  /**
   * Handles successful compilation: writes caches and formats output.
   */
  private async handleCompilationSuccess(
    sketchHash: string,
    hexCacheDir: string,
    cliResult: {
      success: boolean;
      output: string;
      errors?: string;
      parsedErrors?: CompilationError[];
      binary?: Buffer;
    },
  ): Promise<{ cliOutput: string; cliErrors: string; parsedErrors: CompilationError[] }> {
    const cliOutput = cliResult.output || "";
    let cliErrors = cliResult.errors || "";
    const parsedErrors = cliResult.parsedErrors || [];

    if (cliResult.binary) {
      // Write to both instant cache and persistent hex cache
      await writeHexToCache(sketchHash, hexCacheDir, cliResult.binary).catch((error) => {
        this.logger.debug(
          `[CompileCache] failed to write HEX cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      await writeBinaryToStorage(sketchHash, cliResult.binary, this.defaultBinaryStorageDir).catch((error) => {
        this.logger.debug(
          `[CompileCache] failed to write binary storage cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      // Store the formatted output alongside both cache locations so cache hits
      // can reproduce the full compiler output (sketch size, RAM usage, etc.)
      if (cliOutput) {
        await writeOutputToCache(hexCacheDir, sketchHash, cliOutput).catch(() => undefined);
        await writeOutputToCache(this.defaultBinaryStorageDir, sketchHash, cliOutput).catch(() => undefined);
      }
      await runHexCacheCleanup(hexCacheDir);
    }

    return { cliOutput, cliErrors, parsedErrors };
  }

  /**
   * Handles compilation errors: cleans error messages and parses them into structured errors.
   */
  private handleCompilationError(
    cliErrors: string,
    lineOffset: number,
    cliResult: {
      success: boolean;
      output: string;
      errors?: string;
      parsedErrors?: CompilationError[];
      binary?: Buffer;
    },
  ): { cliOutput: string; cliErrors: string; parsedErrors: CompilationError[] } {
    const cliOutput = "";
    let cleanedErrors = cliErrors;
    const parsedErrors = cliResult.parsedErrors || [];

    // Correct stderr text for offset so UI shows original line numbers
    if (lineOffset > 0 && cleanedErrors) {
      cleanedErrors = cleanedErrors.replaceAll(/sketch\.ino:(\d+):/g, (_m, n) => {
        const corrected = Math.max(1, Number.parseInt(n, 10) - lineOffset);
        return `sketch.ino:${corrected}:`;
      });
    }

    return { cliOutput, cliErrors: cleanedErrors, parsedErrors };
  }

  /** Remove sketch-specific temporary directories created during compilation. */
  private async _cleanupSketchDirs(
    sketchDir: string,
    baseTempDir: string,
    tempRoot?: string,
  ): Promise<void> {
    await cleanupSketchDirs(sketchDir, baseTempDir, tempRoot);
  }
}

// singleton instance removed, not used anywhere
