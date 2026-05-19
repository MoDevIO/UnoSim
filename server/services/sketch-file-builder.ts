/**
 * Sketch File Builder
 * 
 * Handles the construction of Arduino sketch files by wrapping user code
 * with the Arduino mock implementation and generating appropriate main() wrappers.
 */

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ARDUINO_MOCK_CODE } from "./arduino-mock";
import { Logger } from "@shared/logger";
import { detectSketchEntrypoints } from "@shared/utils/sketch-validation";

interface SketchBuildResult {
  sketchDir: string;
  sketchFile: string;
  exeFile: string;
}

export class SketchFileBuilder {
  private readonly logger = new Logger("SketchFileBuilder");
  private readonly createdSketchDirs = new Set<string>();

  constructor(private readonly tempDir: string) {}

  /**
   * Builds a complete sketch file with Arduino mock and user code
   * 
   * @param code - User's Arduino code
   * @param sketchId - Unique identifier for this sketch
   * @returns Paths to sketch directory and files
   */
  async build(code: string, sketchId: string): Promise<SketchBuildResult> {
    const sketchDir = join(this.tempDir, sketchId);
    const sketchFile = join(sketchDir, "sketch.cpp");
    const exeFile = join(sketchDir, "sketch");

    try {
      await mkdir(sketchDir, { recursive: true });
      this.createdSketchDirs.add(sketchDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create sketch directory: ${msg}`);
      throw err;
    }

    const { hasSetup, hasLoop } = detectSketchEntrypoints(code);

    if (!hasSetup && !hasLoop) {
      this.logger.warn(
        "Weder setup() noch loop() gefunden - Code wird nur als Bibliothek kompiliert",
      );
    }

    const footer = this.buildFooter(hasSetup, hasLoop);
    const cleanedCode = code.replaceAll(/#include\s*[<"]Arduino\.h[>"]/g, "");

    const forwardDecls = this.extractForwardDeclarations(cleanedCode);
    const forwardSection = forwardDecls
      ? `// --- Forward declarations (auto-generated, mirrors Arduino IDE behaviour) ---\n${forwardDecls}\n\n`
      : "";

    const combined = `${ARDUINO_MOCK_CODE}\n\n${forwardSection}// --- User code follows ---\n${cleanedCode}\n\n// --- Footer ---\n${footer}`;

    await writeFile(sketchFile, combined);

    return { sketchDir, sketchFile, exeFile };
  }

  getCreatedSketchDirs(): string[] {
    return Array.from(this.createdSketchDirs);
  }

  clearCreatedSketchDir(dir: string): void {
    this.createdSketchDirs.delete(dir);
  }

  /**
   * Extracts forward declarations for all user-defined functions.
   *
   * The Arduino IDE automatically generates prototypes for every function in a
   * sketch so that helper functions can be called before they are defined (just
   * like in a real Arduino sketch).  We replicate that behaviour here so that
   * the local g++ compiler accepts the same code the Arduino IDE would accept.
   */
  private extractForwardDeclarations(code: string): string {
    // Strip single-line and block comments to avoid false positives
    const stripped = code
      .replaceAll(/\/\/[^\n]*/g, "")
      .replaceAll(/\/\*[\s\S]*?\*\//g, "");

    // Keywords that are never function names
    const SKIP = new Set([
      "if", "else", "while", "for", "do", "switch", "case",
      "return", "break", "continue", "goto",
      "class", "struct", "union", "enum", "namespace", "typedef",
      "setup", "loop", "main",
    ]);

    // Match top-level function definitions (no leading indentation).
    // The return type may span multiple words, e.g. "unsigned long".
    // Including space in the character class allows that while the lazy
    // quantifier ensures the function name is captured in group 2.
    // The opening brace is required so declarations/prototypes are not matched.
    const funcDef = /^(\w[\w*& ]*?)\s+(\w+)\s*(\([^)]*\))\s*\{/gm;

    const seen = new Set<string>();
    const decls: string[] = [];

    for (const match of stripped.matchAll(funcDef)) {
      const returnType = match[1].trim();
      const funcName = match[2];
      const params = match[3];

      if (SKIP.has(funcName)) continue;
      if (seen.has(funcName)) continue;

      seen.add(funcName);
      decls.push(`${returnType} ${funcName}${params};`);
    }

    return decls.join("\n");
  }

  /**
   * Generates the main() wrapper based on presence of setup() and loop()
   */
  private buildFooter(hasSetup: boolean, hasLoop: boolean): string {
    let footer = `
#include <thread>
#include <atomic>
#include <cstring>
#include <chrono>

int main() {
    // Initialize IO registry for pin state tracking
    initIORegistry();
    
    // Start background thread for serial input
    std::thread readerThread(serialInputReader);
    readerThread.detach();
`;

    if (hasSetup) {
      footer += `
    // Call user's setup() function
    setup();
    Serial.flush();
`;
    }

    if (hasLoop) {
      footer += `
    // Run user's loop() function continuously
    bool __registry_sent = false;
    while (1) {
        Serial.flush();
        loop();
        
        // Send registry after first loop iteration
        if (!__registry_sent) {
            Serial.flush();
            outputIORegistry();
            __registry_sent = true;
        }
        
        // Sleep 1ms to prevent 100% CPU usage (Arduino runs at ~16MHz, so 1ms is reasonable throttle)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
`;
    } else {
      footer += `
    // No loop() function, just output registry once
    outputIORegistry();
`;
    }

    footer += `
    Serial.flush();
    
    // Cleanup: stop serial input reader
    keepReading.store(false);
    
    return 0;
}
`;

    return footer;
  }
}
