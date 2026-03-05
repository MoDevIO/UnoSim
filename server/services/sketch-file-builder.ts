/**
 * Sketch File Builder
 * 
 * Handles the construction of Arduino sketch files by wrapping user code
 * with the Arduino mock implementation and generating appropriate main() wrappers.
 */

import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { ARDUINO_MOCK_CODE } from "../mocks/arduino-mock";
import { Logger } from "@shared/logger";
import { detectSketchEntrypoints } from "@shared/utils/sketch-validation";

export interface SketchBuildResult {
  sketchDir: string;
  sketchFile: string;
  exeFile: string;
}

export class SketchFileBuilder {
  private logger = new Logger("SketchFileBuilder");
  private createdSketchDirs = new Set<string>();

  constructor(private tempDir: string) {}

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
    const cleanedCode = code.replace(/#include\s*[<"]Arduino\.h[>"]/g, "");

    const combined = `${ARDUINO_MOCK_CODE}\n\n// --- User code follows ---\n${cleanedCode}\n\n// --- Footer ---\n${footer}`;

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
