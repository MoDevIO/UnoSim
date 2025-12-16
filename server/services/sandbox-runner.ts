// sandbox-runner.ts
// Secure sandbox execution for Arduino sketches using Docker

import { spawn, execSync } from "child_process";
import { writeFile, mkdir, rm, chmod } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ARDUINO_MOCK_CODE } from '../mocks/arduino-mock';

// Configuration
const SANDBOX_CONFIG = {
    // Docker settings
    dockerImage: 'arduino-sandbox:latest',
    useDocker: false, // Will be set based on availability
    
    // Resource limits
    maxMemoryMB: 128,           // Max 128MB RAM
    maxCpuPercent: 50,          // Max 50% of one CPU
    maxExecutionTimeSec: 60,    // Max 60 seconds runtime
    maxOutputBytes: 1024 * 1024, // Max 1MB output
    
    // Security settings
    noNetwork: true,            // No network access
    readOnlyFs: true,           // Read-only filesystem (except /tmp)
    dropCapabilities: true,     // Drop all Linux capabilities
};

export class SandboxRunner {
    isRunning = false;
    tempDir = join(process.cwd(), "temp");
    process: ReturnType<typeof spawn> | null = null;
    processKilled = false;
    private logger = new Logger("SandboxRunner");
    private outputBuffer = "";
    private errorBuffer = "";
    private flushTimer: NodeJS.Timeout | null = null;
    private pendingIncomplete = false;
    private totalOutputBytes = 0;
    private dockerAvailable = false;
    private dockerImageBuilt = false;
    private currentSketchDir: string | null = null;

    constructor() {
        mkdir(this.tempDir, { recursive: true })
            .catch(() => { this.logger.warn("Temp-Verzeichnis konnte nicht initial erstellt werden"); });
        
        // Check Docker availability on startup
        this.checkDockerAvailability();
    }

    private checkDockerAvailability(): void {
        try {
            // Check if docker command exists AND daemon is running
            execSync('docker --version', { stdio: 'pipe' });
            
            // Test if Docker daemon is actually running by pinging it
            execSync('docker info', { stdio: 'pipe', timeout: 5000 });
            
            this.dockerAvailable = true;
            this.logger.info("✅ Docker Daemon läuft - Sandbox-Modus aktiviert");
            
            // Check if our sandbox image exists
            try {
                execSync(`docker image inspect ${SANDBOX_CONFIG.dockerImage}`, { stdio: 'pipe' });
                this.dockerImageBuilt = true;
                this.logger.info("✅ Sandbox Docker Image gefunden");
            } catch {
                this.dockerImageBuilt = false;
                this.logger.warn("⚠️ Sandbox Docker Image nicht gefunden - führe 'npm run build:sandbox' aus");
            }
        } catch {
            this.dockerAvailable = false;
            this.dockerImageBuilt = false;
            this.logger.warn("⚠️ Docker nicht verfügbar oder Daemon nicht gestartet - Fallback auf lokale Ausführung");
        }
    }

    async runSketch(
        code: string,
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void,
        onCompileError?: (error: string) => void
    ) {
        this.isRunning = true;
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.pendingIncomplete = false;
        this.totalOutputBytes = 0;
        let compilationFailed = false;

        const sketchId = randomUUID();
        const sketchDir = join(this.tempDir, sketchId);
        const sketchFile = join(sketchDir, `sketch.cpp`);
        const exeFile = join(sketchDir, `sketch`);

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

            // Store sketchDir for cleanup in close handler
            this.currentSketchDir = sketchDir;
            this.processKilled = false;
            
            if (this.dockerAvailable && this.dockerImageBuilt) {
                // Single container: compile AND run (more efficient)
                this.compileAndRunInDocker(sketchDir, onOutput, onError, onExit, onCompileError);
            } else {
                // Local fallback: compile then run
                await this.compileLocal(sketchFile, exeFile, onCompileError);
                await this.runLocalWithLimits(exeFile, onOutput, onError, onExit);
            }
            
            // Note: Don't cleanup here - cleanup happens in close handler

        } catch (err) {
            this.logger.error(`Kompilierfehler oder Timeout: ${err instanceof Error ? err.message : String(err)}`);
            compilationFailed = true;
            if (onCompileError && !compilationFailed) {
                onError(err instanceof Error ? err.message : String(err));
            }
            onExit(-1);
            this.process = null;
            
            // Cleanup on error
            try {
                await rm(sketchDir, { recursive: true, force: true });
            } catch {
                this.logger.warn(`Konnte temp Verzeichnis nicht löschen: ${sketchDir}`);
            }
        }
    }

    /**
     * Combined compile and run in a single Docker container.
     * This is more efficient than spawning two separate containers.
     */
    private compileAndRunInDocker(
        sketchDir: string,
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void,
        onCompileError?: (error: string) => void
    ): void {
        // Single container: compile then run using shell
        // Uses sh -c to chain compile && run in one container
        this.process = spawn("docker", [
            "run",
            "--rm",
            "-i",                                       // Interactive for stdin
            "--network", "none",                        // No network access
            "--memory", `${SANDBOX_CONFIG.maxMemoryMB}m`,
            "--memory-swap", `${SANDBOX_CONFIG.maxMemoryMB}m`, // No swap
            "--cpus", "0.5",
            "--pids-limit", "50",                       // Limit processes
            "--security-opt", "no-new-privileges",      // No privilege escalation
            "--cap-drop", "ALL",                        // Drop all capabilities
            "-v", `${sketchDir}:/sandbox:rw`,           // Mount as read-write for compilation
            SANDBOX_CONFIG.dockerImage,
            "sh", "-c",
            "g++ /sandbox/sketch.cpp -o /tmp/sketch -pthread 2>&1 && /tmp/sketch"
        ]);

        this.logger.info("🚀 Docker: Compile + Run in single container");
        
        let compileErrorBuffer = "";
        let isCompilePhase = true;
        
        // Custom handler for combined compile+run
        const timeout = setTimeout(() => {
            if (this.process) {
                this.process.kill('SIGKILL');
                onError(`Timeout nach ${SANDBOX_CONFIG.maxExecutionTimeSec}s`);
                this.logger.error(`Docker Timeout nach ${SANDBOX_CONFIG.maxExecutionTimeSec}s`);
            }
        }, SANDBOX_CONFIG.maxExecutionTimeSec * 1000);

        this.process?.stdout?.on("data", (data) => {
            const str = data.toString();
            
            // After successful compile, we get program output
            isCompilePhase = false;
            
            // Check output size limit
            this.totalOutputBytes += str.length;
            if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
                this.stop();
                onError("Output size limit exceeded (1MB)");
                return;
            }

            this.outputBuffer += str;
            const lines = this.outputBuffer.split(/\r?\n/);
            this.outputBuffer = lines.pop() || "";

            lines.forEach(line => {
                if (line.length > 0) {
                    if (this.pendingIncomplete) {
                        onOutput(line, true);
                        this.pendingIncomplete = false;
                    } else {
                        onOutput(line, true);
                    }
                }
            });

            if (this.outputBuffer.length > 0) {
                this.scheduleFlush(onOutput);
            } else if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
        });

        this.process?.stderr?.on("data", (data) => {
            const str = data.toString();
            
            // During compile phase, collect errors
            if (isCompilePhase) {
                compileErrorBuffer += str;
            }
            
            this.errorBuffer += str;
            const lines = this.errorBuffer.split(/\r?\n/);
            this.errorBuffer = lines.pop() || "";

            lines.forEach(line => {
                if (line.length > 0) {
                    this.logger.warn(`[STDERR line]: ${JSON.stringify(line)}`);
                    onError(line);
                }
            });

            if (this.errorBuffer.length > 0) {
                this.scheduleErrorFlush(onError);
            }
        });

        this.process?.on("close", (code) => {
            clearTimeout(timeout);

            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }

            // If we exited with error during compile phase
            if (code !== 0 && isCompilePhase && compileErrorBuffer && onCompileError) {
                onCompileError(this.cleanCompilerErrors(compileErrorBuffer));
            } else {
                if (code === 0) {
                    this.logger.info("✅ Docker: Compile + Run erfolgreich");
                }
            }

            if (this.outputBuffer.trim()) {
                onOutput(this.outputBuffer.trim(), true);
            }
            if (this.errorBuffer.trim()) {
                this.logger.warn(`[STDERR final]: ${JSON.stringify(this.errorBuffer)}`);
                onError(this.errorBuffer.trim());
            }

            if (!this.processKilled) onExit(code);
            this.process = null;
            this.isRunning = false;
            
            // Cleanup temp directory after process finishes
            if (this.currentSketchDir) {
                rm(this.currentSketchDir, { recursive: true, force: true })
                    .catch(() => { /* ignore cleanup errors */ });
                this.currentSketchDir = null;
            }
        });
    }

    private async compileLocal(
        sketchFile: string,
        exeFile: string,
        onCompileError?: (error: string) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const compile = spawn("g++", [sketchFile, "-o", exeFile, "-pthread"]);
            let errorOutput = "";
            let completed = false;

            compile.stderr.on("data", d => { errorOutput += d.toString(); });

            compile.on("close", (code) => {
                completed = true;
                if (code === 0) {
                    resolve();
                } else {
                    this.logger.error(`Compiler Fehler (Code ${code}): ${errorOutput}`);
                    if (onCompileError) {
                        onCompileError(this.cleanCompilerErrors(errorOutput));
                    }
                    reject(new Error(errorOutput));
                }
            });

            compile.on("error", err => {
                completed = true;
                this.logger.error(`Compilerprozess Fehler: ${err.message}`);
                if (onCompileError) {
                    onCompileError(`Compilerprozess Fehler: ${err.message}`);
                }
                reject(err);
            });

            setTimeout(() => {
                if (!completed) {
                    compile.kill('SIGKILL');
                    this.logger.error("g++ Timeout nach 10s");
                    if (onCompileError) {
                        onCompileError("g++ timeout after 10s");
                    }
                    reject(new Error("g++ timeout after 10s"));
                }
            }, 10000);
        });
    }

    private async runLocalWithLimits(
        exeFile: string,
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void
    ): Promise<void> {
        // Make executable
        await chmod(exeFile, 0o755);
        
        // Run with local limits (less secure, but better than nothing)
        // On macOS, we use basic timeout; on Linux we could use cgroups
        const isLinux = process.platform === 'linux';
        
        if (isLinux) {
            // Use timeout and nice for basic limits
            this.process = spawn("timeout", [
                `${SANDBOX_CONFIG.maxExecutionTimeSec}s`,
                "nice", "-n", "19",  // Lowest priority
                exeFile
            ]);
        } else {
            // macOS - just run with timeout
            this.process = spawn(exeFile);
        }

        this.setupProcessHandlers(onOutput, onError, onExit);
    }

    private setupProcessHandlers(
        onOutput: (line: string, isComplete?: boolean) => void,
        onError: (line: string) => void,
        onExit: (code: number | null) => void
    ): void {
        const timeout = setTimeout(() => {
            if (this.process) {
                this.process.kill('SIGKILL');
                onError(`Sketch runtime timeout (${SANDBOX_CONFIG.maxExecutionTimeSec}s)`);
                this.logger.error(`Sketch Ausführung Timeout nach ${SANDBOX_CONFIG.maxExecutionTimeSec}s`);
            }
        }, SANDBOX_CONFIG.maxExecutionTimeSec * 1000);

        this.process?.stdout?.on("data", (data) => {
            const str = data.toString();
            
            // Check output size limit
            this.totalOutputBytes += str.length;
            if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
                this.stop();
                onError("Output size limit exceeded (1MB)");
                return;
            }

            this.outputBuffer += str;
            const lines = this.outputBuffer.split(/\r?\n/);
            this.outputBuffer = lines.pop() || "";

            lines.forEach(line => {
                if (line.length > 0) {
                    if (this.pendingIncomplete) {
                        onOutput(line, true);
                        this.pendingIncomplete = false;
                    } else {
                        onOutput(line, true);
                    }
                }
            });

            if (this.outputBuffer.length > 0) {
                this.scheduleFlush(onOutput);
            } else if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
        });

        this.process?.stderr?.on("data", (data) => {
            const str = data.toString();
            this.errorBuffer += str;
            const lines = this.errorBuffer.split(/\r?\n/);
            this.errorBuffer = lines.pop() || "";

            lines.forEach(line => {
                if (line.length > 0) {
                    this.logger.warn(`[STDERR line]: ${JSON.stringify(line)}`);
                    onError(line);
                }
            });

            if (this.errorBuffer.length > 0) {
                this.scheduleErrorFlush(onError);
            }
        });

        this.process?.on("close", (code) => {
            clearTimeout(timeout);

            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }

            if (this.outputBuffer.trim()) {
                onOutput(this.outputBuffer.trim(), true);
            }
            if (this.errorBuffer.trim()) {
                this.logger.warn(`[STDERR final]: ${JSON.stringify(this.errorBuffer)}`);
                onError(this.errorBuffer.trim());
            }

            if (!this.processKilled) onExit(code);
            this.process = null;
            this.isRunning = false;
            
            // Cleanup temp directory after process finishes
            if (this.currentSketchDir) {
                rm(this.currentSketchDir, { recursive: true, force: true })
                    .catch(() => { /* ignore cleanup errors */ });
                this.currentSketchDir = null;
            }
        });
    }

    private cleanCompilerErrors(errors: string): string {
        // Remove full paths from error messages
        return errors
            .replace(/\/sandbox\/sketch\.cpp/g, 'sketch.ino')
            .replace(/\/[^\s:]+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, 'sketch.ino')
            .trim();
    }

    private scheduleFlush(onOutput: (line: string, isComplete: boolean) => void) {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(() => {
            if (this.outputBuffer.length > 0) {
                onOutput(this.outputBuffer, false);
                this.pendingIncomplete = true;
                this.outputBuffer = "";
            }
            this.flushTimer = null;
        }, 50);
    }

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

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
        }

        // Cleanup temp directory
        if (this.currentSketchDir) {
            rm(this.currentSketchDir, { recursive: true, force: true })
                .catch(() => { /* ignore cleanup errors */ });
            this.currentSketchDir = null;
        }

        this.outputBuffer = "";
        this.errorBuffer = "";
        this.pendingIncomplete = false;
    }

    // Public method to check sandbox status
    getSandboxStatus(): { dockerAvailable: boolean; dockerImageBuilt: boolean; mode: string } {
        return {
            dockerAvailable: this.dockerAvailable,
            dockerImageBuilt: this.dockerImageBuilt,
            mode: (this.dockerAvailable && this.dockerImageBuilt) ? 'docker-sandbox' : 'local-limited'
        };
    }
}

export const sandboxRunner = new SandboxRunner();
