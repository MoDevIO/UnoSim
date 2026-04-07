//arduino-compiler.ts

import { writeFile, mkdir, rm, readFile, readdir, stat, utimes, rename, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Logger } from "@shared/logger";
import { ParserMessage, IOPinRecord } from "@shared/schema";
import { CodeParser } from "@shared/code-parser";
import { detectSketchEntrypoints } from "@shared/utils/sketch-validation";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import { reservedNamesValidator } from "@shared/reserved-names-validator";
import { getCompileGatekeeper } from "./compile-gatekeeper";
import { ProcessExecutor } from "./process-executor";
import { CompilationError, CompilerOutputParser } from "./compiler/compiler-output-parser";
// Removed unused mock imports to satisfy TypeScript

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
  private readonly gatekeeper = getCompileGatekeeper();
  private readonly processExecutor = new ProcessExecutor();
  private readonly defaultFqbn = process.env.ARDUINO_FQBN || "arduino:avr:uno";
  private readonly defaultBuildCacheDir =
    process.env.ARDUINO_CACHE_DIR ||
    process.env.BUILD_CACHE_DIR ||
    join(process.cwd(), "server", "arduino-cache");
  private readonly defaultBinaryStorageDir = join(this.defaultBuildCacheDir, "binaries");
  private readonly defaultHexCacheDir = join(this.defaultBuildCacheDir, "hex-cache");
  private readonly defaultBuildCachePath = join(this.defaultBuildCacheDir, "build-cache");

  /**
   * Robust cleanup function that handles file locking on Windows/Unix.
   * Uses rename-before-delete to work around EPERM and EBUSY errors.
   */
  private async robustCleanupDir(dirPath: string): Promise<void> {
    const maxRetries = 3;
    const retryDelayMs = 100;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fast path: try direct deletion first
        await rm(dirPath, { recursive: true, force: true });
        this.logger.debug(`Successfully deleted ${dirPath}`);
        return;
      } catch (directError) {
        this.logger.debug(
          `Direct delete failed (attempt ${attempt + 1}/${maxRetries}): ${directError}`,
        );

        // If not the last attempt, try the rename-trick
        if (attempt < maxRetries - 1) {
          try {
            // Rename to a trash path to work around file locks
            const trashPath = `${dirPath}.trash.${randomUUID()}`;
            this.logger.debug(
              `Attempting rename-before-delete: ${dirPath} -> ${trashPath}`,
            );
            await rename(dirPath, trashPath);

            // Try to delete the trash path in the background (non-blocking)
            rm(trashPath, { recursive: true, force: true }).catch((trashError) => {
              this.logger.warn(
                `Failed to delete trash directory ${trashPath}: ${trashError}`,
              );
              // This is non-critical; we got the original dir out of the way
            });
            return;
          } catch (renameError) {
            this.logger.debug(`Rename-trick failed: ${renameError}`);
            // Fall through to next retry or throw
          }
        }
      }

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    // Last resort: log a warning but don't throw
    // The OS will clean up temp directories eventually
    this.logger.warn(
      `Failed to clean up ${dirPath} after ${maxRetries} attempts. It will be cleaned up by the OS.`,
    );
  }

  static async create(): Promise<ArduinoCompiler> {
    const instance = new ArduinoCompiler();
    await instance.ensureTempDir();
    return instance;
  }

  private async ensureTempDir() {
    try {
      await mkdir(this.tempDir, { recursive: true });
      await mkdir(this.defaultHexCacheDir, { recursive: true });
      await mkdir(this.defaultBuildCachePath, { recursive: true });
      await mkdir(this.defaultBinaryStorageDir, { recursive: true });
    } catch (error) {
      this.logger.warn(
        `Failed to create temp directory: ${error instanceof Error ? error.message : error}`,
      );
    }
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

  private async readBinaryFromStorage(sketchHash: string): Promise<Buffer | null> {
    const hexPath = join(this.defaultBinaryStorageDir, `${sketchHash}.hex`);
    const elfPath = join(this.defaultBinaryStorageDir, `${sketchHash}.elf`);
    for (const path of [hexPath, elfPath]) {
      try {
        const binary = await readFile(path);
        const now = new Date();
        await utimes(path, now, now).catch(() => undefined);
        return binary;
      } catch {
        // continue probing next extension
      }
    }
    return null;
  }

  private async writeBinaryToStorage(sketchHash: string, binary: Buffer): Promise<void> {
    const targetPath = join(this.defaultBinaryStorageDir, `${sketchHash}.hex`);
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(this.defaultBinaryStorageDir, { recursive: true });
    await writeFile(tmpPath, binary);
    await rename(tmpPath, targetPath);
  }

  private async _writeOutputToCache(storageDir: string, sketchHash: string, output: string): Promise<void> {
    const outputPath = join(storageDir, `${sketchHash}.output.txt`);
    await writeFile(outputPath, output, "utf8");
  }

  private async _readOutputFromCache(storageDir: string, sketchHash: string): Promise<string | null> {
    const outputPath = join(storageDir, `${sketchHash}.output.txt`);
    try {
      return await readFile(outputPath, "utf8");
    } catch {
      return null;
    }
  }

  private async readHexFromCache(
    sketchHash: string,
    hexCacheDir: string,
  ): Promise<Buffer | null> {
    const cachePath = join(hexCacheDir, `${sketchHash}.hex`);
    try {
      const binary = await readFile(cachePath);
      const now = new Date();
      await utimes(cachePath, now, now).catch(() => undefined);
      return binary;
    } catch {
      return null;
    }
  }

  private async writeHexToCache(
    sketchHash: string,
    hexCacheDir: string,
    binary: Buffer,
  ): Promise<void> {
    const cachePath = join(hexCacheDir, `${sketchHash}.hex`);
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(hexCacheDir, { recursive: true });
    await writeFile(tmpPath, binary);
    await rename(tmpPath, cachePath);
  }

  private async runHexCacheCleanup(hexCacheDir: string, maxBytes: number = 512 * 1024 * 1024): Promise<void> {
    try {
      const entries = await readdir(hexCacheDir);
      const files: Array<{ path: string; size: number; atimeMs: number }> = [];
      let totalSize = 0;

      for (const entry of entries) {
        if (!entry.endsWith(".hex")) continue;
        const fullPath = join(hexCacheDir, entry);
        try {
          const fileStat = await stat(fullPath);
          if (!fileStat.isFile()) continue;
          totalSize += fileStat.size;
          files.push({
            path: fullPath,
            size: fileStat.size,
            atimeMs: fileStat.atimeMs || fileStat.mtimeMs,
          });
        } catch {
          // ignore disappearing files
        }
      }

      if (totalSize <= maxBytes) return;

      files.sort((a, b) => a.atimeMs - b.atimeMs);
      for (const file of files) {
        if (totalSize <= maxBytes) break;
        await rm(file.path, { force: true });
        totalSize -= file.size;
      }
    } catch (error) {
      this.logger.debug(`[CacheCleanup] skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  /**
   * Checks both the instant binary cache and hex cache for a compiled sketch.
   * Returns the first available cached binary, or null if no cache hit.
   */
  private async checkCacheHits(
    sketchHash: string,
    hexCacheDir: string,
    compileStartedAt: bigint,
  ): Promise<{ cached: boolean; binary: Buffer | null; cacheType: string; cachedOutput: string | null }> {
    // Check instant binary cache first (most recent)
    const instantBinary = await this.readBinaryFromStorage(sketchHash);
    if (instantBinary) {
      const elapsedMs = Number((process.hrtime.bigint() - compileStartedAt) / BigInt(1_000_000));
      this.logger.info(`[Cache] Hit for hash ${sketchHash} (${elapsedMs}ms)`);
      const cachedOutput = await this._readOutputFromCache(this.defaultBinaryStorageDir, sketchHash);
      return { cached: true, binary: instantBinary, cacheType: "instant", cachedOutput };
    }

    // Check hex cache (persistent, shared across sessions)
    const cachedBinary = await this.readHexFromCache(sketchHash, hexCacheDir);
    if (cachedBinary) {
      const elapsedMs = Number((process.hrtime.bigint() - compileStartedAt) / BigInt(1_000_000));
      this.logger.info(`[Cache] Hit for hash ${sketchHash} (${elapsedMs}ms)`);
      const cachedOutput = await this._readOutputFromCache(hexCacheDir, sketchHash);
      return { cached: true, binary: cachedBinary, cacheType: "hex", cachedOutput };
    }

    return { cached: false, binary: null, cacheType: "none", cachedOutput: null };
  }

  /**
   * Processes header includes by replacing #include statements with actual header content.
   * Tracks line offset for later error correction.
   * Returns { processedCode, lineOffset }.
   */
  private async processHeaderIncludes(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    sketchDir?: string,
  ): Promise<{ processedCode: string; lineOffset: number }> {
    let processedCode = code;
    let lineOffset = 0;

    if (!headers || headers.length === 0) {
      return { processedCode, lineOffset };
    }

    this.logger.debug(`Processing ${headers.length} header includes`);

    for (const header of headers) {
      // Try to find includes with both the full name (header_1.h) and without extension (header_1)
      const headerWithoutExt = header.name.replace(/\.[^/.]+$/, "");

      // Search for both variants: #include "header_1.h" and #include "header_1"
      const includeVariants = [`#include "${header.name}"`, `#include "${headerWithoutExt}"`];

      let found = false;
      for (const includeStatement of includeVariants) {
        if (processedCode.includes(includeStatement)) {
          this.logger.debug(`Found include for: ${header.name} (pattern: ${includeStatement})`);
          
          // Replace the #include with the actual header content
          const replacement = `// --- Start of ${header.name} ---\n${header.content}\n// --- End of ${header.name} ---`;
          const escapedInclude = includeStatement.split('"')[1].replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
          const patternString = String.raw`#include\s*"${escapedInclude}"`;
          processedCode = processedCode.replaceAll(
            new RegExp(patternString, "g"),
            replacement,
          );

          // Calculate line offset by counting newlines in replacement
          const newlinesInReplacement = (replacement.match(/\n/g) || []).length;
          lineOffset += newlinesInReplacement;

          found = true;
          this.logger.debug(`Replaced include for: ${header.name}, line offset now: ${lineOffset}`);
          break;
        }
      }

      if (!found) {
        this.logger.debug(
          `Include not found for: ${header.name} (tried: ${includeVariants.join(", ")})`,
        );
      }
    }

    // Write header files to disk as separate files
    if (sketchDir) {
      this.logger.debug(`Writing ${headers.length} header files to ${sketchDir}`);
      for (const header of headers) {
        const headerPath = join(sketchDir, header.name);
        this.logger.debug(`Writing header: ${headerPath}`);
        await writeFile(headerPath, header.content);
      }
    }

    return { processedCode, lineOffset };
  }

  /**
   * Handles successful compilation: writes caches and formats output.
   */
  private async handleCompilationSuccess(
    sketchHash: string,
    hexCacheDir: string,
    cliResult: {
      success: boolean;
      output?: string;
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
      await this.writeHexToCache(sketchHash, hexCacheDir, cliResult.binary).catch((error) => {
        this.logger.debug(
          `[CompileCache] failed to write HEX cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      await this.writeBinaryToStorage(sketchHash, cliResult.binary).catch((error) => {
        this.logger.debug(
          `[CompileCache] failed to write binary storage cache: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      // Store the formatted output alongside both cache locations so cache hits
      // can reproduce the full compiler output (sketch size, RAM usage, etc.)
      if (cliOutput) {
        await this._writeOutputToCache(hexCacheDir, sketchHash, cliOutput).catch(() => undefined);
        await this._writeOutputToCache(this.defaultBinaryStorageDir, sketchHash, cliOutput).catch(() => undefined);
      }
      await this.runHexCacheCleanup(hexCacheDir);
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
      output?: string;
      errors?: string;
      parsedErrors?: CompilationError[];
      binary?: Buffer;
    },
  ): { cliOutput: string; cliErrors: string; parsedErrors: CompilationError[] } {
    const cliOutput = "";
    let cleanedErrors = cliErrors;
    let parsedErrors = cliResult.parsedErrors || [];

    // Correct stderr text for offset so UI shows original line numbers
    if (lineOffset > 0 && cleanedErrors) {
      cleanedErrors = cleanedErrors.replaceAll(/sketch\.ino:(\d+):/g, (_m, n) => {
        const corrected = Math.max(1, Number.parseInt(n, 10) - lineOffset);
        return `sketch.ino:${corrected}:`;
      });
    }

    // Backstop: if the caller didn't supply parsedErrors, run parser ourselves
    if (parsedErrors.length === 0 && cleanedErrors) {
      parsedErrors = this.parseCompilerErrors(cleanedErrors, lineOffset);
    }

    return { cliOutput, cliErrors: cleanedErrors, parsedErrors };
  }

  async compile(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
    options?: CompileRequestOptions,
  ): Promise<CompilationResult> {
    // GATEKEEPER: Acquire a compile slot to prevent race conditions
    const release = await this.gatekeeper.acquire();

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

    const sketchDir = join(baseTempDir, sketchId);
    const sketchFile = join(sketchDir, `${sketchId}.ino`);

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
      const cacheResult = await this.checkCacheHits(sketchHash, hexCacheDir, compileStartedAt);
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

      const { processedCode, lineOffset } = await this.processHeaderIncludes(
        code,
        headers,
        sketchDir,
      );
      await writeFile(sketchFile, processedCode);

      // 4. Run Arduino CLI compilation
      const cliResult = await this.compileWithArduinoCli(sketchFile, {
        fqbn: options?.fqbn || this.defaultFqbn,
        buildPath: options?.buildPath,
        buildCachePath: options?.buildCachePath || this.defaultBuildCachePath,
      });

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

  /** Remove sketch-specific temporary directories created during compilation. */
  private async _cleanupSketchDirs(
    sketchDir: string,
    baseTempDir: string,
    tempRoot?: string,
  ): Promise<void> {
    try {
      await this.robustCleanupDir(sketchDir);
    } catch (error) {
      this.logger.warn(`Failed to clean up sketch directory: ${error}`);
    }
    if (!tempRoot) {
      try {
        await this.robustCleanupDir(baseTempDir);
      } catch (error) {
        this.logger.warn(`Failed to remove base temp directory: ${error}`);
      }
    }
  }

  // Parses stderr text into structured error objects.
  // lineOffset can be provided to adjust line numbers when headers were
  // inlined; callers should pass the same offset that was used during
  // header embedding so that the final error objects refer to the original
  // sketch lines.  This parameter is _used_ below to mutate parsed line
  // numbers, satisfying the TypeScript checker.
  private parseCompilerErrors(stderr: string, lineOffset: number = 0): CompilationError[] {
    return CompilerOutputParser.parseErrors(stderr, lineOffset);
  }

  private async compileWithArduinoCli(
    sketchFile: string,
    config: {
      fqbn: string;
      buildPath?: string;
      buildCachePath?: string;
    },
  ): Promise<{
    success: boolean;
    output: string;
    errors?: string;
    parsedErrors?: CompilationError[];
    binary?: Buffer;
  }> {
    // Arduino CLI expects the sketch DIRECTORY, not the file
    const sketchDir = sketchFile.slice(0, Math.max(0, sketchFile.lastIndexOf("/")));
    const args = this._buildCompileArgs(config, sketchDir);

    this.logger.info(`Executing arduino-cli ${args.join(" ")}`);

    try {
      const result = await this.processExecutor.execute("arduino-cli", args, {
        timeout: 60000, // 60s timeout for compilation
        stdio: "pipe",
      });

      // Check for spawn/execution errors
      if (result.error) {
        const errorMessage = `Failed to execute arduino-cli: ${result.error.message}. Make sure arduino-cli is installed and in PATH.`;
        this.logger.error(errorMessage);
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
        return await this._handleSuccessfulCompile(output, config, sketchDir);
      } else {
        return this._handleFailedCompile(errors, sketchFile);
      }
    } catch (error) {
      const errorMessage = `Failed to execute arduino-cli: ${error instanceof Error ? error.message : String(error)}. Make sure arduino-cli is installed and in PATH.`;
      this.logger.error(errorMessage);
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

  private _buildCompileArgs(
    config: {
      fqbn: string;
      buildPath?: string;
      buildCachePath?: string;
    },
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
    if (config.buildCachePath) {
      args.push("--build-cache-path", config.buildCachePath);
    }
    args.push(sketchDir);
    return args;
  }

  private async _handleSuccessfulCompile(
    output: string,
    config: { buildPath?: string },
    sketchDir: string,
  ): Promise<{
    success: boolean;
    output: string;
    errors?: string;
    parsedErrors?: CompilationError[];
    binary?: Buffer;
  }> {
    const progSizeRegex = /(Sketch uses[^\n]*\.|Der Sketch verwendet[^\n]*\.)/;
    const ramSizeRegex = /(Global variables use[^\n]*\.|Globale Variablen verwenden[^\n]*\.)/;

    const progSizeMatch = progSizeRegex.exec(output);
    const ramSizeMatch = ramSizeRegex.exec(output);

    let parsedOutput = "";
    if (progSizeMatch && ramSizeMatch) {
      parsedOutput = `${progSizeMatch[0]}\n${ramSizeMatch[0]}\n\nBoard: Arduino UNO`;
    } else {
      parsedOutput = `Board: Arduino UNO (Simulation)`;
    }

    const buildOutputDir = config.buildPath || sketchDir;
    const binary = await this._discoverBuildBinary(buildOutputDir);

    return {
      success: true,
      output: parsedOutput,
      binary,
    };
  }

  private async _discoverBuildBinary(buildOutputDir: string): Promise<Buffer | undefined> {
    try {
      const hexCandidates = (await readdir(buildOutputDir))
        .filter((entry) => entry.endsWith(".hex"))
        .sort((a, b) => a.localeCompare(b));
      const preferred = hexCandidates.find((entry) => !entry.includes("with_bootloader")) || hexCandidates[0];
      if (preferred) {
        return await readFile(join(buildOutputDir, preferred));
      }
    } catch (error) {
      this.logger.debug(`[CompileCache] failed to read build hex output: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }

  private _handleFailedCompile(
    errors: string,
    sketchFile: string,
  ): {
    success: boolean;
    output: string;
    errors: string;
    parsedErrors: CompilationError[];
    binary?: Buffer;
  } {
    this.logger.error(`arduino-cli compilation failed`);
    this.logger.error(`Full stderr output:\n${errors}`);

    const cleanedErrors = this._cleanCompilerErrors(errors, sketchFile);
    const structured = this.parseCompilerErrors(cleanedErrors || "");
    return {
      success: false,
      output: "",
      errors: cleanedErrors || "Compilation failed",
      parsedErrors: structured,
    };
  }

  private _cleanCompilerErrors(errors: string, sketchFile: string): string {
    const escapedPath = sketchFile.replaceAll(/[-/\\^$*+?.()|[\]{}]/g, String.raw`\$&`);
    return errors
      .replaceAll(new RegExp(escapedPath, "g"), "sketch.ino")
      .replaceAll(/\/[^\s:/]+\/temp\/[a-f0-9-]+\/[a-f0-9-]+\.ino/gi, "sketch.ino")
      .replaceAll(/Error during build: exit status \d+\s*/g, "")
      .trim();
  }
}

// singleton instance removed, not used anywhere
