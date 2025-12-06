//arduino-runner.ts

import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ARDUINO_MOCK_CODE, ARDUINO_MOCK_LINES } from '../mocks/arduino-mock';


export class ArduinoRunner {
    isRunning = false;
    tempDir = join(process.cwd(), "temp");
    process: ReturnType<typeof spawn> | null = null;
    processKilled = false;
    private logger = new Logger("ArduinoRunner");
    private outputBuffer = ""; // Buffer für incomplete lines
    private errorBuffer = "";  // Buffer für error output
    private flushTimer: NodeJS.Timeout | null = null; // Timer für auto-flush
    private pendingIncomplete = false; // Track if we sent incomplete output

    constructor() {
        mkdir(this.tempDir, { recursive: true })
            .catch(() => { this.logger.warn("Temp-Verzeichnis konnte nicht initial erstellt werden"); });
    }

    async runSketch(
        code: string,
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void,
        onCompileError?: (error: string) => void
    ) {


        this.isRunning = true;
        // Reset buffers for new sketch
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.pendingIncomplete = false;
        let compilationFailed = false;

        const sketchId = randomUUID();
        const sketchDir = join(this.tempDir, sketchId);
        const sketchFile = join(sketchDir, `${sketchId}.cpp`);
        const exeFile = join(sketchDir, `${sketchId}.exe`);

        const hasSetup = /void\s+setup\s*\([^)]*\)/.test(code);
        const hasLoop = /void\s+loop\s*\([^)]*\)/.test(code);

        let footer = `
#include <thread>
#include <atomic>
#include <cstring>

int main() {
    std::thread readerThread(serialInputReader);
    readerThread.detach();
`;

        if (hasSetup) footer += "    setup();\n";
        if (hasLoop) footer += "    while (1) loop();\n";

        footer += `
    keepReading.store(false);
    return 0;
}
`;

        if (!hasSetup && !hasLoop) {
            this.logger.warn("Weder setup() noch loop() gefunden - Code wird nur als Bibliothek kompiliert");
        }

        try {
            await mkdir(sketchDir, { recursive: true });

            // Remove Arduino.h include to avoid compilation errors in GCC
            const cleanedCode = code.replace(/#include\s*[<"]Arduino\.h[>"]/g, '');
            const combined = `${ARDUINO_MOCK_CODE}\n// --- User code follows ---\n${cleanedCode}\n\n// --- Footer ---\n${footer}`;
            await writeFile(sketchFile, combined);

            await new Promise<void>((resolve, reject) => {
                const compile = spawn("g++", [sketchFile, "-o", exeFile]);
                let errorOutput = "";
                let completed = false;

                compile.stderr.on("data", d => { errorOutput += d.toString() });
                compile.on("close", (code) => {
                    completed = true;
                    if (code === 0) {
                        resolve();
                    } else {
                        this.logger.error(`Compiler Fehler (Code ${code}): ${errorOutput}`);
                        compilationFailed = true;
                        // Call compile error callback if provided
                        if (onCompileError) {
                          onCompileError(errorOutput);
                        }
                        reject(new Error(errorOutput));
                    }
                });
                compile.on("error", err => {
                    completed = true;
                    this.logger.error(`Compilerprozess Fehler: ${err.message}`);
                    compilationFailed = true;
                    if (onCompileError) {
                      onCompileError(`Compilerprozess Fehler: ${err.message}`);
                    }
                    reject(err);
                });

                setTimeout(() => {
                    if (!completed) {
                        compile.kill('SIGKILL');
                        this.logger.error("g++ Timeout nach 10s");
                        compilationFailed = true;
                        if (onCompileError) {
                          onCompileError("g++ timeout after 10s");
                        }
                        reject(new Error("g++ timeout after 10s"));
                    }
                }, 10000);
            });

            this.processKilled = false;
            this.process = spawn(exeFile);

            const timeout = setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGKILL');
                    onError("Sketch runtime timeout");
                    this.logger.error("Sketch Ausführung Timeout nach 180s");
                }
            }, 180000);

            // IMPROVED: Output buffering with auto-flush
            this.process.stdout?.on("data", (data) => {

                const str = data.toString();

                // Add to buffer
                this.outputBuffer += str;

                // Split by newlines and process complete lines
                const lines = this.outputBuffer.split(/\r?\n/);

                // Keep the last (potentially incomplete) line in buffer
                this.outputBuffer = lines.pop() || "";

                // Send all complete lines
                lines.forEach(line => {
                    if (line.length > 0) {
                        // If we have pending incomplete output, this completes it
                        if (this.pendingIncomplete) {
                            onOutput(line, true); // Complete the previous incomplete line
                            this.pendingIncomplete = false;
                        } else {
                            onOutput(line, true); // New complete line
                        }
                    }
                });

                // NEW: Auto-flush incomplete output after short delay (for Serial.print)
                // Auto-Flushing des unvollständigen Buffers nach kurzer Wartezeit
                if (this.outputBuffer.length > 0) {
                    this.scheduleFlush(onOutput);
                } else if (this.flushTimer) {
                    // Wenn Buffer leer ist, evtl. bestehenden Timer löschen
                    clearTimeout(this.flushTimer);
                    this.flushTimer = null;
                }
            });

            this.process.stderr?.on("data", (data) => {
                const str = data.toString();

                // Add to error buffer
                this.errorBuffer += str;

                // Split by newlines and process complete lines
                const lines = this.errorBuffer.split(/\r?\n/);

                // Keep the last (potentially incomplete) line in buffer
                this.errorBuffer = lines.pop() || "";

                // Send all complete lines
                lines.forEach(line => {
                    if (line.length > 0) {
                        this.logger.warn(`[STDERR line]: ${JSON.stringify(line)}`);
                        onError(line);
                    }
                });

                // Auto-flush stderr too
                if (this.errorBuffer.length > 0) {
                    this.scheduleErrorFlush(onError);
                }
            });

            this.process.on("close", (code) => {
                clearTimeout(timeout);

                // Clear any pending flush timers
                if (this.flushTimer) {
                    clearTimeout(this.flushTimer);
                    this.flushTimer = null;
                }

                // Send any remaining buffered output
                if (this.outputBuffer.trim()) {
                    onOutput(this.outputBuffer.trim(), true);
                }
                if (this.errorBuffer.trim()) {
                    this.logger.warn(`[STDERR final]: ${JSON.stringify(this.errorBuffer)}`);
                    onError(this.errorBuffer.trim());
                }

                if (!this.processKilled) onExit(code);
                this.process = null;
            });
        } catch (err) {
            this.logger.error(`Kompilierfehler oder Timeout: ${err instanceof Error ? err.message : String(err)}`);
            // Nur onError aufrufen wenn es NICHT ein Kompilierungsfehler war
            // Kompilierungsfehler sind bereits über onCompileError gesendet worden
            if (!compilationFailed) {
                onError(err instanceof Error ? err.message : String(err));
            }
            onExit(-1);
            this.process = null;
        }
    }

    // NEW: Schedule auto-flush for stdout
    private scheduleFlush(onOutput: (line: string, isComplete: boolean) => void) {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(() => {
            if (this.outputBuffer.length > 0) {
                onOutput(this.outputBuffer, false);
                this.pendingIncomplete = true; // Mark that we sent incomplete output
                this.outputBuffer = "";
            }
            this.flushTimer = null;
        }, 50);
    }

    // NEW: Schedule auto-flush for stderr
    private scheduleErrorFlush(onError: (line: string) => void) {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(() => {
            if (this.errorBuffer.length > 0) {
                this.logger.warn(`[STDERR auto-flush]: ${JSON.stringify(this.errorBuffer)}`);
                onError(this.errorBuffer);
                this.errorBuffer = "";
            }
            this.flushTimer = null;
        }, 50);
    }

    sendSerialInput(input: string) {
        this.logger.debug(`Serial Input im Runner angekommen: ${input}`);
        if (this.isRunning && this.process && this.process.stdin && !this.process.killed) {
            this.process.stdin.write(input + "\n");
            this.logger.debug(`Serial Input an Sketch gesendet: ${input}`);
        } else {
            this.logger.warn("Simulator läuft nicht - serial input ignored");
        }
    }

    stop() {
        this.isRunning = false;
        this.processKilled = true;

        // Clear flush timer
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
        }

        // Clear buffers
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.pendingIncomplete = false;
    }
}

export const arduinoRunner = new ArduinoRunner();