//arduino-compiler.ts

import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ParserMessage, IOPinRecord } from "@shared/schema";
import { CodeParser } from "@shared/code-parser";
// Removed unused mock imports to satisfy TypeScript


export interface CompilationResult {
  success: boolean;
  output: string;
  errors?: string;
  binary?: Buffer;
  arduinoCliStatus: 'idle' | 'compiling' | 'success' | 'error';
  gccStatus: 'idle' | 'compiling' | 'success' | 'error';
  processedCode?: string; // NEW: The code with embedded headers
  parserMessages?: ParserMessage[]; // NEW: Parser validation messages
  ioRegistry?: IOPinRecord[]; // NEW: I/O Registry for visualization
}

export class ArduinoCompiler {
  private tempDir = join(process.cwd(), "temp");
  private logger = new Logger("ArduinoCompiler");

  constructor() {
    //this.ensureTempDir();
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
      this.logger.warn(`Failed to create temp directory: ${error instanceof Error ? error.message : error}`);
    }
  }

  async compile(code: string, headers?: Array<{ name: string; content: string }>): Promise<CompilationResult> {
    const sketchId = randomUUID();
    const sketchDir = join(this.tempDir, sketchId);
    const sketchFile = join(sketchDir, `${sketchId}.ino`);

    let arduinoCliStatus: 'idle' | 'compiling' | 'success' | 'error' = 'idle';
    let warnings: string[] = []; // NEW: Collect warnings
    
    // NEW: Parse code for issues
    const parser = new CodeParser();
    const parserMessages = parser.parseAll(code);
    
    // I/O Registry is now populated at runtime, not from static parsing
    const ioRegistry: any[] = [];

    try {
      // Validierung: setup() und loop()
      const hasSetup = /void\s+setup\s*\(\s*\)/.test(code);
      const hasLoop = /void\s+loop\s*\(\s*\)/.test(code);

      if (!hasSetup || !hasLoop) {
        const missingFunctions = [];
        if (!hasSetup) missingFunctions.push('setup()');
        if (!hasLoop) missingFunctions.push('loop()');

        return {
          success: false,
          output: "",
          errors: `Fehlende Arduino-Funktionen: ${missingFunctions.join(' und ')}\n\nArduino-Programme benötigen:\n- void setup() { }\n- void loop() { }`,
          arduinoCliStatus: 'error',
          gccStatus: 'idle',
          parserMessages, // Include parser messages even on error
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
      if (headers && headers.length > 0) {
        console.log(`[COMPILER] Processing ${headers.length} header includes`);
        for (const header of headers) {
          // Try to find includes with both the full name (header_1.h) and without extension (header_1)
          const headerWithoutExt = header.name.replace(/\.[^/.]+$/, ''); // Remove extension
          
          // Search for both variants: #include "header_1.h" and #include "header_1"
          const includeVariants = [
            `#include "${header.name}"`,
            `#include "${headerWithoutExt}"`,
          ];
          
          let found = false;
          for (const includeStatement of includeVariants) {
            if (processedCode.includes(includeStatement)) {
              console.log(`[COMPILER] Found include for: ${header.name} (pattern: ${includeStatement})`);
              // Replace the #include with the actual header content
              processedCode = processedCode.replace(
                new RegExp(`#include\\s*"${includeStatement.split('"')[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
                `// --- Start of ${header.name} ---\n${header.content}\n// --- End of ${header.name} ---`
              );
              found = true;
              console.log(`[COMPILER] Replaced include for: ${header.name}`);
              break;
            }
          }
          
          if (!found) {
            console.log(`[COMPILER] Include not found for: ${header.name} (tried: ${includeVariants.join(', ')})`);
          }
        }
      }
      
      await writeFile(sketchFile, processedCode);

      // Write header files to disk as separate files
      if (headers && headers.length > 0) {
        console.log(`[COMPILER] Writing ${headers.length} header files to ${sketchDir}`);
        for (const header of headers) {
          const headerPath = join(sketchDir, header.name);
          console.log(`[COMPILER] Writing header: ${headerPath}`);
          await writeFile(headerPath, header.content);
        }
      }

      // 1. Arduino CLI
      arduinoCliStatus = 'compiling';
      const cliResult = await this.compileWithArduinoCli(sketchFile);

      let cliOutput = "";
      let cliErrors = "";

      if (cliResult === null) {
        arduinoCliStatus = 'error';
        cliErrors = "Arduino CLI nicht verfügbar";
      } else if (!cliResult.success) {
        arduinoCliStatus = 'error';
        cliOutput = "";
        cliErrors = cliResult.errors || "Compilation fehlgeschlagen";
      } else {
        arduinoCliStatus = 'success';
        cliOutput = cliResult.output || "";
        cliErrors = cliResult.errors || "";
      }

      // Kombinierte Ausgabe
      let combinedOutput = cliOutput;

      // Add warnings to output
      if (warnings.length > 0) {
        const warningText = '\n\n' + warnings.join('\n');
        combinedOutput = combinedOutput ? combinedOutput + warningText : warningText.trim();
      }

      // Erfolg = arduino-cli erfolgreich (g++ Syntax-Check entfernt - wird in Runner gemacht)
      const success = cliResult?.success ?? false;

      return {
        success,
        output: combinedOutput,
        errors: cliErrors || undefined,
        arduinoCliStatus,
        gccStatus: 'idle', // Nicht mehr verwendet in Compiler
        processedCode, // Include the processed code with embedded headers
        parserMessages, // Include parser messages
        ioRegistry, // Include I/O registry
      };

    } catch (error) {
      return {
        success: false,
        output: "",
        errors: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        arduinoCliStatus: arduinoCliStatus === 'compiling' ? 'error' : arduinoCliStatus,
        gccStatus: 'idle',
        processedCode: code, // Return original code on error
        parserMessages, // Include parser messages even on error
        ioRegistry, // Include I/O registry
      };
    } finally {
      try {
        await rm(sketchDir, { recursive: true, force: true });
      } catch (error) {
        this.logger.warn(`Failed to clean up temp directory: ${error}`);
      }
    }
  }

  private async compileWithArduinoCli(sketchFile: string): Promise<{ success: boolean; output: string; errors?: string } | null> {
    return new Promise((resolve) => {
      // Arduino CLI expects the sketch DIRECTORY, not the file
      const sketchDir = sketchFile.substring(0, sketchFile.lastIndexOf('/'));
      
      const arduino = spawn("arduino-cli", [
        "compile",
        "--fqbn", "arduino:avr:uno",
        "--verbose",
        sketchDir
      ]);

      let output = "";
      let errors = "";

      arduino.stdout?.on("data", (data) => {
        output += data.toString();
      });

      arduino.stderr?.on("data", (data) => {
        errors += data.toString();
      });

      arduino.on("close", (code) => {
        if (code === 0) {
          const progSizeRegex = /(Sketch uses[^\n]*\.|Der Sketch verwendet[^\n]*\.)/;
          const ramSizeRegex = /(Global variables use[^\n]*\.|Globale Variablen verwenden[^\n]*\.)/;

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
          // Compilation fehlgeschlagen (Syntaxfehler etc.)
          // Bereinige Fehlermeldungen von Pfaden
          const escapedPath = sketchFile.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const cleanedErrors = errors
            .replace(new RegExp(escapedPath, 'g'), 'sketch.ino')
            .replace(/\/[^\s:]+\/temp\/[a-f0-9-]+\/[a-f0-9-]+\.ino/gi, 'sketch.ino')
            .replace(/Error during build: exit status \d+\s*/g, '')
            .trim();

          resolve({
            success: false,
            output: "",
            errors: cleanedErrors || "Compilation fehlgeschlagen"
          });
        }
      });

      arduino.on("error", () => {
        resolve(null);
      });
    });
  }
}

export const compiler = new ArduinoCompiler();