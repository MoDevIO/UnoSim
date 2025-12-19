//arduino-runner.ts

import { spawn } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ARDUINO_MOCK_CODE } from '../mocks/arduino-mock';


// Simulation config
const MAX_SIMULATED_BAUD = 10000;
const MIN_SEND_INTERVAL_MS = 16; // ~60 updates/sec

function getCharDelayMs(baudrate: number): number {
    if (baudrate <= 300) return 33;
    if (baudrate <= 1200) return 8;
    if (baudrate <= 2400) return 4;
    if (baudrate <= 4800) return 2;
    return 1;
}

export class ArduinoRunner {
    isRunning = false;
    tempDir = join(process.cwd(), "temp");
    process: ReturnType<typeof spawn> | null = null;
    processKilled = false;
    private logger = new Logger("ArduinoRunner");
    private outputChunks: string[] = []; // raw stdout chunks queued
    private outputChunksBytes = 0;
    private outputBuffer = "";
    private errorBuffer = "";  // Buffer für error output
    private baudrate = 9600; // Default baudrate
    private isSendingOutput = false; // Flag to prevent overlapping sends

    constructor() {
        mkdir(this.tempDir, { recursive: true })
            .catch(() => { this.logger.warn("Temp-Verzeichnis konnte nicht initial erstellt werden"); });
    }

    async runSketch(
        code: string,
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void,
        onCompileError?: (error: string) => void,
        onPinState?: (pin: number, type: 'mode' | 'value' | 'pwm', value: number) => void,
        timeoutMs: number = 180000
    ) {


        this.isRunning = true;
        // Reset buffers for new sketch
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.isSendingOutput = false;
        let compilationFailed = false;

        // Parse baudrate from code
        const baudMatch = code.match(/Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/);
        this.baudrate = baudMatch ? parseInt(baudMatch[1]) : 9600;
        this.logger.info(`Parsed baudrate: ${this.baudrate}`);

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
                    onOutput(`--- Simulation timeout (${timeoutMs / 1000}s) ---`, true);
                    this.logger.info(`Sketch timeout after ${timeoutMs / 1000}s`);
                }
            }, timeoutMs);

            // IMPROVED: queue raw stdout chunks and send as blocks
            this.process.stdout?.on("data", (data) => {
                const str = data.toString();
                if (str.length === 0) return;
                this.outputChunks.push(str);
                this.outputChunksBytes += str.length;

                if (!this.isSendingOutput) this.sendNextChunk(onOutput);
            });

            this.process.stderr?.on("data", (data) => {
                const str = data.toString();
                this.errorBuffer += str;

                // Process complete lines immediately
                const lines = this.errorBuffer.split(/\r?\n/);
                this.errorBuffer = lines.pop() || "";

                lines.forEach(line => {
                    if (line.length > 0) {
                        // Check for pin state messages
                        const pinModeMatch = line.match(/\[\[PIN_MODE:(\d+):(\d+)\]\]/);
                        const pinValueMatch = line.match(/\[\[PIN_VALUE:(\d+):(\d+)\]\]/);
                        const pinPwmMatch = line.match(/\[\[PIN_PWM:(\d+):(\d+)\]\]/);
                        
                        if (pinModeMatch && onPinState) {
                            const pin = parseInt(pinModeMatch[1]);
                            const mode = parseInt(pinModeMatch[2]);
                            onPinState(pin, 'mode', mode);
                        } else if (pinValueMatch && onPinState) {
                            const pin = parseInt(pinValueMatch[1]);
                            const value = parseInt(pinValueMatch[2]);
                            onPinState(pin, 'value', value);
                        } else if (pinPwmMatch && onPinState) {
                            const pin = parseInt(pinPwmMatch[1]);
                            const value = parseInt(pinPwmMatch[2]);
                            onPinState(pin, 'pwm', value);
                        } else {
                            // Regular error message
                            this.logger.warn(`[STDERR line]: ${JSON.stringify(line)}`);
                            onError(line);
                        }
                    }
                });
            });

            this.process.on("close", (code) => {
                clearTimeout(timeout);

                // Send any remaining buffered chunks immediately
                    while (this.outputChunks.length > 0) {
                        const chunk = this.outputChunks.shift()!;
                        const clean = chunk.replace(/\r?\n$/, '');
                        const isComplete = /\r?\n$/.test(chunk);
                        if (clean.length > 0) onOutput(clean, isComplete);
                    }
                    // Also flush any legacy outputBuffer if present
                    if (this.outputBuffer && this.outputBuffer.trim()) {
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

    sendSerialInput(input: string) {
        this.logger.debug(`Serial Input im Runner angekommen: ${input}`);
        if (this.isRunning && this.process && this.process.stdin && !this.process.killed) {
            this.process.stdin.write(input + "\n");
            this.logger.debug(`Serial Input an Sketch gesendet: ${input}`);
        } else {
            this.logger.warn("Simulator läuft nicht - serial input ignored");
        }
    }

    // Send next queued chunk (preserve original write boundaries)
    private sendNextChunk(onOutput: (line: string, isComplete?: boolean) => void) {
        if (!this.isRunning || this.outputChunks.length === 0) {
            this.isSendingOutput = false;
            return;
        }

        this.isSendingOutput = true;
        // Pop next chunk and decrement byte counter
        const chunk = this.outputChunks.shift()!;
        this.outputChunksBytes = Math.max(0, this.outputChunksBytes - chunk.length);

        // Coalesce small successive chunks without newlines to reduce frequency
        let coalesced = chunk;
        while (this.outputChunks.length > 0 && coalesced.length < 256) {
            // If we've already gathered a newline, stop coalescing further
            if (/\r?\n/.test(coalesced)) break;
            const peek = this.outputChunks.shift()!;
            this.outputChunksBytes = Math.max(0, this.outputChunksBytes - peek.length);
            coalesced += peek;
        }
        // If coalesced does not contain any newline, buffer it and wait
        if (!/\r?\n/.test(coalesced)) {
            // Put it back at the front of the queue and stop sending
            this.outputChunks.unshift(coalesced);
            this.outputChunksBytes += coalesced.length;
            this.isSendingOutput = false;
            return;
        }

        // coalesced contains at least one newline -> send up to the first newline
        const parts = coalesced.split(/(\r?\n)/);
        let toSend = coalesced;
        let isComplete = false;

        if (parts.length > 1 && (parts[1] === '\n' || parts[1] === '\r\n')) {
            toSend = parts[0];
            isComplete = true;
            const remainder = parts.slice(2).join('');
            if (remainder) {
                this.outputChunks.unshift(remainder);
                this.outputChunksBytes += remainder.length;
            }
        } else {
            isComplete = /\r?\n$/.test(coalesced);
            if (isComplete) toSend = coalesced.replace(/\r?\n$/, '');
        }

        if (toSend.length > 0) onOutput(toSend, isComplete);

        const effectiveBaud = Math.min(this.baudrate, MAX_SIMULATED_BAUD);
        const charDelayMs = getCharDelayMs(effectiveBaud);
        const totalDelay = Math.max(MIN_SEND_INTERVAL_MS, Math.ceil(charDelayMs * Math.max(1, toSend.length)));

        setTimeout(() => {
            this.isSendingOutput = false;
            if (this.outputChunks.length > 0) this.sendNextChunk(onOutput);
        }, totalDelay);
    }

    stop() {
        this.isRunning = false;
        this.processKilled = true;

        if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
        }

        // Clear buffers
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.outputChunks = [];
        this.outputChunksBytes = 0;
        this.isSendingOutput = false;
    }
}

export const arduinoRunner = new ArduinoRunner();