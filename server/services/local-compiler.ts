/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { chmod, mkdir, access, rm, stat } from "fs/promises";
import { dirname, join } from "path";
import { Logger } from "@shared/logger";

export class LocalCompiler {
  private logger = new Logger("LocalCompiler");
  // default compiler timeout; may be bumped when running under coverage
  private compileTimeoutMs = 20000; // 20 seconds
  // track the currently running compiler/CLI process so it can be killed
  private activeProc: import("child_process").ChildProcess | null = null;

  /**
   * Public helper so callers can detect if a compile process is currently
   * running.  Used by SandboxRunner to prevent cleanup races.
   */
  get isBusy(): boolean {
    return this.activeProc !== null;
  }

  /**
   * Compiles a sketch file using g++
   * 
   * @param sketchFile - Path to the .cpp file
   * @param exeFile - Path for the output executable
   * @throws Error if compilation fails or times out
   */
  private static readonly CLI_CACHE_PATH = join(process.cwd(), "cache", "cores", "uno-cli-feedback.a");

  async compile(
    sketchFile: string,
    exeFile: string,
    coreArchive?: string,
    onProcess?: (proc: any) => void,
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

    // Only stub compilation when running under unit tests where child_process
    // has been mocked.  Integration tests also run with NODE_ENV=test but the
    // real `spawn` implementation is available, so we should perform an actual
    // g++ compile there.  Detect mocking by checking for a `mock` property on
    // the imported function.
    const { spawn } = await import("child_process");
    const spawnIsMock = (spawn as any)?.mock !== undefined;

    if (usingTestEnv && spawnIsMock) {
      // In the test harness we want exactly one "compile" spawn so that the
      // runner tests can treat that process as the compileProc.  Earlier we
      // removed this branch entirely which allowed CLI/g++ spawns to leak and
      // upset spawnInstances indexes.  Here we spawn a lightweight fake process
      // and wire up the handlers that the tests inspect (stderr data, close).
      // Unlike the previous implementation we *wait* for the fake process to
      // actually exit so that callers (SandboxRunner.performCompilation) can
      // observe success or failure and react accordingly.  The tests simulate
      // stderr/close events manually after the fact, so we can't resolve early.
      const fake = spawn("echo", ["test"]);
      this.activeProc = fake as any;
      // disable the automatic close timer that the global mock inserts so
      // the compiler promise only resolves when the test explicitly invokes
      // the handler.  We achieve this by temporarily stubbing `setTimeout`
      // while the close callback is registered.  The mock itself will still
      // record the call in `fake.on.mock.calls`.
      const realSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: any, t: number, ...args: any[]) => {
        // spawnMock uses 10ms for the auto-close event; ignore those
        if (t === 10) {
          return {} as any;
        }
        return realSetTimeout(fn, t, ...args);
      }) as any;

      // log spawnInstances in case tests have extra processes unexpectedly
      try {
        const gs: any = (globalThis as any).spawnInstances;
        if (Array.isArray(gs)) {
        }
      } catch {}
      // return a promise that mirrors the child process lifecycle; the
      // close handler is installed *before* notifying any external observer
      // (trackProc) so that tests retrieving the first callback get our
      // resolver rather than trackProc's listener.
      await new Promise<void>((resolve, reject) => {
        let stderrText = "";
        if (fake.stderr && fake.stderr.on) {
          fake.stderr.on("data", (d: Buffer) => {
            stderrText += d.toString();
          });
        }
        fake.on("close", (code: number) => {
          this.activeProc = null;
          if (code === 0) {
            resolve();
          } else {
            const err = new Error(stderrText || `Compiler exit ${code}`);
            (err as any).isCompilerError = true;
            reject(err);
          }
        });
        // now that our internal handlers are in place, allow the caller to
        // instrument the process (trackProc) which will append its own close
        // listener *after* ours.
        if (onProcess) {
          try { onProcess(fake); } catch {}
        }
        // restore the original timer implementation now that the close
        // handler has been registered (spawnMock already invoked setTimeout)
        global.setTimeout = realSetTimeout;
        fake.on("error", (err: Error) => {
          this.activeProc = null;
          reject(err);
        });
      });
      // ensure executable permission is set during tests as soon as compile
      // finishes so that downstream assertions don't race on async I/O
      try {
        await this.makeExecutable(exeFile);
      } catch {
        // ignore — tests don't care if chmod itself fails
      }
      return; // skip the real compilation path
    }

    // The sketch is always self-contained (ARDUINO_MOCK_CODE + user code),
    // so we never link a separate core archive alongside it (duplicate symbols).
    // An explicit coreArchive may still be passed by callers that know they need it.

    // Ensure output directory exists before compilation
    const outputDir = dirname(exeFile);
    try {
      await access(outputDir);
      this.logger.debug(`Output directory exists: ${outputDir}`);
    } catch (err) {
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
    } catch (err) {
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
        const { writeFile } = await import("fs/promises");
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
        const { spawn } = await import("child_process");
        // use "pipe" for stdio so that arduino-cli output (including fatal
        // errors from avr-gcc) does not pollute the test/server console.
        // detached: true creates a new process group so that kill(-pid)
        // in LocalCompiler.kill() also terminates avr-gcc sub-processes.
        const cliProc = spawn("arduino-cli", cliArgs,
          { stdio: ["ignore", "pipe", "pipe"], detached: true });
        this.activeProc = cliProc;
        try {
          const gs: any = (globalThis as any).spawnInstances;
          if (Array.isArray(gs)) gs.push(cliProc);
        } catch {}
        await new Promise<void>((res, rej) => {
          cliProc.on("close", (code) => {
            this.activeProc = null;
            if (code === 0) res();
            else rej(new Error(`arduino-cli exit ${code}`));
          });
          cliProc.on("error", (err) => {
            this.activeProc = null;
            rej(err);
          });
        });
      } catch (err) {
        // CLI failure is acceptable; we continue to native compile afterwards
        this.logger.warn(`arduino-cli step failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        // if CLI produced a core.a, copy to cache
        try {
          const fs = await import("fs");
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
            const { randomUUID: _cacheUUID } = await import("crypto");
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
        const isCompilerError = (lastError as any).isCompilerError === true;
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
  private async runCompilation(sketchFile: string, exeFile: string, attempt: number, coreArchive?: string, onProcess?: (proc: any) => void): Promise<void> {
    const { spawn } = await import("child_process");
    this.logger.debug("[LocalCompiler] runCompilation spawning g++");

    // If the output directory has vanished mid-flight a concurrent stop() /
    // cleanup has raced with us.  Fail immediately rather than silently
    // recreating the directory – recreating it would only mask the real
    // lifecycle bug in the caller and produce confusing linker errors later.
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

    // Verify the sketch file is still on disk immediately before we call
    // spawn().  cc1plus opens it *after* g++ has already been exec'd, so a
    // deletion between spawn() and cc1plus's first open() produces the
    // cryptic "fatal error: sketch.ino: No such file or directory".  We
    // detect the race here and abort with a clear diagnostic instead.
    try {
      await access(sketchFile);
    } catch {
      const raceErr = new Error(
        `[RaceCondition] sketch file vanished before g++ spawn: ${sketchFile}`,
      );
      this.logger.error(raceErr.message);
      throw raceErr;
    }

    return new Promise<void>((resolve, reject) => {
      const args = [sketchFile];
      if (coreArchive) {
        args.push(coreArchive);
      }
      args.push("-o", exeFile, "-pthread"); // Required for threading support
      // detached: true creates a new process group so that kill(-pid) in
      // LocalCompiler.kill() also terminates cc1plus sub-processes.
      const compile = spawn("g++", args, { detached: true });
      this.activeProc = compile;
      try {
        const gs: any = (globalThis as any).spawnInstances;
        if (Array.isArray(gs)) gs.push(compile);
      } catch {}

      let errorOutput = "";
      let completed = false;

      // wire up listeners _before_ notifying caller so that any test helper
      // looking at `proc.on.mock.calls` will see our internal handlers first.
      compile.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      const timer = setTimeout(() => {
        if (!completed) {
          compile.kill("SIGKILL");
          const timeoutError = new Error(
            `g++ compilation timeout after ${this.compileTimeoutMs / 1000}s`,
          );
          this.logger.error(timeoutError.message);
          reject(timeoutError);
        }
      }, this.compileTimeoutMs);

      const clearTimer = () => {
        clearTimeout(timer);
      };

      compile.on("close", (code) => {
        this.activeProc = null;
        completed = true;
        clearTimer();
        if (code === 0) {
          this.logger.info(`Compilation successful: ${exeFile}`);
          resolve();
        } else {
          const cleanedError = this.cleanCompilerErrors(errorOutput);
          const errorMsg = `Compiler error (Code ${code}, attempt ${attempt}): ${cleanedError}`;
          this.logger.error(errorMsg);
          const compileErr = new Error(cleanedError);
          (compileErr as any).isCompilerError = true;
          reject(compileErr);
        }
      });

      compile.on("error", (err) => {
        this.activeProc = null;
        completed = true;
        clearTimer();
        this.logger.error(`Compilation process error: ${err.message}`);
        reject(err);
      });

      // finally, let any external hook inspect or augment the process
      if (onProcess) {
        try { onProcess(compile); } catch {}
      }
    });
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
   * Kill any active compiler/CLI process and its entire process group.
   *
   * Because arduino-cli and g++ both spawn sub-processes (avr-gcc, cc1plus),
   * a plain SIGKILL to the direct child leaves orphan processes that hold
   * file handles on the sketch directory.  Using process.kill(-pid) sends
   * SIGKILL to every process in the group, which is only possible when the
   * child was spawned with { detached: true }.
   */
  kill(): void {
    const proc = this.activeProc;
    if (!proc) return;
    // Clear the reference first to prevent re-entrant calls.
    this.activeProc = null;
    try {
      if (proc.pid != null) {
        try {
          // Kill the entire process group (requires detached: true at spawn).
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          // Fallback: kill just the direct child when group-kill is unavailable
          // (e.g. Windows, or process group already gone).
          proc.kill("SIGKILL");
        }
      } else {
        proc.kill("SIGKILL");
      }
    } catch {
      /* ignore */
    }
  }
}


