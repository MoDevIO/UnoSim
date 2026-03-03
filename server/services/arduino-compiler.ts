//arduino-compiler.ts

import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { mkdtempSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ParserMessage, IOPinRecord } from "@shared/schema";
import { CodeParser } from "@shared/code-parser";
import { reservedNamesValidator } from "@shared/reserved-names-validator";
import { getCompileGatekeeper } from "./compile-gatekeeper";
// Removed unused mock imports to satisfy TypeScript

export interface CompilationError {
  file: string;
  line: number;
  column: number;
  type: 'error' | 'warning';
  message: string;
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
}

export class ArduinoCompiler {
  private tempDir = join(process.cwd(), "temp");
  private logger = new Logger("ArduinoCompiler");
  private gatekeeper = getCompileGatekeeper();

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
            const trashPath = `${dirPath}.trash.${Date.now()}.${Math.random().toString(36).substring(7)}`;
            this.logger.debug(
              `Attempting rename-before-delete: ${dirPath} -> ${trashPath}`,
            );
            renameSync(dirPath, trashPath);

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
    } catch (error) {
      this.logger.warn(
        `Failed to create temp directory: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async compile(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
  ): Promise<CompilationResult> {
    // GATEKEEPER: Acquire a compile slot to prevent race conditions
    const release = await this.gatekeeper.acquire();

    try {
      return await this.compileInternal(code, headers, tempRoot);
    } finally {
      release();
    }
  }

  /**
   * Internal compile implementation (wrapped by compile with gatekeeper)
   */
  private async compileInternal(
    code: string,
    headers?: Array<{ name: string; content: string }>,
    tempRoot?: string,
  ): Promise<CompilationResult> {
    const sketchId = randomUUID();

    // use a unique temporary directory per-call to avoid state conflicts when
    // multiple compilations run in parallel (e.g. workers=4 during tests).
    // callers can still provide tempRoot for deterministic paths in unit tests.
    const baseTempDir =
      tempRoot || mkdtempSync(join(tmpdir(), "unowebsim-"));

    const sketchDir = join(baseTempDir, sketchId);
    const sketchFile = join(sketchDir, `${sketchId}.ino`);

    let arduinoCliStatus: "idle" | "compiling" | "success" | "error" = "idle";
    let warnings: string[] = []; // NEW: Collect warnings

    // NEW: Parse code for issues
    const parser = new CodeParser();
    const parserMessages = parser.parseAll(code);

    // Check for reserved name conflicts
    const reservedNameMessages = reservedNamesValidator.validateReservedNames(code);
    const allParserMessages = [...parserMessages, ...reservedNameMessages];

    // I/O Registry is now populated at runtime, not from static parsing
    const ioRegistry: any[] = [];

    try {
      // Validierung: setup() und loop()
      const hasSetup = /void\s+setup\s*\(\s*\)/.test(code);
      const hasLoop = /void\s+loop\s*\(\s*\)/.test(code);

      if (!hasSetup || !hasLoop) {
        const missingFunctions = [];
        if (!hasSetup) missingFunctions.push("setup()");
        if (!hasLoop) missingFunctions.push("loop()");

        return {
          success: false,
          output: "",
          stderr: `Missing Arduino functions: ${missingFunctions.join(" and ")}\n\nArduino sketches require:\n- void setup() { }\n- void loop() { }`,
          errors: [],
          arduinoCliStatus: "error",
          parserMessages: allParserMessages, // Include parser messages even on error
          ioRegistry, // Include I/O registry
        };
      }

      // Serial.begin warnings are now ONLY in parserMessages, not in output
      // The code-parser.ts handles all Serial configuration warnings
      // No need to add them to the warnings array anymore

      // Create files
      await mkdir(sketchDir, { recursive: true });

      // Process code: replace #include statements with actual header content
      let processedCode = code;
      let lineOffset = 0; // Track how many lines were added by header insertion

      if (headers && headers.length > 0) {
        this.logger.debug(`Processing ${headers.length} header includes`);
        for (const header of headers) {
          // Try to find includes with both the full name (header_1.h) and without extension (header_1)
          const headerWithoutExt = header.name.replace(/\.[^/.]+$/, ""); // Remove extension

          // Search for both variants: #include "header_1.h" and #include "header_1"
          const includeVariants = [
            `#include "${header.name}"`,
            `#include "${headerWithoutExt}"`,
          ];

          let found = false;
          for (const includeStatement of includeVariants) {
            if (processedCode.includes(includeStatement)) {
              this.logger.debug(
                `Found include for: ${header.name} (pattern: ${includeStatement})`,
              );
              // Replace the #include with the actual header content
              const replacement = `// --- Start of ${header.name} ---\n${header.content}\n// --- End of ${header.name} ---`;
              processedCode = processedCode.replace(
                new RegExp(
                  `#include\\s*"${includeStatement.split('"')[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
                  "g",
                ),
                replacement,
              );

              // Calculate line offset by counting newlines: replacement newlines - 0 (original #include line stays as 1 line)
              // The #include statement is replaced, so we count how many MORE lines we added
              const newlinesInReplacement = (replacement.match(/\n/g) || [])
                .length;
              // Each #include is 1 line, replacement has newlinesInReplacement+1 lines
              // So offset is: (newlinesInReplacement+1) - 1 = newlinesInReplacement
              lineOffset += newlinesInReplacement;

              found = true;
              this.logger.debug(
                `Replaced include for: ${header.name}, line offset now: ${lineOffset}`,
              );
              break;
            }
          }

          if (!found) {
            this.logger.debug(
              `Include not found for: ${header.name} (tried: ${includeVariants.join(", ")})`,
            );
          }
        }
      }

      await writeFile(sketchFile, processedCode);

      // Write header files to disk as separate files
      if (headers && headers.length > 0) {
        this.logger.debug(
          `Writing ${headers.length} header files to ${sketchDir}`,
        );
        for (const header of headers) {
          const headerPath = join(sketchDir, header.name);
          this.logger.debug(`Writing header: ${headerPath}`);
          await writeFile(headerPath, header.content);
        }
      }

      // 1. Arduino CLI
      arduinoCliStatus = "compiling";
      const cliResult = await this.compileWithArduinoCli(
        sketchFile,
      );

      let cliOutput = "";
      let cliErrors = "";
      let parsedErrors: CompilationError[] = [];

      if (cliResult === null) {
        arduinoCliStatus = "error";
        cliErrors = "Arduino CLI not available";
      } else if (!cliResult.success) {
        arduinoCliStatus = "error";
        cliOutput = "";
        cliErrors = cliResult.errors || "Compilation failed";
        parsedErrors = cliResult.parsedErrors || [];
      } else {
        arduinoCliStatus = "success";
        cliOutput = cliResult.output || "";
        cliErrors = cliResult.errors || "";
        parsedErrors = cliResult.parsedErrors || [];
      }

      // correct stderr text for offset so UI shows original line numbers
      if (lineOffset > 0 && cliErrors) {
        cliErrors = cliErrors.replace(/sketch\.ino:(\d+):/g, (_m, n) => {
          const corrected = Math.max(1, parseInt(n, 10) - lineOffset);
          return `sketch.ino:${corrected}:`;
        });
      }

      // backstop: if the caller didn't supply parsedErrors, run parser ourselves
      if (parsedErrors.length === 0 && cliErrors) {
        parsedErrors = this.parseCompilerErrors(cliErrors, lineOffset);
      }

      // Kombinierte Ausgabe
      let combinedOutput = cliOutput;

      // Add warnings to output
      if (warnings.length > 0) {
        const warningText = "\n\n" + warnings.join("\n");
        combinedOutput = combinedOutput
          ? combinedOutput + warningText
          : warningText.trim();
      }

      // Erfolg = arduino-cli erfolgreich (g++ Syntax-Check entfernt - wird in Runner gemacht)
      const success = cliResult?.success ?? false;

      return {
        success,
        output: combinedOutput,
        stderr: cliErrors || undefined,
        errors: parsedErrors,
        arduinoCliStatus,
        parserMessages: allParserMessages, // Include parser messages
        ioRegistry, // Include I/O registry
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        stderr: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        errors: [],
        arduinoCliStatus:
          arduinoCliStatus === "compiling" ? "error" : arduinoCliStatus,
        parserMessages: allParserMessages, // Include parser messages even on error
        ioRegistry, // Include I/O registry
      };
    } finally {
      try {
        await this.robustCleanupDir(sketchDir);
      } catch (error) {
        this.logger.warn(`Failed to clean up sketch directory: ${error}`);
      }
      // remove base temp folder if we created it ourselves
      if (!tempRoot) {
        try {
          await this.robustCleanupDir(baseTempDir);
        } catch (error) {
          this.logger.warn(`Failed to remove base temp directory: ${error}`);
        }
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
    // match patterns like 'file:line:column: error: message' or
    // 'file:line: error: message' (column optional)
    // match patterns like 'file:line:column: error: message' or
    // 'file:line: error: message' (column optional)
    const regex = /^([^:]+):(\d+)(?::(\d+))?:\s+(warning|error):\s+(.*)$/gm;
    const results: CompilationError[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr))) {
      let [_, file, lineStr, colStr, type, message] = match;
      // shorten to basename so frontend sees just the filename
      file = basename(file);
      let lineNum = parseInt(lineStr, 10);
      if (lineOffset > 0) {
        lineNum = Math.max(1, lineNum - lineOffset);
      }
      const colNum = colStr ? parseInt(colStr, 10) : 0;
      const item: CompilationError = {
        file,
        line: lineNum,
        column: colNum,
        type: type as 'error' | 'warning',
        message,
      };
      const key = `${file}:${lineNum}:${colNum}:${type}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }

    // if nothing parsed but stderr is present, create generic entries per line
    if (results.length === 0 && stderr.trim()) {
      for (const line of stderr.split(/\r?\n/).filter((l) => l.trim())) {
        results.push({
          file: "",
          line: 0,
          column: 0,
          type: "error",
          message: line.trim(),
        });
      }
    }

    return results;
  }

  private async compileWithArduinoCli(
    sketchFile: string,
  ): Promise<
    | { success: boolean; output: string; errors?: string; parsedErrors?: CompilationError[] }
    | null
  > {
    return new Promise((resolve) => {
      // Arduino CLI expects the sketch DIRECTORY, not the file
      const sketchDir = sketchFile.substring(0, sketchFile.lastIndexOf("/"));

      const args = [
        "compile",
        "--fqbn",
        "arduino:avr:uno",
        "--verbose",
        sketchDir,
      ];

      // LOG: Command being executed
      this.logger.info(`Executing arduino-cli ${args.join(" ")}`);

      const arduino = spawn("arduino-cli", args);

      let output = "";
      let errors = "";

      arduino.stdout?.on("data", (data) => {
        output += data.toString();
      });

      arduino.stderr?.on("data", (data) => {
        const chunk = data.toString();
        errors += chunk;
        // LOG: Real-time stderr output for CI debugging
        this.logger.debug(`arduino-cli stderr: ${chunk.trim()}`);
      });

      arduino.on("close", async (code) => {
        // CRITICAL: Wait for Child processes (gcc, ar, etc.) to fully terminate
        // arduino-cli may spawn subprocesses that outlive the main process.
        // Cleaning up too early causes "fatal error: opening dependency file" errors.
        await new Promise((r) => setTimeout(r, 150));

        if (code === 0) {
          const progSizeRegex =
            /(Sketch uses[^\n]*\.|Der Sketch verwendet[^\n]*\.)/;
          const ramSizeRegex =
            /(Global variables use[^\n]*\.|Globale Variablen verwenden[^\n]*\.)/;

          const progSizeMatch = output.match(progSizeRegex);
          const ramSizeMatch = output.match(ramSizeRegex);

          let parsedOutput = "";
          if (progSizeMatch && ramSizeMatch) {
            parsedOutput = `${progSizeMatch[0]}\n${ramSizeMatch[0]}\n\nBoard: Arduino UNO`;
          } else {
            parsedOutput = `Board: Arduino UNO (Simulation)`;
          }

          resolve({
            success: true,
            output: parsedOutput,
          });
        } else {
          // Compilation failed (syntax error etc.)
          // LOG: Full stderr and exit code on failure
          this.logger.error(`arduino-cli compilation failed with exit code ${code}`);
          this.logger.error(`Full stderr output:\n${errors}`);

          // Bereinige Fehlermeldungen von Pfaden
          const escapedPath = sketchFile.replace(
            /[-\/\\^$*+?.()|[\]{}]/g,
            "\\$&",
          );
          let cleanedErrors = errors
            .replace(new RegExp(escapedPath, "g"), "sketch.ino")
            .replace(
              /\/[^\s:]+\/temp\/[a-f0-9-]+\/[a-f0-9-]+\.ino/gi,
              "sketch.ino",
            )
            .replace(/Error during build: exit status \d+\s*/g, "")
            .trim();


          const structured = this.parseCompilerErrors(cleanedErrors || "");
          resolve({
            success: false,
            output: "",
            errors: cleanedErrors || "Compilation failed",
            parsedErrors: structured,
          });
        }
      });

      arduino.on("error", (err) => {
        // LOG: Command spawn error
        this.logger.error(`arduino-cli spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }
}

export const compiler = new ArduinoCompiler();
