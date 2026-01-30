/**
 * Local Compiler
 * 
 * Handles local compilation of Arduino sketches using g++.
 * Used as fallback when Docker is not available.
 */

import { spawn } from "child_process";
import { chmod } from "fs/promises";
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
  async compile(sketchFile: string, exeFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const compile = spawn("g++", [
        sketchFile,
        "-o",
        exeFile,
        "-pthread", // Required for threading support
      ]);

      let errorOutput = "";
      let completed = false;

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
          this.logger.error(`Compiler Fehler (Code ${code}): ${cleanedError}`);
          reject(new Error(cleanedError));
        }
      });

      compile.on("error", (err) => {
        completed = true;
        this.logger.error(`Compilation process error: ${err.message}`);
        reject(err);
      });

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
