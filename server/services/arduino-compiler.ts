//arduino-compiler.ts

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Logger } from "@shared/logger";
import { ParserMessage, IOPinRecord } from "@shared/schema";
import { CodeParser } from "@shared/code-parser";
import type { SourceProject } from "@shared/source-project";
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
  robustCleanupDir,
} from "./compiler/temp-fs";
import {
  writeBinaryToStorage,
  writeOutputToCache,
  writeHexToCache,
  runHexCacheCleanup,
  checkCacheHits,
} from "./compiler/cache-manager";
import { processHeaderIncludes } from "./compiler/header-processor";
import { findUnsafeIncludes } from "./compiler/include-guard";
import { FIXED_BUILD_FLAGS, type CLICompileConfig, type CLICompileResult } from "./compiler/cli-runner";
import { arduinoToolchain } from "./compiler/toolchain";
import { buildSketchHash } from "./workers/compile-worker-utils";
import { type BoardId, findBoardByFqbn } from "@shared/boards";
import type { SimulationArtifact } from "@shared/simulation-artifact";
import { type BuildRecord, buildArtifact, readBuildRecord, writeBuildRecord } from "./compiler/artifact-builder";
import { type BuildIdentity, createBuildIdentity } from "./compiler/build-identity";
import { readToolchainInfo } from "./compiler/toolchain-info";

// Re-export for backwards compatibility
export type { CompilationError } from "./compiler/compiler-output-parser";

function buildCompileSourceProject(
  code: string,
  headers: Array<{ name: string; content: string }> = [],
  entryFile = "sketch.ino",
): SourceProject {
  const files: Record<string, string> = { [entryFile]: code };
  for (const header of headers) files[header.name] = header.content;
  return { entryFile, files };
}

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
  /** Flash image of a successful build for a catalog board (plan E5); the route decides whether it is delivered. */
  artifact?: SimulationArtifact;
}

export interface CompileRequestOptions {
  entryFile?: string;
  /** Catalog board the request compiles for; `fqbn` then is its FQBN. */
  board?: BoardId;
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
  /** Backend or compile sandbox, by profile (plan P2.4). */
  private readonly toolchain = arduinoToolchain();
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

  /** Same identity as the compile worker, so both paths share cache entries and headers count. */
  private buildSketchHash(
    code: string,
    headers: Array<{ name: string; content: string }> | undefined,
    options?: CompileRequestOptions,
  ): string {
    return options?.sketchHash
      ?? buildSketchHash({ code, headers, entryFile: options?.entryFile }, options?.fqbn || this.defaultFqbn);
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
    // One build directory per compile, removed afterwards: the HEX lives on in the
    // caches. Without --build-path arduino-cli would keep a directory per (random)
    // sketch path in its own cache.
    const buildPath = options?.buildPath ?? resolvePathWithinRoot(baseTempDir, `${sketchId}-build`);

    // Pre-compilation validation and parsing
    const parser = new CodeParser(undefined, undefined, options?.board);
    const sourceProject = buildCompileSourceProject(code, headers, options?.entryFile);
    const parserMessages = parser.parseAllProject(sourceProject);
    const reservedNameMessages = reservedNamesValidator.validateReservedNames(code);
    const allParserMessages = [...parserMessages, ...reservedNameMessages];
    const ioRegistry: IOPinRecord[] = [];
    const sketchHash = this.buildSketchHash(code, headers, options);
    const hexCacheDir = options?.hexCacheDir || this.defaultHexCacheDir;
    const compileStartedAt = process.hrtime.bigint();

    try {
      // 0. An include must not make the preprocessor read and echo a file outside
      // the project. In the local profile arduino-cli runs in the backend; in the
      // compile sandbox this stays as an additional layer (plan 4.10).
      const unsafeIncludes = findUnsafeIncludes(sourceProject);
      if (unsafeIncludes.length > 0) {
        return {
          success: false,
          output: "",
          stderr: unsafeIncludes.map(({ file, line, message }) => `${file}:${line}: error: ${message}`).join("\n"),
          errors: unsafeIncludes.map(({ file, line, message }) => ({ file, line, column: 1, type: "error" as const, message })),
          arduinoCliStatus: "error",
          parserMessages: allParserMessages,
          ioRegistry,
        };
      }

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

      const { fqbn, board, identity } = await this.identityOf(sketchHash, options);

      // 2. Answer from the instant or HEX cache when an entry exists under the current identity.
      const cached = await this.lookupCachedBuild(sketchHash, hexCacheDir, compileStartedAt, identity);
      if (cached) {
        return {
          success: true,
          output: cached.output,
          stderr: undefined,
          errors: [],
          binary: cached.binary,
          ...(cached.artifact ? { artifact: cached.artifact } : {}),
          arduinoCliStatus: "success",
          parserMessages: allParserMessages,
          ioRegistry,
        };
      }

      // 3. Create directories and process headers
      await mkdir(sketchDir, { recursive: true });
      await mkdir(buildPath, { recursive: true }).catch(() => {});
      if (options?.buildCachePath) {
        await mkdir(options.buildCachePath, { recursive: true }).catch(() => {});
      }

      const { processedCode, lineOffset } = await processHeaderIncludes(
        code,
        headers,
        sketchDir,
        options?.entryFile,
      );
      await writeFile(sketchFile, processedCode);

      // 4. Run Arduino CLI compilation
      const cliConfig: CLICompileConfig = {
        fqbn,
        buildPath,
        buildCachePath: options?.buildCachePath || this.defaultBuildCachePath,
      };
      const cliResult = await this.toolchain.compile(sketchFile, cliConfig, this.processExecutor);

      // 5. Handle result (success or error)
      const settled = await this.settleCliResult(cliResult, { sketchHash, hexCacheDir, lineOffset, board, identity });

      return {
        success: cliResult.success,
        output: settled.cliOutput,
        stderr: settled.cliErrors || undefined,
        errors: settled.parsedErrors,
        binary: cliResult.binary,
        ...(settled.artifact ? { artifact: settled.artifact } : {}),
        arduinoCliStatus: cliResult.success ? "success" : "error",
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
      await robustCleanupDir(buildPath);
      await this._cleanupSketchDirs(sketchDir, baseTempDir, tempRoot);
    }
  }



  /** Turns the CLI result into output, errors and, on success, the cached build with its artifact. */
  private async settleCliResult(
    cliResult: CLICompileResult,
    context: { sketchHash: string; hexCacheDir: string; lineOffset: number; board?: BoardId; identity: BuildIdentity },
  ): Promise<{ cliOutput: string; cliErrors: string; parsedErrors: CompilationError[]; artifact?: SimulationArtifact }> {
    if (!cliResult.success) {
      return this.handleCompilationError(cliResult.errors || "Compilation failed", context.lineOffset, cliResult);
    }
    const { board, identity } = context;
    const artifact = board && cliResult.binary ? buildArtifact({ board, hex: cliResult.binary, elf: cliResult.elf, identity }) : undefined;
    const successResult = await this.handleCompilationSuccess(context.sketchHash, context.hexCacheDir, cliResult, { identity, ...(artifact ? { artifact } : {}) });
    return { ...successResult, ...(artifact ? { artifact } : {}) };
  }

  /** The board and the identity of this build (plan E15): what a cache entry must have been built under. */
  private async identityOf(sketchHash: string, options?: CompileRequestOptions): Promise<{ fqbn: string; board?: BoardId; identity: BuildIdentity }> {
    const fqbn = options?.fqbn || this.defaultFqbn;
    const identity = createBuildIdentity({
      sketchHash,
      fqbn,
      toolchain: await readToolchainInfo(),
      requestedLibraries: options?.libraries,
      buildOptions: FIXED_BUILD_FLAGS,
    });
    return { fqbn, board: options?.board ?? findBoardByFqbn(fqbn)?.id, identity };
  }

  /**
   * Checks both instant and hex caches. An entry is used only when the output
   * sidecar (.output.txt) exists too, so the full "Sketch uses X bytes … Board:
   * Arduino UNO" message is returned, and when its artifact sidecar was written
   * under the current identity: an older entry (no sidecar) or one built under
   * another toolchain, library set or build option is built again, which also
   * rewrites its sidecars.
   */
  private async lookupCachedBuild(
    sketchHash: string,
    hexCacheDir: string,
    compileStartedAt: bigint,
    identity: BuildIdentity,
  ): Promise<{ output: string; binary: Buffer; artifact?: SimulationArtifact } | undefined> {
    const hit = await checkCacheHits(sketchHash, { binaryStorageDir: this.defaultBinaryStorageDir, hexCacheDir }, compileStartedAt);
    if (!hit.cached || !hit.binary || hit.cachedOutput === null) return undefined;
    const record = await readBuildRecord(hit.cacheType === "instant" ? this.defaultBinaryStorageDir : hexCacheDir, sketchHash, identity);
    if (!record) return undefined;
    return { output: hit.cachedOutput, binary: hit.binary, ...(record.artifact ? { artifact: record.artifact } : {}) };
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
    buildRecord?: BuildRecord,
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
      if (buildRecord) {
        for (const dir of [hexCacheDir, this.defaultBinaryStorageDir]) {
          await writeBuildRecord(dir, sketchHash, buildRecord).catch((error) => {
            this.logger.debug(`[CompileCache] failed to write artifact sidecar: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      }
      await runHexCacheCleanup(hexCacheDir);
      await runHexCacheCleanup(this.defaultBinaryStorageDir);
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
    const cliOutput = cliResult.output || "";
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
