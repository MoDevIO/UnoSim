/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { spawn } from "child_process";
import { chmod, mkdir, access, rm } from "fs/promises";
import { dirname } from "path";
import { Logger } from "@shared/logger";

export class LocalCompiler {
  private logger = new Logger("LocalCompiler");
  private readonly compileTimeoutMs = 20000; // 20 seconds

  /**
   * Compiles a sketch file using g++
   * 
   * @param sketchFile - Path to the .cpp file
   * @param exeFile - Path for the output executable
   * @throws Error if compilation fails or times out
   */
  async compile(
    sketchFile: string,
    exeFile: string,
    coreArchive?: string,
    onProcess?: (proc: any) => void,
  ): Promise<void> {
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

    // Try compilation with retry logic for transient failures
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
          await new Promise(r => setTimeout(r, 500)); // Wait before retry
        }
      }
    }
    
    if (lastError) throw lastError;
  }

  /**
   * Internal method to run the actual g++ compilation
   */
  private runCompilation(sketchFile: string, exeFile: string, attempt: number, coreArchive?: string, onProcess?: (proc: any) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [sketchFile];
      if (coreArchive) {
        args.push(coreArchive);
      }
      args.push("-o", exeFile, "-pthread"); // Required for threading support
      const compile = spawn("g++", args);

      let errorOutput = "";
      let completed = false;

      // wire up listeners _before_ notifying caller so that any test helper
      // looking at `proc.on.mock.calls` will see our internal handlers first.
      compile.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      compile.on("close", (code) => {
        completed = true;
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
        completed = true;
        this.logger.error(`Compilation process error: ${err.message}`);
        reject(err);
      });

      // finally, let any external hook inspect or augment the process
      if (onProcess) {
        try { onProcess(compile); } catch {}
      }

      // Timeout protection
      setTimeout(() => {
        if (!completed) {
          compile.kill("SIGKILL");
          const timeoutError = new Error(
            `g++ compilation timeout after ${this.compileTimeoutMs / 1000}s`,
          );
          this.logger.error(timeoutError.message);
          reject(timeoutError);
        }
      }, this.compileTimeoutMs);
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
}
