// sandbox-runner.ts
// Secure sandbox execution for Arduino sketches using Docker

import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";
import { mkdir, rm } from "fs/promises";
import { existsSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";
import { ArduinoOutputParser } from "./arduino-output-parser";
import { RegistryManager } from "./registry-manager";
import { SimulationTimeoutManager } from "./simulation-timeout-manager";
import { DockerCommandBuilder } from "./docker-command-builder";
import { SketchFileBuilder } from "./sketch-file-builder";
import { LocalCompiler } from "./local-compiler";

enum SimulationState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  PAUSED = "paused",
  ERROR = "error",
}

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
  // Core state
  private state: SimulationState = SimulationState.STOPPED;
  private tempDir = join(process.cwd(), "temp");
  private process: ReturnType<typeof spawn> | null = null;
  private processKilled = false;
  private pauseStartTime: number | null = null;
  
  // Managers and helpers
  private logger = new Logger("SandboxRunner");
  private parser = new ArduinoOutputParser();
  private registryManager: RegistryManager;
  private timeoutManager: SimulationTimeoutManager;
  private fileBuilder: SketchFileBuilder;
  private localCompiler: LocalCompiler;
  
  // Output buffers
  private outputBuffer = "";
  private errorBuffer = "";
  private totalOutputBytes = 0;
  private isSendingOutput = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private pendingIncomplete = false;
  private pendingSerialEvents: Array<any> = [];
  private pendingSerialFlushTimer: NodeJS.Timeout | null = null;
  
  // Execution state
  private processStartTime: number | null = null;
  private currentSketchDir: string | null = null;
  private currentRegistryFile: string | null = null;
  private baudrate = 9600;
  private dockerAvailable = false;
  private dockerImageBuilt = false;
  
  // Callbacks and message queue
  private ioRegistryCallback: ((registry: IOPinRecord[], baudrate: number) => void) | undefined;
  private messageQueue: Array<{ type: string; data: any }> = [];
  private onOutputCallback: ((line: string, isComplete?: boolean) => void) | null = null;
  
  // Stable callback references for async operations
  private outputCallback: ((line: string, isComplete?: boolean) => void) | null = null;
  private errorCallback: ((line: string) => void) | null = null;
  private pinStateCallback: ((pin: number, type: "mode" | "value" | "pwm", value: number) => void) | null = null;
  
  // Lazy initialization flags
  private dockerChecked = false;
  private tempDirCreated = false;

  constructor() {
    // Lightweight constructor - no side effects, no I/O, no blocking
    // All heavy initialization happens lazily in ensureDockerChecked() and ensureTempDir()
    
    // Initialize managers and helpers
    this.timeoutManager = new SimulationTimeoutManager();
    this.fileBuilder = new SketchFileBuilder(this.tempDir);
    this.localCompiler = new LocalCompiler();

    // Initialize registry manager with arrow function callback for correct 'this' binding
    this.registryManager = new RegistryManager({
      debounceMs: 200,
      onUpdate: (registry, baudrate) => {
        // Forward to WebSocket callback if set
        if (this.ioRegistryCallback) {
          this.ioRegistryCallback(registry, baudrate);
        }
        // Flush queued messages after first registry send
        this.flushMessageQueue();
      },
    });
  }

  get isRunning(): boolean {
    return (
      this.state === SimulationState.STARTING ||
      this.state === SimulationState.RUNNING ||
      this.state === SimulationState.PAUSED
    );
  }

  get isPaused(): boolean {
    return this.state === SimulationState.PAUSED;
  }

  get simulationState(): SimulationState {
    return this.state;
  }

  private transitionTo(newState: SimulationState): boolean {
    const oldState = this.state;

    if (oldState === newState) {
      return true;
    }

    const validTransitions: Record<SimulationState, SimulationState[]> = {
      [SimulationState.STOPPED]: [
        SimulationState.STARTING,
        SimulationState.ERROR,
      ],
      [SimulationState.STARTING]: [
        SimulationState.RUNNING,
        SimulationState.ERROR,
        SimulationState.STOPPED,
      ],
      [SimulationState.RUNNING]: [
        SimulationState.PAUSED,
        SimulationState.STOPPED,
        SimulationState.ERROR,
      ],
      [SimulationState.PAUSED]: [
        SimulationState.RUNNING,
        SimulationState.STOPPED,
        SimulationState.ERROR,
      ],
      [SimulationState.ERROR]: [SimulationState.STOPPED],
    };

    if (!validTransitions[oldState]?.includes(newState)) {
      this.logger.warn(
        `Invalid state transition: ${oldState} -> ${newState}`,
      );
      return false;
    }

    this.handleStateExit(oldState, newState);
    this.state = newState;
    this.handleStateEnter(newState, oldState);
    return true;
  }

  private handleStateExit(
    state: SimulationState,
    nextState: SimulationState,
  ): void {
    switch (state) {
      case SimulationState.RUNNING:
        if (nextState === SimulationState.PAUSED) {
          // Freeze timeout clock
          this.timeoutManager.pause();
        } else if (nextState === SimulationState.STOPPED) {
          // CRITICAL: Clear timeout to prevent zombie timer
          this.timeoutManager.clear();
        }
        break;
      
      case SimulationState.PAUSED:
        if (nextState === SimulationState.STOPPED) {
          // CRITICAL: Clear paused timeout
          this.timeoutManager.clear();
        }
        this.pauseStartTime = null;
        break;
      
      default:
        break;
    }
  }

  private handleStateEnter(
    state: SimulationState,
    previousState: SimulationState,
  ): void {
    switch (state) {
      case SimulationState.STARTING:
        this.pauseStartTime = null;
        break;
      
      case SimulationState.RUNNING:
        if (previousState === SimulationState.PAUSED) {
          // Resume timeout clock with remaining time
          this.timeoutManager.resume();
        }
        break;
      
      case SimulationState.PAUSED:
        this.pauseStartTime = Date.now();
        // Timeout manager already paused in handleStateExit
        break;
      
      case SimulationState.STOPPED:
        this.pauseStartTime = null;
        // Double-check: ensure no timers remain
        this.timeoutManager.clear();
        break;
      
      case SimulationState.ERROR:
        break;
      
      default:
        break;
    }
  }

  // Flush queued messages after registry has been sent
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    this.logger.debug(
      `[Registry] Flushing ${this.messageQueue.length} queued messages`,
    );

    const queue = this.messageQueue;
    this.messageQueue = [];

    // Re-emit all queued messages in order using stable instance callbacks
    for (const msg of queue) {
      if (msg.type === "pinState" && this.pinStateCallback) {
        this.pinStateCallback(msg.data.pin, msg.data.stateType, msg.data.value);
      } else if (msg.type === "output" && this.outputCallback) {
        this.outputCallback(msg.data.line, msg.data.isComplete);
      } else if (msg.type === "error" && this.errorCallback) {
        this.errorCallback(msg.data.line);
      }
    }
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

  /**
   * Lazy initialization: Check Docker availability only when needed
   * This prevents blocking the constructor and freezing tests
   */
  private ensureDockerChecked(): void {
    if (this.dockerChecked) {
      return; // Already checked
    }
    this.dockerChecked = true;
    this.checkDockerAvailability();
  }

  /**
   * Check if Docker is available and the sandbox image is built
   */
  private checkDockerAvailability(): void {
    try {
      // Check if docker command exists AND daemon is running
      execSync("docker --version", { stdio: "pipe", timeout: 2000 });

      // Test if Docker daemon is actually running by pinging it
      execSync("docker info", { stdio: "pipe", timeout: 2000 });

      this.dockerAvailable = true;
      this.logger.info("✅ Docker daemon running — Sandbox mode enabled");

      // Check if our sandbox image exists
      try {
        execSync(`docker image inspect ${SANDBOX_CONFIG.dockerImage}`, {
          stdio: "pipe",
          timeout: 2000,
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

  /**
   * Lazy initialization: Create temp directory only when needed
   * This prevents async operations in the constructor
   */
  private async ensureTempDir(): Promise<void> {
    if (this.tempDirCreated) {
      return; // Already created
    }
    this.tempDirCreated = true;
    
    try {
      await mkdir(this.tempDir, { recursive: true });
    } catch (err) {
      this.logger.warn(
        `Temp directory creation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // Don't throw - let the actual file operations fail later if needed
    }
  }

  // Note: Duplicate flushMessageQueue removed - using single implementation above

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
    timeoutSec?: number,
    onIORegistry?: (registry: IOPinRecord[], baudrate: number) => void,
  ) {
    // Lazy initialization: ensure Docker is checked and temp directory exists
    this.ensureDockerChecked();
    await this.ensureTempDir();
    
    if (!this.transitionTo(SimulationState.STARTING)) {
      this.logger.warn(
        `runSketch ignored - invalid state: ${this.state}`,
      );
      return;
    }
    
    // Bind callbacks to instance BEFORE initializeRunState (which also sets onOutputCallback)
    this.outputCallback = onOutput;
    this.errorCallback = onError;
    this.pinStateCallback = onPinState || null;

    // Initialize run state (will also set this.onOutputCallback and this.ioRegistryCallback)
    this.initializeRunState(code, onOutput, onIORegistry, timeoutSec);
    const sketchId = randomUUID();
    try {
      // Build sketch files using helper
      const files = await this.fileBuilder.build(code, sketchId);
      this.currentSketchDir = files.sketchDir;
      this.processKilled = false;

      // Create wrapped callbacks for message queuing
      const wrapped = this.createWrappedCallbacks(onOutput, onError, onPinState);

      // Choose execution path
      const executionTimeout =
        timeoutSec !== undefined ? timeoutSec : SANDBOX_CONFIG.maxExecutionTimeSec;

      if (this.dockerAvailable && this.dockerImageBuilt) {
        await this.runInDocker(
          files,
          wrapped,
          onCompileError,
          onCompileSuccess,
          onExit,
          executionTimeout,
        );
      } else {
        await this.runLocally(
          files,
          wrapped,
          onCompileError,
          onCompileSuccess,
          onExit,
          executionTimeout,
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Kompilierfehler oder Timeout: ${errorMessage}`);
      // Call onCompileError if provided (for test promise resolution)
      if (onCompileError) {
        onCompileError(errorMessage);
      }
      
      // Always call onExit to ensure promises resolve
      if (onExit) {
        onExit(-1);
      }
      
      this.process = null;

      // Cleanup on error
      try {
        await rm(this.currentSketchDir!, { recursive: true, force: true });
      } catch {
        this.logger.warn(`Could not delete temp directory: ${this.currentSketchDir}`);
      }
    }
  }

  /**
   * Initialize run state for a new sketch execution
   */
  private initializeRunState(
    code: string,
    onOutput: (line: string, isComplete?: boolean) => void,
    onIORegistry?: (registry: IOPinRecord[], baudrate: number) => void,
    timeoutSec?: number,
  ): void {
    // Parse baudrate from code
    const baudMatch = code.match(/Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/);
    this.baudrate = baudMatch ? parseInt(baudMatch[1]) : 9600;

    const executionTimeout =
      timeoutSec !== undefined ? timeoutSec : SANDBOX_CONFIG.maxExecutionTimeSec;
    this.logger.info(
      `🕐 runSketch called with timeoutSec=${timeoutSec}, using executionTimeout=${executionTimeout}s`,
    );
    this.logger.info(`Parsed baudrate: ${this.baudrate}`);

    // Reset state
    this.pauseStartTime = null;
    this.registryManager.reset();
    this.registryManager.setBaudrate(this.baudrate);
    this.registryManager.enableWaitMode(1500);
    this.messageQueue = [];
    this.outputBuffer = "";
    this.errorBuffer = "";
    this.isSendingOutput = false;
    this.totalOutputBytes = 0;
    this.onOutputCallback = onOutput;
    this.ioRegistryCallback = onIORegistry;
  }

  /**
   * Create wrapped callbacks that queue messages while waiting for registry
   * Uses stable instance callbacks (this.outputCallback etc.) for async playback
   */
  private createWrappedCallbacks(
    onOutput: (line: string, isComplete?: boolean) => void,
    onError: (line: string) => void,
    onPinState?: (
      pin: number,
      type: "mode" | "value" | "pwm",
      value: number,
    ) => void,
  ) {
    return {
      onOutput: (line: string, isComplete?: boolean) => {
        if (this.registryManager.isWaiting()) {
          this.messageQueue.push({
            type: "output",
            data: { line, isComplete },
          });
        } else if (onOutput) {
          onOutput(line, isComplete);
        }
      },
      onPinState: (
        pin: number,
        stateType: "mode" | "value" | "pwm",
        value: number,
      ) => {
        if (this.registryManager.isWaiting()) {
          this.messageQueue.push({
            type: "pinState",
            data: { pin, stateType, value },
          });
        } else if (onPinState) {
          onPinState(pin, stateType, value);
        }
      },
      onError: (line: string) => {
        if (this.registryManager.isWaiting()) {
          this.messageQueue.push({
            type: "error",
            data: { line },
          });
        } else if (onError) {
          onError(line);
        }
      },
    };
  }

  /**
   * Run sketch in Docker sandbox
   */
  private async runInDocker(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): Promise<void> {
    const dockerArgs = DockerCommandBuilder.buildSecureRunCommand({
      sketchDir: files.sketchDir,
      memoryMB: SANDBOX_CONFIG.maxMemoryMB,
      cpuLimit: "0.5",
      pidsLimit: 50,
      imageName: SANDBOX_CONFIG.dockerImage,
      command: DockerCommandBuilder.buildCompileAndRunCommand(),
    });

    this.process = spawn("docker", dockerArgs);
    this.logger.info("🚀 Docker: Compile + Run in single container");
    this.processStartTime = Date.now();
    this.transitionTo(SimulationState.RUNNING);

    this.setupDockerHandlers(
      callbacks,
      onCompileError,
      onCompileSuccess,
      onExit,
      executionTimeout || SANDBOX_CONFIG.maxExecutionTimeSec,
    );
  }

  /**
   * Run sketch locally (fallback when Docker unavailable)
   */
  private async runLocally(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): Promise<void> {
    try {
      // Compile using LocalCompiler
      await this.localCompiler.compile(files.sketchFile, files.exeFile);

      if (onCompileSuccess) {
        onCompileSuccess();
      }

      // Make executable
      await this.localCompiler.makeExecutable(files.exeFile);

      // Run the compiled executable
      this.process = spawn(files.exeFile);
      this.processStartTime = Date.now();
      this.transitionTo(SimulationState.RUNNING);

      this.setupLocalHandlers(
        callbacks,
        onExit,
        executionTimeout || SANDBOX_CONFIG.maxExecutionTimeSec,
      );
    } catch (err) {
      if (onCompileError) {
        onCompileError(err instanceof Error ? err.message : String(err));
      }
      if (onExit) {
        onExit(-1);
      }
      this.transitionTo(SimulationState.STOPPED);
      this.process = null;
      this.markTempDirForCleanup();
      return;
    }
  }

  /**
   * Setup handlers for Docker process (combined compile + run)
   */
  private setupDockerHandlers(
    callbacks: any,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): void {
    let compileErrorBuffer = "";
    let isCompilePhase = true;
    let compileSuccessSent = false;

    // Setup timeout
    const handleTimeout = () => {
      if (this.process) {
        this.process.kill("SIGKILL");
        callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);
        this.logger.info(`Docker timeout after ${executionTimeout}s`);
      }
    };

    this.timeoutManager.schedule(
      executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null,
      handleTimeout,
    );

    // Error handler
    this.process?.on("error", (err) => {
      this.logger.error(`Docker process error: ${err.message}`);
      callbacks.onError(`Docker process failed: ${err.message}`);
    });

    // Stdout handler (program output)
    this.process?.stdout?.on("data", (data) => {
      const str = data.toString();

      if (isCompilePhase) {
        isCompilePhase = false;
        if (!compileSuccessSent && onCompileSuccess) {
          compileSuccessSent = true;
          onCompileSuccess();
        }
      }

      this.totalOutputBytes += str.length;
      if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        this.stop();
        callbacks.onError("Output size limit exceeded");
        return;
      }

      this.outputBuffer += str;
      const lines = this.outputBuffer.split(/\r?\n/);
      this.outputBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length > 0) {
          if (this.pendingIncomplete) {
            callbacks.onOutput(line, true);
            this.pendingIncomplete = false;
          } else {
            callbacks.onOutput(line, true);
          }
        }
      });

      if (this.outputBuffer.length > 0 && !this.flushTimer) {
        this.scheduleFlush(callbacks.onOutput);
      }
    });

    // Stderr handler (compile errors + debug output)
    this.process?.stderr?.on("data", (data) => {
      const str = data.toString();

      if (isCompilePhase) {
        compileErrorBuffer += str;
      }

      this.errorBuffer += str;
      const lines = this.errorBuffer.split(/\r?\n/);
      this.errorBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length === 0) return;

        const parsed = this.parser.parseStderrLine(line, this.processStartTime);
        this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
      });

      if (this.errorBuffer.length > 0) {
        this.scheduleErrorFlush(callbacks.onError, callbacks.onPinState);
      }
    });

    // Close handler
    this.process?.on("close", (code) => {
      this.transitionTo(SimulationState.STOPPED);

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      if (this.pendingSerialFlushTimer) {
        clearTimeout(this.pendingSerialFlushTimer);
        this.pendingSerialFlushTimer = null;
      }
      this.flushPendingSerialEvents(callbacks.onOutput);

      if (code !== 0 && isCompilePhase && compileErrorBuffer && onCompileError) {
        onCompileError(this.cleanCompilerErrors(compileErrorBuffer));
      } else {
        if (code === 0 && !compileSuccessSent && onCompileSuccess) {
          compileSuccessSent = true;
          onCompileSuccess();
        }
      }

      if (this.outputBuffer.trim()) {
        callbacks.onOutput(this.outputBuffer.trim(), true);
      }
      if (this.errorBuffer.trim()) {
        callbacks.onError(this.errorBuffer.trim());
      }

      // Send final registry before exit
      if (this.ioRegistryCallback) {
        const finalRegistry = this.registryManager.getRegistry();
        if (finalRegistry.length > 0) {
          this.ioRegistryCallback([...finalRegistry], this.baudrate);
        }
      }

      if (!this.processKilled && onExit) onExit(code);
      this.process = null;
      this.markTempDirForCleanup();
    });
  }

  /**
   * Setup handlers for local process execution
   */
  private setupLocalHandlers(
    callbacks: any,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): void {
    // Similar to Docker but without compile phase
    const handleTimeout = () => {
      if (this.process) {
        this.process.kill("SIGKILL");
        callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);
      }
    };

    this.timeoutManager.schedule(
      executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null,
      handleTimeout,
    );

    this.process?.stdout?.on("data", (data) => {
      const str = data.toString();
      this.totalOutputBytes += str.length;

      if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        this.stop();
        callbacks.onError("Output size limit exceeded");
        return;
      }

      this.outputBuffer += str;
      const lines = this.outputBuffer.split(/\r?\n/);
      this.outputBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length > 0) {
          callbacks.onOutput(line, true);
        }
      });

      if (this.outputBuffer.length > 0 && !this.flushTimer) {
        this.scheduleFlush(callbacks.onOutput);
      }
    });

    this.process?.stderr?.on("data", (data) => {
      const str = data.toString();
      this.errorBuffer += str;
      const lines = this.errorBuffer.split(/\r?\n/);
      this.errorBuffer = lines.pop() || "";

      lines.forEach((line) => {
        if (line.length === 0) return;
        const parsed = this.parser.parseStderrLine(line, this.processStartTime);
        this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
      });
    });

    this.process?.on("close", (code) => {
      this.transitionTo(SimulationState.STOPPED);

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      if (this.outputBuffer.trim()) {
        callbacks.onOutput(this.outputBuffer.trim(), true);
      }

      if (this.ioRegistryCallback) {
        const finalRegistry = this.registryManager.getRegistry();
        if (finalRegistry.length > 0) {
          this.ioRegistryCallback([...finalRegistry], this.baudrate);
        }
      }

      if (!this.processKilled && onExit) onExit(code);
      this.process = null;
      this.markTempDirForCleanup();
    });
  }

  /**
   * Handle a parsed stderr line (common logic for both Docker and local)
   */
  private handleParsedLine(
    parsed: any,
    onPinState?: (pin: number, type: "mode" | "value" | "pwm", value: number) => void,
    onOutput?: (line: string, isComplete?: boolean) => void,
    onError?: (line: string) => void,
  ): void {
    switch (parsed.type) {
      case "registry_start":
        this.registryManager.startCollection();
        break;

      case "registry_end":
        this.registryManager.finishCollection();
        break;

      case "registry_pin":
        this.registryManager.addPin(parsed.pinRecord);
        break;

      case "pin_mode":
        this.registryManager.updatePinMode(parsed.pin, parsed.mode);
        if (onPinState) {
          onPinState(parsed.pin, "mode", parsed.mode);
        }
        break;

      case "pin_value":
        this.registryManager.updatePinValue(parsed.pin, parsed.value);
        if (onPinState) {
          onPinState(parsed.pin, "value", parsed.value);
        }
        break;

      case "pin_pwm":
        this.registryManager.updatePinPWM(parsed.pin, parsed.value);
        if (onPinState) {
          onPinState(parsed.pin, "pwm", parsed.value);
        }
        break;

      case "serial_event":
        if (onOutput) {
          try {
            onOutput(
              "[[SERIAL_EVENT_JSON:" +
                JSON.stringify({
                  type: "serial",
                  ts_write: parsed.timestamp,
                  data: parsed.data,
                }) +
                "]]",
              true,
            );
          } catch (err) {
            this.logger.warn(`Failed to send serial event: ${err}`);
          }
        }
        break;

      case "ignored":
        // Debug markers - do nothing
        break;

      case "text":
        if (onError) {
          this.logger.warn(`[STDERR]: ${parsed.line}`);
          onError(parsed.line);
        }
        break;
    }
  }

  // Remove old compileAndRunInDocker method below
  // Continue to next method

  pause(): boolean {
    // Guard: can only pause from RUNNING state
    if (this.state !== SimulationState.RUNNING || !this.process) {
      return false;
    }

    // Transition first to update pauseStartTime and pause timeout clock
    if (!this.transitionTo(SimulationState.PAUSED)) {
      return false;
    }

    try {
      // Send pause command to freeze timing in C++
      if (this.process.stdin && !this.processKilled) {
        this.process.stdin.write("[[PAUSE_TIME]]\n");
      }
      
      this.process.kill("SIGSTOP");
      this.logger.info("Simulation paused (SIGSTOP)");
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to pause simulation: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Rollback state on failure
      this.transitionTo(SimulationState.RUNNING);
      return false;
    }
  }

  resume(): boolean {
    // Guard: can only resume from PAUSED state
    if (this.state !== SimulationState.PAUSED || !this.process) {
      return false;
    }

    try {
      // Calculate pause duration before transition clears pauseStartTime
      const pauseDuration = Date.now() - (this.pauseStartTime || Date.now());
      
      // Send resume command with pause duration to adjust timing offset in C++
      if (this.process.stdin && !this.processKilled) {
        this.process.stdin.write(`[[RESUME_TIME:${pauseDuration}]]\n`);
      }
      
      this.process.kill("SIGCONT");
      
      // Transition state (this clears pauseStartTime and resumes timeout clock)
      if (!this.transitionTo(SimulationState.RUNNING)) {
        return false;
      }
      
      this.logger.info(`Simulation resumed after ${pauseDuration}ms pause (SIGCONT)`);
      
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
      // Rollback to paused state on failure
      this.transitionTo(SimulationState.PAUSED);
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
        if (line.length === 0) return;

        const parsed = this.parser.parseStderrLine(line, this.processStartTime);

        switch (parsed.type) {
          case "pin_mode":
            if (onPinState) {
              onPinState(parsed.pin, "mode", parsed.mode);
            }
            break;

          case "pin_value":
            if (onPinState) {
              onPinState(parsed.pin, "value", parsed.value);
            }
            break;

          case "pin_pwm":
            if (onPinState) {
              onPinState(parsed.pin, "pwm", parsed.value);
            }
            break;

          case "ignored":
            // Debug markers - do nothing
            break;

          case "text":
            onError(parsed.line);
            break;

          // Other types (registry, serial_event) shouldn't appear in error flush context
          default:
            break;
        }
      });
    }
  }

  async stop(): Promise<void> {
    this.transitionTo(SimulationState.STOPPED);
    this.processKilled = true;
    
    // Clear all callbacks for memory leak prevention
    this.onOutputCallback = null;
    this.outputCallback = null;
    this.errorCallback = null;
    this.pinStateCallback = null;
    this.ioRegistryCallback = undefined;

    // Cleanup all manager timers (debounce, timeout, wait timers)
    this.registryManager.reset(); // Clears debounce and wait timers
    this.timeoutManager.clear(); // Clears timeout timer
    
    // Destroy registry manager to prevent post-test logging
    this.registryManager.destroy();

    if (this.process) {
      try {
        // Immediate hard kill to match expected test behavior
        this.process.kill("SIGKILL");
      } catch {
        // Ignore kill errors
      }
      // Cleanup sockets to prevent open handles
      this.destroyProcessSockets(this.process as ChildProcess);
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

  /* killProcessAndWait removed (unused) */

  /**
   * Explicitly destroy all process sockets to prevent Jest open handles
   */
  private destroyProcessSockets(process: ChildProcess): void {
    try {
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.destroy();
      }
    } catch (err) {
      // Ignore errors
    }

    try {
      if (process.stdout && !process.stdout.destroyed) {
        process.stdout.destroy();
      }
    } catch (err) {
      // Ignore errors
    }

    try {
      if (process.stderr && !process.stderr.destroyed) {
        process.stderr.destroy();
      }
    } catch (err) {
      // Ignore errors
    }
  }

  // Public method to check sandbox status
  getSandboxStatus(): {
    dockerAvailable: boolean;
    dockerImageBuilt: boolean;
    mode: string;
  } {
    this.ensureDockerChecked();
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
