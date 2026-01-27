// sandbox-runner.ts
// Secure sandbox execution for Arduino sketches using Docker

import { spawn, execSync } from "child_process";
import { writeFile, mkdir, rm, chmod } from "fs/promises";
import { existsSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import { ARDUINO_MOCK_CODE } from "../mocks/arduino-mock";
import type { IOPinRecord } from "@shared/schema";

// Configuration
const SANDBOX_CONFIG = {
  // Docker settings
  dockerImage: "arduino-sandbox:latest",
  useDocker: false, // Will be set based on availability

  // Resource limits
  maxMemoryMB: 128, // Max 128MB RAM
  maxCpuPercent: 50, // Max 50% of one CPU
  maxExecutionTimeSec: 60, // Max 60 seconds runtime
  maxOutputBytes: 100 * 1024 * 1024, // Max 100MB output

  // Security settings
  noNetwork: true, // No network access
  readOnlyFs: true, // Read-only filesystem (except /tmp)
  dropCapabilities: true, // Drop all Linux capabilities
};

export class SandboxRunner {
  isRunning = false;
  tempDir = join(process.cwd(), "temp");
  process: ReturnType<typeof spawn> | null = null;
  processKilled = false;
  isPaused = false;
  private logger = new Logger("SandboxRunner");
  private outputBuffer = "";
  private errorBuffer = "";
  private totalOutputBytes = 0;
  private dockerAvailable = false;
  private dockerImageBuilt = false;
  private currentSketchDir: string | null = null;
  private baudrate = 9600; // Default baudrate
  private isSendingOutput = false; // Flag to prevent overlapping sends
  private flushTimer: NodeJS.Timeout | null = null;
  private pendingIncomplete = false;
  // Buffer for coalescing SERIAL_EVENTs emitted by the C++ mock
  private pendingSerialEvents: Array<any> = [];
  private pendingSerialFlushTimer: NodeJS.Timeout | null = null;
  // Server-side timestamp of when the spawned process was started (ms since epoch)
  private processStartTime: number | null = null;
  private ioRegistryCallback: ((registry: IOPinRecord[]) => void) | undefined;
  // Runtime I/O Registry collected from stderr
  private ioRegistryData: IOPinRecord[] = [];
  private collectingRegistry = false;
  private currentRegistryFile: string | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private timeoutDeadlineMs: number | null = null;
  private pausedTimeoutRemainingMs: number | null = null;
  private timeoutCallback: (() => void) | null = null;
  // Stored onOutput callback for resume functionality
  private onOutputCallback: ((line: string, isComplete?: boolean) => void) | null = null;

  constructor() {
    mkdir(this.tempDir, { recursive: true }).catch(() => {
      this.logger.warn("Temp-Verzeichnis konnte nicht initial erstellt werden");
    });

    // Check Docker availability on startup
    this.checkDockerAvailability();
  }

  private flushPendingSerialEvents(
    onOutput: (line: string, isComplete?: boolean) => void,
  ) {
    if (this.pendingSerialEvents.length === 0) return;

    // Sort by ts_write to ensure chronological order
    const events = this.pendingSerialEvents
      .slice()
      .sort((a, b) => (a.ts_write || 0) - (b.ts_write || 0));

    // Send each event individually to preserve backspace semantics
    // (Backspace at start of a chunk should apply to previous output)
    for (const event of events) {
      try {
        onOutput(
          "[[" + "SERIAL_EVENT_JSON:" + JSON.stringify(event) + "]]",
          true,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send serial event: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Clear pending buffer
    this.pendingSerialEvents = [];
  }

  private checkDockerAvailability(): void {
    try {
      // Check if docker command exists AND daemon is running
      execSync("docker --version", { stdio: "pipe" });

      // Test if Docker daemon is actually running by pinging it
      execSync("docker info", { stdio: "pipe", timeout: 5000 });

      this.dockerAvailable = true;
      this.logger.info("✅ Docker daemon running — Sandbox mode enabled");

      // Check if our sandbox image exists
      try {
        execSync(`docker image inspect ${SANDBOX_CONFIG.dockerImage}`, {
          stdio: "pipe",
        });
        this.dockerImageBuilt = true;
        this.logger.info("✅ Sandbox Docker Image gefunden");
      } catch {
        this.dockerImageBuilt = false;
        this.logger.warn(
          "⚠️ Sandbox Docker image not found — run 'npm run build:sandbox'",
        );
      }
    } catch {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      this.logger.warn(
        "⚠️ Docker not available or daemon not started — falling back to local execution",
      );
    }
  }

  private clearTimeoutTimer() {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.timeoutDeadlineMs = null;
  }

  private scheduleTimeoutMs(
    ms: number | null,
    onTimeout: () => void,
  ): void {
    this.clearTimeoutTimer();
    this.timeoutCallback = null;

    if (ms === null || ms <= 0) {
      return;
    }

    this.timeoutCallback = onTimeout;
    this.timeoutDeadlineMs = Date.now() + ms;
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      this.timeoutDeadlineMs = null;
      this.timeoutCallback = null;
      onTimeout();
    }, ms);
  }

  private pauseTimeoutClock() {
    if (this.timeoutHandle && this.timeoutDeadlineMs) {
      this.pausedTimeoutRemainingMs = Math.max(
        0,
        this.timeoutDeadlineMs - Date.now(),
      );
      this.clearTimeoutTimer();
    }
  }

  private resumeTimeoutClock() {
    if (
      this.pausedTimeoutRemainingMs !== null &&
      this.timeoutCallback !== null
    ) {
      const remainingMs = Math.max(0, this.pausedTimeoutRemainingMs);
      this.pausedTimeoutRemainingMs = null;
      this.scheduleTimeoutMs(remainingMs, this.timeoutCallback);
    }
  }

  async runSketch(
    code: string,
    onOutput: (line: string, isComplete?: boolean) => void,
    onError: (line: string) => void,
    onExit: (code: number | null) => void,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
    timeoutSec?: number, // Custom timeout in seconds, 0 = infinite
    onIORegistry?: (registry: IOPinRecord[]) => void,
  ) {
    // Store callback in local var for access in closures below
    this.ioRegistryCallback = onIORegistry;
    // Use custom timeout or default
    const executionTimeout =
      timeoutSec !== undefined
        ? timeoutSec
        : SANDBOX_CONFIG.maxExecutionTimeSec;
    this.logger.info(
      `🕐 runSketch called with timeoutSec=${timeoutSec}, using executionTimeout=${executionTimeout}s`,
    );

    this.isRunning = true;
    this.isPaused = false;
    this.ioRegistryData = []; // Reset registry
    this.collectingRegistry = false;
    this.outputBuffer = "";
    this.errorBuffer = "";
    this.isSendingOutput = false;
    this.totalOutputBytes = 0;
    this.onOutputCallback = onOutput; // Store for resume functionality
    let compilationFailed = false;

    // Parse baudrate from code
    const baudMatch = code.match(/Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/);
    this.baudrate = baudMatch ? parseInt(baudMatch[1]) : 9600;
    this.logger.info(`Parsed baudrate: ${this.baudrate}`);

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
    initIORegistry();
    std::thread readerThread(serialInputReader);
    readerThread.detach();
`;

    if (hasSetup)
      footer +=
        "    setup();\n    Serial.flush(); // Flush after setup\n    outputIORegistry(); // Emit registry after setup before entering loop\n";
    // Flush serial buffer at the start of each loop iteration
    // This ensures all Serial.print() output is sent even without delay() or newline
    if (hasLoop) footer += "    while (1) { Serial.flush(); loop(); }\n";

    footer += `
    keepReading.store(false);
    outputIORegistry();
    return 0;
}
`;

    if (!hasSetup && !hasLoop) {
      this.logger.warn(
        "Weder setup() noch loop() gefunden - Code wird nur als Bibliothek kompiliert",
      );
    }

    try {
      await mkdir(sketchDir, { recursive: true });

      // Remove Arduino.h include to avoid compilation errors in GCC
      const cleanedCode = code.replace(/#include\s*[<"]Arduino\.h[>"]/g, "");
      const combined = `${ARDUINO_MOCK_CODE}\n// --- User code follows ---\n${cleanedCode}\n\n// --- Footer ---\n${footer}`;
      await writeFile(sketchFile, combined);

      // Store sketchDir for cleanup in close handler
      this.currentSketchDir = sketchDir;
      this.processKilled = false;

      if (this.dockerAvailable && this.dockerImageBuilt) {
        // Single container: compile AND run (more efficient)
        this.compileAndRunInDocker(
          sketchDir,
          onOutput,
          onError,
          onExit,
          onCompileError,
          onCompileSuccess,
          onPinState,
          executionTimeout,
          onIORegistry,
        );
      } else {
        // Local fallback: compile then run
        await this.compileLocal(sketchFile, exeFile, onCompileError);
        // If we get here, compilation was successful
        if (onCompileSuccess) {
          onCompileSuccess();
        }
        await this.runLocalWithLimits(
          exeFile,
          onOutput,
          onError,
          onExit,
          onPinState,
          executionTimeout,
          onIORegistry,
        );
      }

      // Note: Don't cleanup here - cleanup happens in close handler
    } catch (err) {
      this.logger.error(
        `Kompilierfehler oder Timeout: ${err instanceof Error ? err.message : String(err)}`,
      );
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
        this.logger.warn(`Could not delete temp directory: ${sketchDir}`);
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
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
    timeoutSec?: number,
    onIORegistry?: (registry: IOPinRecord[]) => void,
  ): void {
    this.ioRegistryCallback = onIORegistry;
    // Single container: compile then run using shell
    // Uses sh -c to chain compile && run in one container
    this.process = spawn("docker", [
      "run",
      "--rm",
      "-i", // Interactive for stdin
      "--network",
      "none", // No network access
      "--memory",
      `${SANDBOX_CONFIG.maxMemoryMB}m`,
      "--memory-swap",
      `${SANDBOX_CONFIG.maxMemoryMB}m`, // No swap
      "--cpus",
      "0.5",
      "--pids-limit",
      "50", // Limit processes
      "--security-opt",
      "no-new-privileges", // No privilege escalation
      "--cap-drop",
      "ALL", // Drop all capabilities
      "-v",
      `${sketchDir}:/sandbox:rw`, // Mount as read-write for compilation
      SANDBOX_CONFIG.dockerImage,
      "sh",
      "-c",
      "g++ /sandbox/sketch.cpp -o /tmp/sketch -pthread 2>&1 && /tmp/sketch",
    ]);

    this.logger.info("🚀 Docker: Compile + Run in single container");
    // Record server-side absolute start time for the spawned process so we can convert C++ millis()
    this.processStartTime = Date.now();

    let compileErrorBuffer = "";
    let isCompilePhase = true;
    let compileSuccessSent = false;
    const effectiveTimeout =
      timeoutSec !== undefined
        ? timeoutSec
        : SANDBOX_CONFIG.maxExecutionTimeSec;

    // Custom handler for combined compile+run
    // Only set timeout if not infinite (0)
    const handleTimeout = () => {
      if (this.process) {
        this.process.kill("SIGKILL");
        onOutput(`--- Simulation timeout (${effectiveTimeout}s) ---`, true);
        this.logger.info(`Docker timeout after ${effectiveTimeout}s`);
      }
    };

    this.scheduleTimeoutMs(
      effectiveTimeout > 0 ? effectiveTimeout * 1000 : null,
      handleTimeout,
    );

    // Handle process errors
    this.process?.on("error", (err) => {
      this.logger.error(`Docker process error: ${err.message}`);
      onError(`Docker process failed: ${err.message}`);
    });

    this.process?.stdout?.on("data", (data) => {
      const str = data.toString();

      // After successful compile, we get program output
      if (isCompilePhase) {
        isCompilePhase = false;
        // First output means compilation was successful
        if (!compileSuccessSent && onCompileSuccess) {
          compileSuccessSent = true;
          onCompileSuccess();
        }
      }

      // Check output size limit
      this.totalOutputBytes += str.length;
      if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        this.stop();
        onError("Output size limit exceeded");
        return;
      }

      this.outputBuffer += str;
      const lines = this.outputBuffer.split(/\r?\n/);
      this.outputBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length > 0) {
          if (this.pendingIncomplete) {
            onOutput(line, true);
            this.pendingIncomplete = false;
          } else {
            onOutput(line, true);
          }
        }
      });

      // Schedule flush for incomplete output based on baudrate
      if (this.outputBuffer.length > 0 && !this.flushTimer) {
        this.scheduleFlush(onOutput);
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

      lines.forEach((line) => {
        if (line.length > 0) {
          // Check for I/O Registry markers
          if (line.includes("[[IO_REGISTRY_START]]")) {
            this.logger.debug("[Registry] START marker detected (Docker)");
            this.collectingRegistry = true;
            this.ioRegistryData = [];
            return;
          }
          if (line.includes("[[IO_REGISTRY_END]]")) {
            this.logger.debug(
              `[Registry] END marker detected, collected ${this.ioRegistryData.length} pins (Docker)`,
            );
            this.collectingRegistry = false;
            if (this.ioRegistryCallback) {
              this.ioRegistryCallback(this.ioRegistryData);
            }
            return;
          }
          if (this.collectingRegistry) {
            // Parse IO_PIN line: [[IO_PIN:pin:defined:line:pinMode:operations]]
            const pinMatch = line.match(
              /\[\[IO_PIN:([^:]+):([01]):(\d+):(\d+):?(.*)\]\]/,
            );
            if (pinMatch) {
              this.logger.debug(
                `[Registry] Parsed pin: ${pinMatch[1]} (Docker)`,
              );
              const pin = pinMatch[1];
              const defined = pinMatch[2] === "1";
              const definedLine = parseInt(pinMatch[3]);
              const pinModeParsed = parseInt(pinMatch[4]);
              const operationsStr = pinMatch[5];

              const usedAt: Array<{ line: number; operation: string }> = [];
              if (operationsStr) {
                // Split by ':' to get individual operations (e.g., "pinMode:1@0:digitalWrite@5")
                // But we need to handle "pinMode:1" as one unit, so we match operation@line pairs
                const opMatches = operationsStr.match(/([^:@]+(?::\d+)?@\d+)/g);
                if (opMatches) {
                  opMatches.forEach((opMatch) => {
                    const atIndex = opMatch.lastIndexOf("@");
                    if (atIndex > 0) {
                      const operation = opMatch.substring(0, atIndex);
                      const lineStr = opMatch.substring(atIndex + 1);
                      usedAt.push({
                        line: parseInt(lineStr) || 0,
                        operation,
                      });
                    }
                  });
                }
              }

              this.ioRegistryData.push({
                pin,
                defined,
                pinMode: pinModeParsed,
                definedAt: defined ? { line: definedLine } : undefined,
                usedAt,
              });
            }
            return;
          }

          // Check for pin state messages (these are internal protocol, not errors)
          const pinModeMatch = line.match(/\[\[PIN_MODE:(\d+):(\d+)\]\]/);
          const pinValueMatch = line.match(/\[\[PIN_VALUE:(\d+):(\d+)\]\]/);
          const pinPwmMatch = line.match(/\[\[PIN_PWM:(\d+):(\d+)\]\]/);
          const dreadMatch = line.match(/\[\[DREAD:(\d+):(\d+)\]\]/);
          const pinSetMatch = line.match(/\[\[PIN_SET:(\d+):(\d+)\]\]/);
          const stdinRecvMatch = line.match(/\[\[STDIN_RECV:(.+)\]\]/);

          if (pinModeMatch) {
            // PIN_MODE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinModeMatch[1]);
              const mode = parseInt(pinModeMatch[2]);
              onPinState(pin, "mode", mode);
            }
          } else if (pinValueMatch) {
            // PIN_VALUE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinValueMatch[1]);
              const value = parseInt(pinValueMatch[2]);
              onPinState(pin, "value", value);
            }
          } else if (pinPwmMatch) {
            // PIN_PWM is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinPwmMatch[1]);
              const value = parseInt(pinPwmMatch[2]);
              onPinState(pin, "pwm", value);
            }
          } else if (dreadMatch || pinSetMatch) {
            // debug - don't send to client
          } else if (stdinRecvMatch) {
            // stdin received confirmation - log to server
            this.logger.info(`[C++ STDIN RECV] ${stdinRecvMatch[1]}`);
          } else {
            // New: detect structured serial events emitted by the mock
            const serialEventMatch = line.match(
              /\[\[SERIAL_EVENT:(\d+):([A-Za-z0-9+/=]+)\]\]/,
            );
            if (serialEventMatch) {
              try {
                const ts = parseInt(serialEventMatch[1], 10);
                const b64 = serialEventMatch[2];
                const buf = Buffer.from(b64, "base64");
                const decoded = buf.toString("utf8");
                // Build event payload for frontend reconstruction
                const event = {
                  type: "serial",
                  ts_write: (this.processStartTime || Date.now()) + ts,
                  data: decoded,
                  baud: this.baudrate,
                  bits_per_frame: 10,
                  txBufferBefore: this.outputBuffer.length,
                  txBufferCapacity: 1000,
                  blocking: true,
                  atomic: true,
                };
                // Send events immediately - no coalescing needed
                // The frontend will handle timing based on ts_write
                this.logger.debug(
                  `[SERIAL_EVENT RECEIVED] ts=${event.ts_write} len=${(event.data || "").length} data="${event.data?.replace(/[\x00-\x1f]/g, (c: string) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"))}"`,
                );

                // Send immediately without buffering
                try {
                  onOutput(
                    "[[" + "SERIAL_EVENT_JSON:" + JSON.stringify(event) + "]]",
                    true,
                  );
                } catch (err) {
                  this.logger.warn(
                    `Failed to send serial event: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              } catch (e) {
                this.logger.warn(
                  `Failed to parse SERIAL_EVENT: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            } else {
              // Only log and send actual errors, not protocol messages
              this.logger.warn(`[STDERR]: ${line}`);
              onError(line);
            }
          }
        }
      });

      if (this.errorBuffer.length > 0) {
        this.scheduleErrorFlush(onError, onPinState);
      }
    });

    this.process?.on("close", (code) => {
      this.clearTimeoutTimer();
      this.timeoutCallback = null;
      this.pausedTimeoutRemainingMs = null;
      this.isPaused = false;

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      // Flush any pending serial events before closing
      if (this.pendingSerialFlushTimer) {
        clearTimeout(this.pendingSerialFlushTimer);
        this.pendingSerialFlushTimer = null;
      }
      this.flushPendingSerialEvents(onOutput);

      // If we exited with error during compile phase
      if (
        code !== 0 &&
        isCompilePhase &&
        compileErrorBuffer &&
        onCompileError
      ) {
        onCompileError(this.cleanCompilerErrors(compileErrorBuffer));
      } else {
        if (code === 0) {
          this.logger.info("✅ Docker: Compile + Run erfolgreich");
          // For programs without output, signal compile success on exit
          if (!compileSuccessSent && onCompileSuccess) {
            compileSuccessSent = true;
            onCompileSuccess();
          }
        }
      }

      if (this.outputBuffer.trim()) {
        onOutput(this.outputBuffer.trim(), true);
      }
      if (this.errorBuffer.trim()) {
        this.logger.warn(`[STDERR final]: ${JSON.stringify(this.errorBuffer)}`);
        onError(this.errorBuffer.trim());
      }

      // Guarantee that onIORegistry is called with final registry state BEFORE onExit
      // This ensures tests receive registry data even if process terminates before IO_REGISTRY_END marker
      // Call even if registry is empty - tests need to know registry collection completed
      if (this.ioRegistryCallback) {
        this.ioRegistryCallback(this.ioRegistryData);
      }

      if (!this.processKilled) onExit(code);
      this.process = null;
      this.isRunning = false;

      // Mark temp directory for delayed cleanup instead of immediate deletion
      this.markTempDirForCleanup();
    });
  }

  private async compileLocal(
    sketchFile: string,
    exeFile: string,
    onCompileError?: (error: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const compile = spawn("g++", [sketchFile, "-o", exeFile, "-pthread"]);
      let errorOutput = "";
      let completed = false;

      compile.stderr.on("data", (d) => {
        errorOutput += d.toString();
      });

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

      compile.on("error", (err) => {
        completed = true;
        this.logger.error(`Compilerprozess Fehler: ${err.message}`);
        if (onCompileError) {
          onCompileError(`Compilerprozess Fehler: ${err.message}`);
        }
        reject(err);
      });

      setTimeout(() => {
        if (!completed) {
          compile.kill("SIGKILL");
          this.logger.error("g++ Timeout nach 20s");
          if (onCompileError) {
            onCompileError("g++ timeout after 20s");
          }
          reject(new Error("g++ timeout after 20s"));
        }
      }, 20000); // 20s timeout for cold start compilation
    });
  }

  private async runLocalWithLimits(
    exeFile: string,
    onOutput: (line: string, isComplete?: boolean) => void,
    onError: (line: string) => void,
    onExit: (code: number | null) => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
    timeoutSec?: number,
    onIORegistry?: (registry: IOPinRecord[]) => void,
  ): Promise<void> {
    this.ioRegistryCallback = onIORegistry; // Store for use in async handlers
    const effectiveTimeout =
      timeoutSec !== undefined
        ? timeoutSec
        : SANDBOX_CONFIG.maxExecutionTimeSec;

    // Make executable
    await chmod(exeFile, 0o755);

    // Run with local limits (less secure, but better than nothing)
    // On macOS, we use basic timeout; on Linux we could use cgroups
    const isLinux = process.platform === "linux";

    if (isLinux && effectiveTimeout > 0) {
      // Use timeout and nice for basic limits
      this.process = spawn("timeout", [
        `${effectiveTimeout}s`,
        "nice",
        "-n",
        "19", // Lowest priority
        exeFile,
      ]);
      this.processStartTime = Date.now();
    } else {
      // macOS or infinite timeout - just run
      this.process = spawn(exeFile);
      this.processStartTime = Date.now();
    }

    this.setupProcessHandlers(
      onOutput,
      onError,
      onExit,
      onPinState,
      effectiveTimeout,
    );
  }

  private setupProcessHandlers(
    onOutput: (line: string, isComplete?: boolean) => void,
    onError: (line: string) => void,
    onExit: (code: number | null) => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
    timeoutSec?: number,
  ): void {
    const effectiveTimeout =
      timeoutSec !== undefined
        ? timeoutSec
        : SANDBOX_CONFIG.maxExecutionTimeSec;

    // Only set timeout if not infinite (0)
    const handleTimeout = () => {
      if (this.process) {
        this.process.kill("SIGKILL");
        onOutput(`--- Simulation timeout (${effectiveTimeout}s) ---`, true);
        this.logger.info(`Sketch timeout after ${effectiveTimeout}s`);
      }
    };

    this.scheduleTimeoutMs(
      effectiveTimeout > 0 ? effectiveTimeout * 1000 : null,
      handleTimeout,
    );

    // Handle process errors
    this.process?.on("error", (err) => {
      this.logger.error(`Process error: ${err.message}`);
      onError(`Process failed: ${err.message}`);
    });

    this.process?.stdout?.on("data", (data) => {
      const str = data.toString();

      // Check output size limit
      this.totalOutputBytes += str.length;
      if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        this.stop();
        onError("Output size limit exceeded");
        return;
      }

      // Limit buffer size to simulate blocking Serial output
      // If buffer is too full, discard new data (simulates waiting for transmission)
      if (this.outputBuffer.length < 1000) {
        this.outputBuffer += str;
      } // Else discard to prevent unlimited buffering

      if (!this.isSendingOutput) {
        this.sendOutputWithDelay(onOutput);
      }
    });

    this.process?.stderr?.on("data", (data) => {
      const str = data.toString();
      this.errorBuffer += str;
      const lines = this.errorBuffer.split(/\r?\n/);
      this.errorBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length > 0) {
          // Check for I/O Registry markers
          if (line.includes("[[IO_REGISTRY_START]]")) {
            this.logger.debug("[Registry] START marker detected (Local)");
            this.collectingRegistry = true;
            this.ioRegistryData = [];
            return;
          }
          if (line.includes("[[IO_REGISTRY_END]]")) {
            this.logger.debug(
              `[Registry] END marker detected, collected ${this.ioRegistryData.length} pins (Local)`,
            );
            this.collectingRegistry = false;
            if (this.ioRegistryCallback) {
              this.ioRegistryCallback(this.ioRegistryData);
            }
            return;
          }
          if (this.collectingRegistry) {
            this.logger.debug(
              `[Registry] Collecting line: ${line.substring(0, 50)}...`,
            );
            // Parse IO_PIN line: [[IO_PIN:pin:defined:line:pinMode:operations]]
            const pinMatch = line.match(
              /\[\[IO_PIN:([^:]+):([01]):(\d+):(\d+):?(.*)\]\]/,
            );
            if (pinMatch) {
              const pin = pinMatch[1];
              const defined = pinMatch[2] === "1";
              const definedLine = parseInt(pinMatch[3]);
              const pinModeParsed = parseInt(pinMatch[4]);
              const operationsStr = pinMatch[5];

              const usedAt: Array<{ line: number; operation: string }> = [];
              if (operationsStr) {
                // Split by ':' to get individual operations (e.g., "pinMode:1@0:digitalWrite@5")
                // But we need to handle "pinMode:1" as one unit, so we match operation@line pairs
                const opMatches = operationsStr.match(/([^:@]+(?::\d+)?@\d+)/g);
                if (opMatches) {
                  opMatches.forEach((opMatch) => {
                    if (opMatch && !opMatch.startsWith("_count")) {
                      // Skip metadata like _count
                      const atIndex = opMatch.lastIndexOf("@");
                      if (atIndex > 0) {
                        const operation = opMatch.substring(0, atIndex);
                        const lineStr = opMatch.substring(atIndex + 1);
                        usedAt.push({
                          line: parseInt(lineStr) || 0,
                          operation,
                        });
                      }
                    }
                  });
                }
              }

              this.ioRegistryData.push({
                pin,
                defined,
                pinMode: pinModeParsed,
                definedAt: defined ? { line: definedLine } : undefined,
                usedAt,
              });
            }
            return;
          }

          // Check for pin state messages - these are internal protocol, not errors
          // They must be filtered regardless of whether onPinState exists
          const pinModeMatch = line.match(/\[\[PIN_MODE:(\d+):(\d+)\]\]/);
          const pinValueMatch = line.match(/\[\[PIN_VALUE:(\d+):(\d+)\]\]/);
          const pinPwmMatch = line.match(/\[\[PIN_PWM:(\d+):(\d+)\]\]/);

          if (pinModeMatch) {
            // PIN_MODE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinModeMatch[1]);
              const mode = parseInt(pinModeMatch[2]);
              onPinState(pin, "mode", mode);
            }
          } else if (pinValueMatch) {
            // PIN_VALUE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinValueMatch[1]);
              const value = parseInt(pinValueMatch[2]);
              onPinState(pin, "value", value);
            }
          } else if (pinPwmMatch) {
            // PIN_PWM is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinPwmMatch[1]);
              const value = parseInt(pinPwmMatch[2]);
              onPinState(pin, "pwm", value);
            }
          } else {
            // Detect structured serial events emitted by the mock
            const serialEventMatch = line.match(
              /\[\[SERIAL_EVENT:(\d+):([A-Za-z0-9+/=]+)\]\]/,
            );
            if (serialEventMatch) {
              try {
                const ts = parseInt(serialEventMatch[1], 10);
                const b64 = serialEventMatch[2];
                const buf = Buffer.from(b64, "base64");
                const decoded = buf.toString("utf8");
                const event = {
                  type: "serial",
                  ts_write: (this.processStartTime || Date.now()) + ts,
                  data: decoded,
                  baud: this.baudrate,
                  bits_per_frame: 10,
                  txBufferBefore: this.outputBuffer.length,
                  txBufferCapacity: 1000,
                  blocking: true,
                  atomic: true,
                };
                onOutput(
                  "[[" + "SERIAL_EVENT_JSON:" + JSON.stringify(event) + "]]",
                  true,
                );
              } catch (e) {
                this.logger.warn(
                  `Failed to parse SERIAL_EVENT: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            } else {
              // Regular error message
              this.logger.warn(`[STDERR line]: ${JSON.stringify(line)}`);
              onError(line);
            }
          }
        }
      });
    });

    this.process?.on("close", (code) => {
      this.clearTimeoutTimer();
      this.timeoutCallback = null;
      this.pausedTimeoutRemainingMs = null;

      // Flush any pending serial events before closing
      if (this.pendingSerialFlushTimer) {
        clearTimeout(this.pendingSerialFlushTimer);
        this.pendingSerialFlushTimer = null;
      }
      this.flushPendingSerialEvents(onOutput);

      // Send any remaining buffered output immediately, but only if not killed (natural exit)
      if (!this.processKilled && this.outputBuffer.trim()) {
        onOutput(this.outputBuffer.trim(), true);
      }
      if (this.errorBuffer.trim()) {
        this.logger.warn(`[STDERR final]: ${JSON.stringify(this.errorBuffer)}`);
        onError(this.errorBuffer.trim());
      }

      // Guarantee that onIORegistry is called with final registry state BEFORE onExit
      // This ensures tests receive registry data even if process terminates before IO_REGISTRY_END marker
      // Call even if registry is empty - tests need to know registry collection completed
      if (this.ioRegistryCallback) {
        this.ioRegistryCallback(this.ioRegistryData);
      }

      if (!this.processKilled) onExit(code);
      this.process = null;
      this.isRunning = false;

      // Mark registry file for delayed cleanup
      this.markRegistryForCleanup();

      // Mark temp directory for delayed cleanup instead of immediate deletion
      this.markTempDirForCleanup();
    });
  }

  pause(): boolean {
    // ChildProcess.killed is true after any kill(), so skip it here
    if (!this.isRunning || this.isPaused || !this.process) {
      return false;
    }

    this.pauseTimeoutClock();

    try {
      this.process.kill("SIGSTOP");
      this.isPaused = true;
      this.logger.info("Simulation paused (SIGSTOP)");
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to pause simulation: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  resume(): boolean {
    // ChildProcess.killed is true after any kill(), so skip it here
    if (!this.isPaused || !this.process) {
      return false;
    }

    try {
      this.process.kill("SIGCONT");
      this.isPaused = false;
      this.resumeTimeoutClock();
      this.logger.info("Simulation resumed (SIGCONT)");
      
      // Send a newline to stdin to wake up any blocked read() calls
      // This ensures the C++ process processes any buffered stdin data
      // Note: Use processKilled instead of process.killed since killed is true after any signal
      if (this.process.stdin && !this.processKilled) {
        this.process.stdin.write("\n");
      }
      
      // Restart output processing if there's buffered data and callback is available
      if (this.outputBuffer.length > 0 && this.onOutputCallback && !this.isSendingOutput) {
        this.sendOutputWithDelay(this.onOutputCallback);
      }
      
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to resume simulation: ${err instanceof Error ? err.message : String(err)}`,
      );
      // If resume fails, keep paused flag to avoid inconsistent state
      this.isPaused = true;
      return false;
    }
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  private cleanCompilerErrors(errors: string): string {
    // Remove full paths from error messages
    return errors
      .replace(/\/sandbox\/sketch\.cpp/g, "sketch.ino")
      .replace(/\/[^\s:]+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino")
      .trim();
  }

  sendSerialInput(input: string) {
    this.logger.debug(`Serial Input im Runner angekommen: ${input}`);
    // Note: Use processKilled instead of process.killed since killed is true after any signal (including SIGSTOP/SIGCONT)
    if (
      this.isRunning &&
      !this.isPaused &&
      this.process &&
      this.process.stdin &&
      !this.processKilled
    ) {
      this.process.stdin.write(input + "\n");
      this.logger.debug(`Serial Input an Sketch gesendet: ${input}`);
    } else {
      this.logger.warn(
        "Simulator is not running or is paused — serial input ignored",
      );
    }
  }

  setRegistryFile(filePath: string) {
    this.currentRegistryFile = filePath;
  }

  getSketchDir(): string | null {
    return this.currentSketchDir;
  }

  private markRegistryForCleanup() {
    if (this.currentRegistryFile && existsSync(this.currentRegistryFile)) {
      try {
        // Rename .pending.json to .cleanup.json
        const cleanupFile = this.currentRegistryFile.replace(
          ".pending.json",
          ".cleanup.json",
        );
        renameSync(this.currentRegistryFile, cleanupFile);
        this.logger.debug(`Marked registry for cleanup: ${cleanupFile}`);
        this.currentRegistryFile = null;
      } catch (err) {
        this.logger.warn(
          `Failed to mark registry for cleanup: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private markTempDirForCleanup() {
    if (this.currentSketchDir && existsSync(this.currentSketchDir)) {
      try {
        // Rename directory by appending .cleanup suffix
        const cleanupDir = this.currentSketchDir + ".cleanup";
        renameSync(this.currentSketchDir, cleanupDir);
        this.logger.debug(`Marked temp directory for cleanup: ${cleanupDir}`);
        this.currentSketchDir = null;
      } catch (err) {
        this.logger.warn(
          `Failed to mark temp directory for cleanup: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  setPinValue(pin: number, value: number) {
    this.logger.info(`[SET_PIN] Called with pin=${pin}, value=${value}`);
    this.logger.info(`[SET_PIN] State: isRunning=${this.isRunning}, isPaused=${this.isPaused}, process=${!!this.process}, stdin=${!!this.process?.stdin}, processKilled=${this.processKilled}`);
    
    // Note: Use processKilled instead of process.killed since killed is true after any signal (including SIGSTOP/SIGCONT)
    if (
      (this.isRunning || this.isPaused) &&
      this.process &&
      this.process.stdin &&
      !this.processKilled
    ) {
      const command = `[[SET_PIN:${pin}:${value}]]\n`;
      const stdin = this.process.stdin;

      this.logger.info(`[SET_PIN] Writing command: ${command.trim()}`);
      
      // Write with callback to ensure it's flushed
      const success = stdin.write(command, "utf8", (err) => {
        if (err) {
          this.logger.error(`[SET_PIN] Write callback error: ${err.message}`);
        } else {
          this.logger.info(`[SET_PIN] Write callback success`);
        }
      });

      // If write returned false, the buffer is full - drain it
      if (!success) {
        this.logger.warn(`[SET_PIN] stdin buffer full, waiting for drain`);
        stdin.once("drain", () => {
          this.logger.info(`[SET_PIN] stdin drained`);
        });
      }

      this.logger.info(
        `[SET_PIN] pin=${pin} value=${value} writeOk=${success}`,
      );
    } else {
      this.logger.warn(
        `[SET_PIN] Ignored - isRunning=${this.isRunning}, isPaused=${this.isPaused}, process=${!!this.process}, stdin=${!!this.process?.stdin}, killed=${this.process?.killed}`,
      );
    }
  }

  // Send output character by character with baudrate delay
  private sendOutputWithDelay(
    onOutput: (line: string, isComplete?: boolean) => void,
  ) {
    // Stop if not running anymore
    if (!this.isRunning) {
      this.isSendingOutput = false;
      return;
    }

    // If paused, stop sending but keep isSendingOutput flag
    // This will be retriggered when new data arrives after resume
    if (this.isPaused) {
      this.isSendingOutput = false;
      return;
    }

    if (this.outputBuffer.length === 0) {
      this.isSendingOutput = false;
      return;
    }

    this.isSendingOutput = true;
    const char = this.outputBuffer[0];
    this.outputBuffer = this.outputBuffer.slice(1);

    // Check output size limit for sent bytes
    this.totalOutputBytes += 1;
    if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
      this.stop();
      // Don't send the char, stop instead
      return;
    }

    // Send the character - mark as complete if it's a newline
    const isNewline = char === "\n";
    onOutput(char, isNewline);

    // Calculate delay for next character
    const charDelayMs = Math.max(1, (10 * 1000) / this.baudrate);

    setTimeout(() => this.sendOutputWithDelay(onOutput), charDelayMs);
  }

  private scheduleFlush(
    onOutput: (line: string, isComplete?: boolean) => void,
  ) {
    if (this.flushTimer) return;

    // Use a fixed short timeout - the C++ side handles actual baudrate simulation
    // This just ensures incomplete lines get flushed to the UI
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.outputBuffer.length > 0) {
        onOutput(this.outputBuffer, true);
        this.outputBuffer = "";
        this.pendingIncomplete = false;
      }
    }, 50); // Fixed 50ms flush timeout
  }

  private scheduleErrorFlush(
    onError: (line: string) => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
  ) {
    // Similar to scheduleFlush but for errors
    // For simplicity, just flush immediately for errors
    if (this.errorBuffer.length > 0) {
      const lines = this.errorBuffer.split(/\r?\n/);
      this.errorBuffer = lines.pop() || "";
      lines.forEach((line) => {
        if (line.length > 0) {
          // Check for pin state messages
          const pinModeMatch = line.match(/\[\[PIN_MODE:(\d+):(\d+)\]\]/);
          const pinValueMatch = line.match(/\[\[PIN_VALUE:(\d+):(\d+)\]\]/);
          const pinPwmMatch = line.match(/\[\[PIN_PWM:(\d+):(\d+)\]\]/);
          const dreadMatch = line.match(/\[\[DREAD:(\d+):(\d+)\]\]/);
          const pinSetMatch = line.match(/\[\[PIN_SET:(\d+):(\d+)\]\]/);
          const stdinRecvMatch = line.match(/\[\[STDIN_RECV:(.+)\]\]/);

          if (pinModeMatch) {
            // PIN_MODE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinModeMatch[1]);
              const mode = parseInt(pinModeMatch[2]);
              onPinState(pin, "mode", mode);
            }
          } else if (pinValueMatch) {
            // PIN_VALUE is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinValueMatch[1]);
              const value = parseInt(pinValueMatch[2]);
              onPinState(pin, "value", value);
            }
          } else if (pinPwmMatch) {
            // PIN_PWM is internal protocol - filter regardless of onPinState
            if (onPinState) {
              const pin = parseInt(pinPwmMatch[1]);
              const value = parseInt(pinPwmMatch[2]);
              onPinState(pin, "pwm", value);
            }
          } else if (dreadMatch || pinSetMatch || stdinRecvMatch) {
            // Debug output - don't send to client
          } else {
            onError(line);
          }
        }
      });
    }
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.pausedTimeoutRemainingMs = null;
    this.clearTimeoutTimer();
    this.timeoutCallback = null;
    this.processKilled = true;
    this.onOutputCallback = null; // Clear stored callback

    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }

    // Also mark registry file for delayed cleanup when stopping manually
    this.markRegistryForCleanup();

    // Mark temp directory for delayed cleanup instead of immediate deletion
    this.markTempDirForCleanup();

    this.outputBuffer = "";
    this.errorBuffer = "";
    this.isSendingOutput = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // Public method to check sandbox status
  getSandboxStatus(): {
    dockerAvailable: boolean;
    dockerImageBuilt: boolean;
    mode: string;
  } {
    return {
      dockerAvailable: this.dockerAvailable,
      dockerImageBuilt: this.dockerImageBuilt,
      mode:
        this.dockerAvailable && this.dockerImageBuilt
          ? "docker-sandbox"
          : "local-limited",
    };
  }
}

export const sandboxRunner = new SandboxRunner();
