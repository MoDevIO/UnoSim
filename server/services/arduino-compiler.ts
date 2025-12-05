//arduino-compiler.ts

import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ARDUINO_MOCK_CODE, ARDUINO_MOCK_LINES } from '../mocks/arduino-mock';


export interface CompilationResult {
  success: boolean;
  output: string;
  errors?: string;
  binary?: Buffer;
  arduinoCliStatus: 'idle' | 'compiling' | 'success' | 'error';
  gccStatus: 'idle' | 'compiling' | 'success' | 'error';
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

  async compile(code: string): Promise<CompilationResult> {
    const sketchId = randomUUID();
    const sketchDir = join(this.tempDir, sketchId);
    const sketchFile = join(sketchDir, `${sketchId}.ino`);

    let arduinoCliStatus: 'idle' | 'compiling' | 'success' | 'error' = 'idle';
    let gccStatus: 'idle' | 'compiling' | 'success' | 'error' = 'idle';
    let warnings: string[] = []; // NEW: Collect warnings

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
        };
      }

      // NEW: Validierung: Serial.begin(115200) - now as WARNING not ERROR
      const hasSerialOutput = /Serial\.(print|println)/.test(code);
      if (hasSerialOutput) {
        const serialBeginExists = /Serial\.begin\s*\(\s*\d+\s*\)/.test(code);

        if (!serialBeginExists) {
          warnings.push('⚠️ Serial.begin(115200) fehlt in setup()\n   Serial output funktioniert möglicherweise nicht korrekt.');
        } else {
          const uncommentedCode = code
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');

          if (!/Serial\.begin\s*\(\s*\d+\s*\)/.test(uncommentedCode)) {
            warnings.push('⚠️ Serial.begin() ist auskommentiert!\n   Serial output funktioniert möglicherweise nicht korrekt.');
          } else {
            // Check if baud rate is 115200
            const baudRateMatch = uncommentedCode.match(/Serial\.begin\s*\(\s*(\d+)\s*\)/);
            if (baudRateMatch && baudRateMatch[1] !== '115200') {
              warnings.push(`⚠️ Serial.begin(${baudRateMatch[1]}) verwendet falsche Baudrate\n   Dieser Simulator erwartet Serial.begin(115200).`);
            }
          }
        }
      }

      // Dateien erstellen
      await mkdir(sketchDir, { recursive: true });
      await writeFile(sketchFile, code);

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

      // 2. GCC Syntax-Check
      gccStatus = 'compiling';
      const gccResult = await this.compileWithGcc(code, sketchDir);
      gccStatus = gccResult.success ? 'success' : 'error';

      // Kombinierte Ausgabe
      let combinedOutput = "";

      if (cliOutput && gccResult.success) {
        combinedOutput = cliOutput;
      } else {
        combinedOutput = gccResult.output + '\n\n' + cliOutput;
      }

      // NEW: Add warnings to output
      if (warnings.length > 0) {
        const warningText = '\n\n' + warnings.join('\n');
        combinedOutput = combinedOutput ? combinedOutput + warningText : warningText.trim();
      }

      let combinedErrors = "";
      if (cliErrors && gccResult.errors) {
        combinedErrors = `Arduino CLI:\n${cliErrors}`;
      } else {
        combinedErrors = cliErrors || gccResult.errors || "";
      }

      // Erfolg = beide erfolgreich (warnings don't block success)
      const success = (cliResult?.success ?? false) && gccResult.success;

      return {
        success,
        output: combinedOutput,
        errors: combinedErrors || undefined,
        arduinoCliStatus,
        gccStatus,
      };

    } catch (error) {
      return {
        success: false,
        output: "",
        errors: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        arduinoCliStatus: arduinoCliStatus === 'compiling' ? 'error' : arduinoCliStatus,
        gccStatus: gccStatus === 'compiling' ? 'error' : gccStatus,
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
      const arduino = spawn("arduino-cli", [
        "compile",
        "--fqbn", "arduino:avr:uno",
        "--verbose",
        sketchFile
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

  private async compileWithGcc(code: string, workDir: string): Promise<{ success: boolean; output: string; errors?: string }> {
    const tempSketchFile = join(workDir, "combined_sketch.cpp");
    const mockCodeLineOffset = ARDUINO_MOCK_LINES;
    // Remove Arduino.h include to avoid compilation errors in GCC
    const cleanedCode = code.replace(/#include\s*[<"]Arduino\.h[>"]/g, '');
    const combinedCode = `${ARDUINO_MOCK_CODE}\n// User code\n${cleanedCode}`;
    await writeFile(tempSketchFile, combinedCode);

    return new Promise((resolve) => {
      const gcc = spawn("g++", [
        "-fsyntax-only",
        "-Wall",
        "-Wextra",
        //"-w",  // ← keine Warnungen ausgeben
        tempSketchFile
      ]);

      let errors = "";
      gcc.stderr?.on("data", (data) => {
        errors += data.toString();
      });

      gcc.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: `Syntax erfolgreich geprüft`,
          });
        } else {
          const correctedErrors = errors
            .replace(new RegExp(`^${workDir.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}/combined_sketch\\.cpp:`, 'gm'), "sketch:")
            .replace(/\/[^\s:]+\/temp\/[a-f0-9-]+\/combined_sketch\.cpp:/g, 'sketch:')
            .replace(/sketch:(\d+):/g, (match, lineNum) => {
              const originalLineNum = parseInt(lineNum);
              const correctedLine = Math.max(1, originalLineNum - mockCodeLineOffset);
              return `line ${correctedLine}:`;
            })
            .replace(/^.*\s\|\s/gm, "")
            .trim();

          resolve({
            success: false,
            output: "",
            errors: correctedErrors || "GCC Compilation fehlgeschlagen",
          });
        }
      });

      gcc.on("error", () => {
        resolve({
          success: false,
          output: "",
          errors: "GCC nicht verfügbar",
        });
      });
    });
  }
}

export const compiler = new ArduinoCompiler();