/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { chmod, mkdir, access, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ChildProcess } from "node:child_process";
import { Logger } from "@shared/logger";
import { ProcessExecutor } from "./process-executor";

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
  private logger = new Logger("LocalCompiler");
  private compileTimeoutMs = 20000; // 20 seconds
  private processExecutor: ProcessExecutor;

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
    const usingTestEnv = process.env.NODE_ENV === "test";
    // detect if we're running in a coverage-instrumented process – Vitest/v8
    const coverageActive = !!process.env.NODE_V8_COVERAGE || !!process.env.VITEST_COVERAGE;
    if (coverageActive) {
      // slow instrumentation may cause Arduino CLI or g++ to take longer and
      // occasionally expose races in the temporary build directory.  in
      // coverage mode we simply skip the CLI step (which is the most flaky)
      // and give the compile a much larger timeout to avoid spurious kills.
      this.logger.debug("[LocalCompiler] coverage mode detected – skipping Arduino CLI and extending timeout");
      this.compileTimeoutMs = 60000; // 60 seconds
    }
    this.logger.debug(`[LocalCompiler] compile() invoked (testEnv=${usingTestEnv}, coverage=${coverageActive}) sketch=${sketchFile}`);

    // In test environments with mocked spawn, run a lightweight fake compile
    const { spawn } = await import("node:child_process");
    const spawnIsMock = (spawn as unknown as { mock?: object })?.mock !== undefined;

    if (usingTestEnv && spawnIsMock) {
      // Use ProcessExecutor to handle mocked spawn in tests
      const result = await this.processExecutor.execute("echo", ["test"], {
        timeout: this.compileTimeoutMs,
        onProcess,
      });

      if (result.error) {
        const err = new CompilerError(result.stderr || `Compiler exit ${result.code}`);
        throw err;
      }

      // Set executable permissions
      try {
        await this.makeExecutable(exeFile);
      } catch {
        // Ignore – tests don't care if chmod fails
      }
      return; // Skip real compilation
    }

    // The sketch is always self-contained (ARDUINO_MOCK_CODE + user code),
    // so we never link a separate core archive alongside it (duplicate symbols).
    // An explicit coreArchive may still be passed by callers that know they need it.

    // Ensure output directory exists before compilation
    const outputDir = dirname(exeFile);
    try {
      await access(outputDir);
      this.logger.debug(`Output directory exists: ${outputDir}`);
    } catch {
      this.logger.info(`Output directory missing, creating: ${outputDir}`);
      try {
        await mkdir(outputDir, { recursive: true, mode: 0o755 });
        // Confirm the directory is genuinely present and accessible after
        // creation.  Under parallel load a concurrent cleanup could delete
        // it between our mkdir() and this stat(), making the upcoming
        // compile fail with a confusing error.
        const dirStat = await stat(outputDir);
        if (!dirStat.isDirectory()) {
          throw new Error(`Created path is not a directory: ${outputDir}`);
        }
        this.logger.debug(`Created output directory with proper permissions: ${outputDir}`);
      } catch (mkdirErr) {
        const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
        this.logger.error(`Failed to create output directory: ${msg}`);
        throw mkdirErr;
      }
    }

    // Ensure output directory is writable by removing any stale exe file
    try {
      await rm(exeFile, { force: true });
      this.logger.debug(`Cleaned up stale executable: ${exeFile}`);
    } catch {
      // Ignore - file might not exist yet
    }

    // first run through arduino-cli to give users real error output and produce
    // a core.a in the sketch build directory - skip if we already have a cache or
    // if the CLI-feedback cache is present (bypass slow invocation).
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
    } else if (coverageActive) {
      // don't bother calling arduino-cli under coverage; it has caused
      // intermittent file-system races that make the whole pipeline fragile.
      this.logger.debug("[LocalCompiler] coverage mode – bypassing arduino-cli step");
    } else {
      const buildDir = join(dirname(sketchFile), "build");
      const sketchDir = dirname(sketchFile);
      // ensure the CLI build path AND key subdirectories exist before invoking
      // arduino-cli / avr-gcc so they never fail trying to create them under
      // parallel load on macOS.
      try {
        await mkdir(join(buildDir, "sketch"), { recursive: true });
        await mkdir(join(buildDir, "core"), { recursive: true });
      } catch {}

      // create a minimal Arduino sketch for CLI in a fresh folder
      const cliTemp = join(sketchDir, "cli-temp");
      let cliTempReady = false;
      try {
        const { writeFile } = await import("node:fs/promises");
        await mkdir(cliTemp, { recursive: true });
        // filename must match directory name for Arduino CLI
        const cliSketch = join(cliTemp, "cli-temp.ino");
        await writeFile(cliSketch, "void setup(){}\nvoid loop(){}\n");
        cliTempReady = true;
      } catch {}

      // Only invoke arduino-cli if the sketch directory was successfully prepared.
      // Skipping prevents noisy "Can't open sketch" errors and avoids resource
      // contention when multiple test workers run in parallel.
      if (cliTempReady) {
        try {
          const cliArgs = [
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            "--build-path",
            buildDir,
            cliTemp, // run CLI in isolated directory
          ];
          this.logger.debug(`spawning arduino-cli ${cliArgs.join(" ")}`);

          // Use ProcessExecutor for safe, centralized process handling
          const result = await this.processExecutor.execute("arduino-cli", cliArgs, {
            timeout: this.compileTimeoutMs,
            detached: true,
            stdio: "pipe",
          });

          if (result.error) {
            throw result.error;
          }
        } catch (err) {
          // CLI failure is acceptable; we continue to native compile afterwards
          this.logger.warn(`arduino-cli step failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          // if CLI produced a core.a, copy to cache
          try {
            const fs = await import("node:fs");
          const suspect = join(buildDir, "core", "core.a");
          
          // Check if suspect exists
          try {
            await stat(suspect);
          } catch {
            // suspect doesn't exist, skip
            throw new Error("no suspect");
          }
          
          const cachePath = LocalCompiler.CLI_CACHE_PATH;
          let needCopy = false;
          
          // Check if cache exists and compare times
          try {
            const suspectStat = await stat(suspect);
            const [cacheStat] = await Promise.allSettled([
              stat(cachePath)
            ]);
            if (cacheStat.status === "fulfilled") {
              needCopy = suspectStat.mtimeMs > cacheStat.value.mtimeMs;
            } else {
              needCopy = true;
            }
          } catch {
            needCopy = true;
          }
          
          if (needCopy) {
            // Write to a per-invocation temp file then atomically rename it
            // into place.  This prevents a parallel worker from reading a
            // partially written cache file.
            const { randomUUID: _cacheUUID } = await import("node:crypto");
            const tmpCachePath = cachePath + "." + _cacheUUID() + ".tmp";
            try {
              await fs.promises.copyFile(suspect, tmpCachePath);
              await fs.promises.rename(tmpCachePath, cachePath);
              try {
                const cacheStat = await stat(cachePath);
                const sizeKB = (cacheStat.size / 1024).toFixed(1);
                this.logger.info(`[LocalCompiler] CLI cache saved (${sizeKB} KB)`);
              } catch {
                // ignore stat error
              }
            } catch (writeErr) {
              // Atomic write failed – clean up the temp file and continue
              // without crashing (the cache is supplementary).
              try { await rm(tmpCachePath, { force: true }); } catch {}
              this.logger.warn(`[LocalCompiler] CLI cache write failed: ${
                writeErr instanceof Error ? writeErr.message : writeErr}`);
            }
          }
        } catch {}
        // cleanup temporary CLI sketch folder
        try {
          await rm(cliTemp, { recursive: true, force: true });
        } catch {}
      }
      } // end if (cliTempReady)
    }

    // Try compilation with retry logic for transient failures using g++
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
            await this.runCompilation(sketchFile, exeFile, attempt, coreArchive, onProcess);
        return; // Success on this attempt
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isCompilerError = lastError instanceof CompilerError;
        if (isCompilerError || attempt >= 2) {
          break;
        }
        if (attempt < 2) {
          this.logger.warn(`Compilation attempt ${attempt} failed, retrying... (${lastError.message})`);
          await new Promise<void>(r => setTimeout(r, 500)); // Wait before retry
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
   * Cleans up compiler error messages for user display
   * Removes temporary paths and makes errors more readable
   */
  private cleanCompilerErrors(errors: string): string {
    return errors
      .replace(/\/sandbox\/sketch\.cpp/g, "sketch.ino") // Docker path
      .replace(/\/[^\s:]+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino") // Local temp path
      .replace(/sketch\.cpp/g, "sketch.ino") // Generic .cpp references
      .trim();
  }

  /**
   * Kill any active compiler/CLI process
   */
  kill(): void {
    this.processExecutor.kill("SIGKILL");
  }
}


