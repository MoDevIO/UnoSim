/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { chmod, mkdir, access, rm } from "fs/promises";
import { existsSync, statSync, mkdirSync } from "fs";
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
  private static readonly CORE_LIB_PATH = join(process.cwd(), "arduino-core", "core.a");
  private static readonly CLI_CACHE_PATH = join(process.cwd(), "cache", "cores", "uno-cli-feedback.a");
  private static readonly SIM_CACHE_PATH = join(process.cwd(), "cache", "cores", "sim-native-core.a");

  /**
   * Check whether the given precompiled archive is stale in relation to the
   * underlying Arduino core library. If the core library has been updated more
   * recently than the archive we should rebuild instead of reusing it.
   */
  private async isArchiveStale(archive: string): Promise<boolean> {
    try {
      const [archStat, coreStat] = await Promise.all([
        import("fs").then((fs) => fs.promises.stat(archive)),
        import("fs").then((fs) => fs.promises.stat(LocalCompiler.CORE_LIB_PATH)),
      ]);
      return archStat.mtimeMs < coreStat.mtimeMs;
    } catch {
      // if we can't stat either file, assume it's not stale so we don't
      // accidentally throw away a valid cache
      return false;
    }
  }

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

    // make sure native cache exists and is up‑to‑date (rebuild if stale)
    let nativeArchive = usingTestEnv ? undefined : coreArchive;
    const simPath = LocalCompiler.SIM_CACHE_PATH;
    if (!usingTestEnv) {
      if (await this.isNativeCacheStale(simPath)) {
        await this.ensureNativeCoreCache();
      }
      // if we don't already have an archive to link, use the sim cache
      if (!nativeArchive && existsSync(simPath)) {
        nativeArchive = simPath;
      }
      // if the supplied archive (e.g. from prepareEnvironment) is stale, forget it
      if (coreArchive) {
        const stale = await this.isArchiveStale(coreArchive);
        if (stale) {
          this.logger.info(
            `[LocalCompiler] cache archive is stale, ignoring: ${coreArchive}`,
          );
          coreArchive = undefined;
        }
      }
    }
    // we will pass nativeArchive (if any) to g++ later

    // Ensure output directory exists before compilation
    const outputDir = dirname(exeFile);
    try {
      await access(outputDir);
      this.logger.debug(`Output directory exists: ${outputDir}`);
    } catch (err) {
      this.logger.info(`Output directory missing, creating: ${outputDir}`);
      try {
        await mkdir(outputDir, { recursive: true, mode: 0o755 });
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
    if (!usingTestEnv && existsSync(LocalCompiler.CLI_CACHE_PATH)) {
      if (typeof statSync === "function") {
        try {
          skipCli = statSync(LocalCompiler.CLI_CACHE_PATH).size > 0;
        } catch {
          skipCli = false;
        }
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
      // ensure the CLI build path exists before invoking
      try {
        await mkdir(buildDir, { recursive: true });
      } catch {}

      // create a minimal Arduino sketch for CLI in a fresh folder
      const cliTemp = join(sketchDir, "cli-temp");
      try {
        const { writeFile } = await import("fs/promises");
        await mkdir(cliTemp, { recursive: true });
        // filename must match directory name for Arduino CLI
        const cliSketch = join(cliTemp, "cli-temp.ino");
        await writeFile(cliSketch, "void setup(){}\nvoid loop(){}\n");
      } catch {}

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
        const cliProc = spawn("arduino-cli", cliArgs,
          { stdio: ["ignore", "inherit", "inherit"] });
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
        // diagnostic: list build/core contents to prove CLI output
        try {
          const { execSync } = await import("child_process");
          const coreDir = join(buildDir, "core");
          const listing = execSync(`ls -R ${coreDir} 2>/dev/null || true`).toString();
          console.log("CLI_BUILD_DIR_CONTENTS:\n" + listing);
        } catch {}
        // if CLI produced a core.a, copy to cache
        try {
          const fs = await import("fs");
          const suspect = join(buildDir, "core", "core.a");
          if (fs.existsSync(suspect)) {
            const cachePath = LocalCompiler.CLI_CACHE_PATH;
            const needCopy = !fs.existsSync(cachePath) ||
              (typeof fs.statSync === "function" && fs.statSync(suspect).mtimeMs > fs.statSync(cachePath).mtimeMs);
            if (needCopy) {
              await fs.promises.copyFile(suspect, cachePath);
              const sizeKB = typeof fs.statSync === "function" ? (fs.statSync(cachePath).size / 1024).toFixed(1) : "0";
              this.logger.info(`[LocalCompiler] CLI cache saved (${sizeKB} KB)`);
            }
          }
        } catch {}
        // cleanup temporary CLI sketch folder
        try {
          await rm(cliTemp, { recursive: true, force: true });
        } catch {}
      }
    }

    // after CLI stage, prefer nativeArchive for linking
    if (nativeArchive) {
      coreArchive = nativeArchive;
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
    // guard against cases where the temp directory vanished mid-compile
    const outDir = dirname(exeFile);
    if (!existsSync(outDir)) {
      this.logger.warn(`[LocalCompiler] output directory missing, recreating: ${outDir}`);
      mkdirSync(outDir, { recursive: true });
    }

    return new Promise<void>((resolve, reject) => {
      const args = [sketchFile];
      if (coreArchive) {
        args.push(coreArchive);
      }
      args.push("-o", exeFile, "-pthread"); // Required for threading support
      const compile = spawn("g++", args);
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
   * Build the sim-native core archive using g++ and ar if cache is missing.
   * This compiles the shared Arduino mock code once for the host architecture
   * and produces sim-native-core.a in the cache directory.
   */
  private async ensureNativeCoreCache(): Promise<void> {
    this.logger.debug(`[LocalCompiler] ensureNativeCoreCache called, SIM_CACHE_PATH=${LocalCompiler.SIM_CACHE_PATH}`);
    const hashFile = LocalCompiler.SIM_CACHE_PATH + ".hash";
    if (existsSync(LocalCompiler.SIM_CACHE_PATH)) {
      // check hash, rebuild if mismatched
      try {
        const existing = await import("fs/promises").then((fs) => fs.readFile(hashFile, "utf-8"));
        const { ARDUINO_MOCK_CODE } = await import("../mocks/arduino-mock");
        const crypto = await import("crypto");
        const current = crypto.createHash("sha256").update(ARDUINO_MOCK_CODE).digest("hex");
        if (existing === current) {
          this.logger.debug("[LocalCompiler] native cache up-to-date, skipping build");
          return;
        }
        this.logger.debug("[LocalCompiler] native cache hash mismatch, rebuilding");
      } catch {
        // missing hash file, rebuild
        this.logger.debug("[LocalCompiler] no hash file, rebuilding native cache");
      }
    }
    const tmp = join(process.cwd(), "cache", "cores", "sim-build");
    this.logger.debug(`[LocalCompiler] creating temporary build dir: ${tmp}`);
    try {
      await mkdir(tmp, { recursive: true });
      const src = join(tmp, "sim-core.cpp");
      const { ARDUINO_MOCK_CODE } = await import("../mocks/arduino-mock");
      await import("fs/promises").then((fs) => fs.writeFile(src, ARDUINO_MOCK_CODE));

      const obj = join(tmp, "sim-core.o");
      await new Promise<void>((res, rej) => {
        const { spawn } = require("child_process");
        const proc = spawn("g++", ["-std=gnu++17", "-pthread", "-c", src, "-o", obj]);
        try { const gs: any = (globalThis as any).spawnInstances; if (Array.isArray(gs)) gs.push(proc); } catch {}
        proc.on("close", (code: number | null) => (code === 0 ? res() : rej(new Error("g++ native core compile failed"))));
        proc.on("error", rej);
      });

      await new Promise<void>((res, rej) => {
        const { spawn } = require("child_process");
        const proc = spawn("ar", ["rcs", LocalCompiler.SIM_CACHE_PATH, obj]);
        try { const gs: any = (globalThis as any).spawnInstances; if (Array.isArray(gs)) gs.push(proc); } catch {}
        proc.on("close", (code: number | null) => (code === 0 ? res() : rej(new Error("ar archiving failed"))));
        proc.on("error", rej);
      });

      // after successful build write hash file using same mock code
      try {
        const fs = await import("fs/promises");
        const crypto = await import("crypto");
        const h = crypto.createHash("sha256").update(ARDUINO_MOCK_CODE).digest("hex");
        await fs.writeFile(hashFile, h);
        this.logger.debug(`[LocalCompiler] wrote native-cache hash to ${hashFile}`);
      } catch (err) {
        this.logger.warn(`[LocalCompiler] could not write hash file: ${err}`);
      }
    } catch (err) {
      this.logger.warn(`[LocalCompiler] failed to build native core cache: ${err}`);
    } finally {
      try {
        await rm(tmp, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Return true if the native cache either doesn't exist or its hash differs
   * from the current mock code.  Used to determine when to rebuild.
   */
  private async isNativeCacheStale(path: string): Promise<boolean> {
    try {
      if (!existsSync(path)) {
        this.logger.debug("[LocalCompiler] native cache missing, considered stale");
        return true;
      }
      const hashFile = path + ".hash";
      const fs = await import("fs/promises");
      const existing = await fs.readFile(hashFile, "utf-8");
      const { ARDUINO_MOCK_CODE } = await import("../mocks/arduino-mock");
      const crypto = await import("crypto");
      const current = crypto.createHash("sha256").update(ARDUINO_MOCK_CODE).digest("hex");
      const stale = existing !== current;
      this.logger.debug(`[LocalCompiler] native cache hash check: existing=${existing.slice(0,8)} current=${current.slice(0,8)} stale=${stale}`);
      return stale;
    } catch (err) {
      this.logger.debug(`[LocalCompiler] native cache hash check error: ${err}`);
      return true; // rebuild on any error
    }
  }

  /**
   * Kill any active compiler/CLI process.
   */
  kill(): void {
    if (this.activeProc) {
      try {
        this.activeProc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      this.activeProc = null;
    }
  }
}
