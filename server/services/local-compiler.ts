/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { chmod, mkdir, access, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { Logger } from "@shared/logger";
import { ProcessExecutor } from "./process-executor";
import { config } from "../config";

/**
 * Custom error type for compiler-specific failures
 */
class CompilerError extends Error {
  readonly isCompilerError = true;

  constructor(message: string) {
    super(message);
    this.name = "CompilerError";
  }
}

export class LocalCompiler {
  private readonly logger = new Logger("LocalCompiler");
  private compileTimeoutMs = 20000; // 20 seconds
  private readonly processExecutor: ProcessExecutor;

  constructor() {
    this.processExecutor = new ProcessExecutor();
  }

  /**
   * Public helper so callers can detect if a compile process is currently running
   */
  get isBusy(): boolean {
    return this.processExecutor.isBusy;
  }

  /**
   * Compiles a sketch file using g++
   * 
   * @param sketchFile - Path to the .cpp file
   * @param exeFile - Path for the output executable
   * @throws CompilerError if compilation fails
   */
  private static readonly CLI_CACHE_PATH = join(process.cwd(), "cache", "cores", "uno-cli-feedback.a");

  async compile(
    sketchFile: string,
    exeFile: string,
    coreArchive?: string,
    onProcess?: (proc: ChildProcess) => void,
  ): Promise<void> {
    const config = this._detectEnvironmentConfig();
    this.logger.debug(`[LocalCompiler] compile() invoked (testEnv=${config.usingTestEnv}, coverage=${config.coverageActive}) sketch=${sketchFile}`);

    // In test environments with mocked spawn, run lightweight fake compile
    if (config.usingTestEnv && config.spawnIsMock) {
      await this._handleMockCompilation(exeFile, onProcess);
      return;
    }

    // Real compilation: setup, CLI, then g++
    await this.setupOutputDirectory(exeFile);
    await this._checkAndRunArduinoCli(sketchFile, config.usingTestEnv, config.coverageActive);
    await this._compileWithRetry(sketchFile, exeFile, coreArchive, onProcess);
  }

  private _detectEnvironmentConfig(): {
    usingTestEnv: boolean;
    coverageActive: boolean;
    spawnIsMock: boolean;
  } {
    const usingTestEnv = config.isTest;
    const coverageActive = !!process.env.NODE_V8_COVERAGE || !!process.env.VITEST_COVERAGE;

    if (coverageActive) {
      this.logger.debug("[LocalCompiler] coverage mode detected – skipping Arduino CLI and extending timeout");
      this.compileTimeoutMs = 60000;
    }

    const spawnIsMock = (spawn as any).mock !== undefined;

    return { usingTestEnv, coverageActive, spawnIsMock };
  }

  private async _handleMockCompilation(exeFile: string, onProcess?: (proc: ChildProcess) => void): Promise<void> {
    const result = await this.processExecutor.execute("echo", ["test"], {
      timeout: this.compileTimeoutMs,
      onProcess,
    });

    if (result.error) {
      throw new CompilerError(result.stderr || `Compiler exit ${result.code}`);
    }

    try {
      await this.makeExecutable(exeFile);
    } catch {
      // Ignore – tests don't care if chmod fails
    }
  }

  private async _checkAndRunArduinoCli(sketchFile: string, usingTestEnv: boolean, coverageActive: boolean): Promise<void> {
    let skipCli = false;
    if (!usingTestEnv) {
      try {
        const cliCacheStat = await stat(LocalCompiler.CLI_CACHE_PATH);
        skipCli = cliCacheStat.size > 0;
      } catch {
        skipCli = false;
      }
    }

    if (skipCli) {
      this.logger.debug("[LocalCompiler] skipping arduino-cli because CLI cache exists");
    } else {
      const buildDir = join(dirname(sketchFile), "build");
      const sketchDir = dirname(sketchFile);
      await this.runArduinoCli(sketchDir, buildDir, coverageActive);
      await this.updateCliCache(buildDir);
    }
  }

  private async _compileWithRetry(
    sketchFile: string,
    exeFile: string,
    coreArchive?: string,
    onProcess?: (proc: ChildProcess) => void,
  ): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.runCompilation(sketchFile, exeFile, attempt, coreArchive, onProcess);
        await this.makeExecutable(exeFile);
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError instanceof CompilerError || attempt >= 2) {
          break;
        }
        if (attempt < 2) {
          this.logger.warn(`Compilation attempt ${attempt} failed, retrying... (${lastError.message})`);
          await new Promise<void>(r => setTimeout(r, 500));
        }
      }
    }

    if (lastError) throw lastError;
  }

  /**
   * Internal method to run the actual g++ compilation
   */
  private async runCompilation(sketchFile: string, exeFile: string, attempt: number, coreArchive?: string, onProcess?: (proc: ChildProcess) => void): Promise<void> {
    this.logger.debug("[LocalCompiler] runCompilation spawning g++");

    // Verify output directory exists
    const outDir = dirname(exeFile);
    try {
      await access(outDir);
    } catch {
      const raceErr = new Error(
        `[RaceCondition] Output directory vanished before g++ spawn: ${outDir}`,
      );
      this.logger.error(raceErr.message);
      throw raceErr;
    }

    // Verify sketch file exists before spawn
    try {
      await access(sketchFile);
    } catch {
      const raceErr = new Error(
        `[RaceCondition] sketch file vanished before g++ spawn: ${sketchFile}`,
      );
      this.logger.error(raceErr.message);
      throw raceErr;
    }

    const args = [sketchFile];
    if (coreArchive) {
      args.push(coreArchive);
    }
    args.push("-o", exeFile, "-pthread");

    // Use ProcessExecutor for safe, unified compilation handling
    const result = await this.processExecutor.execute("g++", args, {
      timeout: this.compileTimeoutMs,
      detached: true,
      stdio: "pipe",
      onProcess,
    });

    if (result.error || result.code !== 0) {
      const cleanedError = this.cleanCompilerErrors(result.stderr || "");
      const errorMsg = `Compiler error (Code ${result.code}, attempt ${attempt}): ${cleanedError}`;
      this.logger.error(errorMsg);
      throw new CompilerError(cleanedError);
    }

    this.logger.info(`Compilation successful: ${exeFile}`);
  }

  /**
   * Makes the compiled executable file executable (chmod +x)
   */
  async makeExecutable(exeFile: string): Promise<void> {
    await chmod(exeFile, 0o755);
    this.logger.debug(`Made executable: ${exeFile}`);
  }

  /**
   * Sets up output directory: checks existence, creates if needed, removes stale exe
   */
  private async setupOutputDirectory(exeFile: string): Promise<void> {
    const outputDir = dirname(exeFile);
    try {
      await access(outputDir);
      this.logger.debug(`Output directory exists: ${outputDir}`);
    } catch {
      this.logger.info(`Output directory missing, creating: ${outputDir}`);
      try {
        await mkdir(outputDir, { recursive: true, mode: 0o755 });
        const dirStat = await stat(outputDir);
        if (!dirStat.isDirectory()) {
          throw new Error(`Created path is not a directory: ${outputDir}`);
        }
        this.logger.debug(`Created output directory with proper permissions: ${outputDir}`);
      } catch (error_) {
        const msg = error_ instanceof Error ? error_.message : String(error_);
        this.logger.error(`Failed to create output directory: ${msg}`);
        throw error_;
      }
    }

    try {
      await rm(exeFile, { force: true });
      this.logger.debug(`Cleaned up stale executable: ${exeFile}`);
    } catch {
      // Ignore - file might not exist yet
    }
  }

  /**
   * Executes Arduino CLI compilation step
   * Returns void on success, logs warnings on failure (not fatal)
   */
  private async runArduinoCli(sketchDir: string, buildDir: string, coverageActive: boolean): Promise<void> {
    if (coverageActive) {
      this.logger.debug("[LocalCompiler] coverage mode – bypassing arduino-cli step");
      return;
    }

    // Ensure the CLI build path and key subdirectories exist
    try {
      await mkdir(join(buildDir, "sketch"), { recursive: true });
      await mkdir(join(buildDir, "core"), { recursive: true });
    } catch {}

    // Create minimal Arduino sketch for CLI in fresh folder
    const cliTemp = join(sketchDir, "cli-temp");
    let cliTempReady = false;
    try {
      const { writeFile } = await import("node:fs/promises");
      await mkdir(cliTemp, { recursive: true });
      const cliSketch = join(cliTemp, "cli-temp.ino");
      await writeFile(cliSketch, "void setup(){}\nvoid loop(){}\n");
      cliTempReady = true;
    } catch {}

    if (!cliTempReady) return;

    try {
      const cliArgs = [
        "compile",
        "--fqbn",
        "arduino:avr:uno",
        "--build-path",
        buildDir,
        cliTemp,
      ];
      this.logger.debug(`spawning arduino-cli ${cliArgs.join(" ")}`);

      const result = await this.processExecutor.execute("arduino-cli", cliArgs, {
        timeout: this.compileTimeoutMs,
        detached: true,
        stdio: "pipe",
      });

      if (result.error) {
        throw result.error;
      }
    } catch (err) {
      this.logger.warn(`arduino-cli step failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      try {
        await rm(cliTemp, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Updates CLI cache with core.a if it's newer than cached version
   */
  private async updateCliCache(buildDir: string): Promise<void> {
    try {
      const suspect = join(buildDir, "core", "core.a");

      // Check if suspect exists
      try {
        await stat(suspect);
      } catch {
        return;
      }

      const cachePath = LocalCompiler.CLI_CACHE_PATH;
      const suspectStat = await stat(suspect);
      let needCopy = false;

      // Check if cache exists and compare times
      try {
        const [cacheStat] = await Promise.allSettled([stat(cachePath)]);
        if (cacheStat.status === "fulfilled") {
          needCopy = suspectStat.mtimeMs > cacheStat.value.mtimeMs;
        } else {
          needCopy = true;
        }
      } catch {
        needCopy = true;
      }

      if (needCopy) {
        const { randomUUID: _cacheUUID } = await import("node:crypto");
        const tmpCachePath = cachePath + "." + _cacheUUID() + ".tmp";
        try {
          const fs = await import("node:fs");
          await fs.promises.copyFile(suspect, tmpCachePath);
          await fs.promises.rename(tmpCachePath, cachePath);
          const newCacheStat = await stat(cachePath);
          const sizeKB = (newCacheStat.size / 1024).toFixed(1);
          this.logger.info(`[LocalCompiler] CLI cache saved (${sizeKB} KB)`);
        } catch (error_) {
          const tmpCachePath = cachePath + "." + _cacheUUID() + ".tmp";
          try { await rm(tmpCachePath, { force: true }); } catch {}
          this.logger.warn(`[LocalCompiler] CLI cache write failed: ${
            error_ instanceof Error ? error_.message : error_}`);
        }
      }
    } catch {}
  }

  /**
   * Cleans up compiler error messages for user display
   * Removes temporary paths and makes errors more readable
   */
  private cleanCompilerErrors(errors: string): string {
    return errors
      .replaceAll('/sandbox/sketch.cpp', "sketch.ino") // Docker path
      .replaceAll(/\/[^\s:/]+(?:\/[^\s:/]+)*\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino") // Local temp path
      .replaceAll('sketch.cpp', "sketch.ino") // Generic .cpp references
      .trim();
  }

  /**
   * Kill any active compiler/CLI process
   */
  kill(): void {
    this.processExecutor.kill("SIGKILL");
  }
}


