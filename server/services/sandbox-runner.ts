// sandbox-runner.ts
// Secure sandbox execution for Arduino sketches using Docker

import { execFile, execSync } from "child_process";
import { ProcessController, type IProcessController } from "./process-controller";
import { mkdir, rm } from "fs/promises";
import { existsSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import { ArduinoOutputParser as StderrParser } from "./arduino-output-parser";
import { RegistryManager } from "./registry-manager";
import { SimulationTimeoutManager } from "./simulation-timeout-manager";
import { DockerCommandBuilder } from "./docker-command-builder";
import { SketchFileBuilder } from "./sketch-file-builder";
import { LocalCompiler } from "./local-compiler";

import { PinStateBatcher, type PinStateBatch } from "./pin-state-batcher";
import { SerialOutputBatcher } from "./serial-output-batcher";
import type { RunSketchOptions } from "./run-sketch-types";
import { getCompileGatekeeper } from "./compile-gatekeeper";

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
  private tempDir = join(getFastTmpBaseDir(), "unowebsim-temp");
  private processController: IProcessController;
  private processKilled = false;
  private pauseStartTime: number | null = null;
  // total time (ms) the simulation has spent paused during the current run
  private totalPausedTime: number = 0;
  
  // Managers and helpers
  private logger = new Logger("SandboxRunner");
  private stderrParser = new StderrParser();
  private registryManager: RegistryManager;
  // track when pause occurred so events can be tagged if needed
  private lastPauseTimestamp: number | null = null;
  private timeoutManager: SimulationTimeoutManager;
  private fileBuilder: SketchFileBuilder;
  private localCompiler: LocalCompiler;
  private pinStateBatcher: PinStateBatcher | null = null;
  private serialOutputBatcher: SerialOutputBatcher | null = null;
  // true when we have temporarily SIGSTOP'd the child due to batcher overload
  private backpressurePaused = false;
  
  // Output buffers
  private outputBuffer = "";
  private outputBufferIndex = 0; // Index for reading from outputBuffer (avoids O(n²) slice cost)
  private totalOutputBytes = 0;
  private isSendingOutput = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private stderrFallbackBuffer = ""; // Fallback buffer for unline-buffered stderr data
  
  // Execution state
  private processStartTime: number | null = null;
  private currentSketchDir: string | null = null;
  // if a compile process is currently running, defer cleanup to avoid races
  private isCompiling = false;
  private currentRegistryFile: string | null = null;
  private pendingCleanup = false;
  private cleanupRetries = new Map<string, number>();
  private baudrate = 9600;
  private dockerAvailable = false;
  private dockerImageBuilt = false;
  private dockerCheckPromise: Promise<void> | null = null;
  
  // Callbacks and message queue
  private ioRegistryCallback:
    | ((registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void)
    | undefined;
  private messageQueue: Array<{ type: string; data: any }> = [];
  private onOutputCallback: ((line: string, isComplete?: boolean) => void) | null = null;
  
  // Stable callback references for async operations
  private outputCallback: ((line: string, isComplete?: boolean) => void) | null = null;
  private errorCallback: ((line: string) => void) | null = null;
  private pinStateCallback: ((pin: number, type: "mode" | "value" | "pwm", value: number) => void) | null = null;
  private telemetryCallback: ((metrics: any) => void) | null = null;
  
  // Lazy initialization flags
  private dockerChecked = false;
  private tempDirCreated = false;

  constructor(options?: { tempDir?: string; processController?: IProcessController }) {
    // Lightweight constructor - no side effects, no I/O, no blocking
    // All heavy initialization happens lazily in ensureDockerChecked() and ensureTempDir()

    // Accept injected ProcessController for easier testing / specialization
    this.processController = options?.processController ?? new ProcessController();

    if (options?.tempDir) {
      this.tempDir = options.tempDir;
    }
    
    // Initialize managers and helpers
    this.timeoutManager = new SimulationTimeoutManager();
    this.fileBuilder = new SketchFileBuilder(this.tempDir);
    this.localCompiler = new LocalCompiler();

    // Initialize registry manager with arrow function callback for correct 'this' binding
    this.registryManager = new RegistryManager({
      onUpdate: (registry, baudrate, reason) => {
        // Forward to WebSocket callback if set
        if (this.ioRegistryCallback) {
          this.ioRegistryCallback(registry, baudrate, reason);
        }
        // Flush queued messages after first registry send
        this.flushMessageQueue();
      },
      onTelemetry: (metrics) => {
        // Forward telemetry metrics to dedicated telemetry callback (not to serial output)
        if (this.telemetryCallback) {
          this.telemetryCallback(metrics);
        }
      },
      enableTelemetry: true,
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

  /**
   * Lazy initialization: Check Docker availability only when needed.
   * In production: runs asynchronously (non-blocking)
   * In tests: can use synchronous mocks, but doesn't block server startup
   */
  private async ensureDockerChecked(): Promise<void> {
    if (this.dockerChecked) {
      return; // Already checked
    }

    // Test-mode: use synchronous version (for backward compatibility with test mocks)
    const hasMockedExecSync = typeof (execSync as any)?.mock !== "undefined";
    if (process.env.NODE_ENV === "test" || hasMockedExecSync) {
      try {
        this.checkDockerAvailabilitySyncForTest();
      } catch (err) {
        this.logger.debug(`Docker check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.dockerChecked = true;
      return;
    }

    // Production: async (non-blocking)
    if (this.dockerCheckPromise) {
      return this.dockerCheckPromise;
    }

    this.dockerCheckPromise = this.checkDockerAvailability()
      .finally(() => {
        this.dockerChecked = true;
        this.dockerCheckPromise = null;
      });

    return this.dockerCheckPromise;
  }

  private checkDockerAvailabilitySyncForTest(): void {
    // Test-only synchronous version - safe because tests run fast
    try {
      execSync("docker --version", { stdio: "pipe", timeout: 2000 });
      execSync("docker info", { stdio: "pipe", timeout: 2000 });
      this.dockerAvailable = true;

      try {
        execSync(`docker image inspect ${SANDBOX_CONFIG.dockerImage}`, {
          stdio: "pipe",
          timeout: 2000,
        });
        this.dockerImageBuilt = true;
      } catch {
        this.dockerImageBuilt = false;
      }
    } catch {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
    }
  }

  private async runCommand(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (typeof execFile === "function") {
        execFile(
          command,
          args,
          { timeout: 2000, windowsHide: true },
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
        );
        return;
      }

      reject(new Error("execFile is not available in this runtime"));
    });
  }

  /**
   * Check if Docker is available and the sandbox image is built
   */
  private async checkDockerAvailability(): Promise<void> {
    if (this.dockerChecked && (this.dockerAvailable || this.dockerImageBuilt)) {
      // already ran once and determined state; avoid re-spawning processes
      return;
    }
    try {
      // Check if docker command exists AND daemon is running (non-blocking)
      await Promise.all([
        this.runCommand("docker", ["--version"]),
        this.runCommand("docker", ["info"]),
      ]);

      this.dockerAvailable = true;
      this.logger.info("✅ Docker daemon running — Sandbox mode enabled");

      // Check if our sandbox image exists
      try {
        await this.runCommand("docker", ["image", "inspect", SANDBOX_CONFIG.dockerImage]);
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

  async runSketch(options: RunSketchOptions) {
    const opts = options;

    // Extract stable variables for the rest of the method
    const {
      code,
      onOutput,
      onError,
      onExit,
      onCompileError,
      
      onPinState,
      timeoutSec,
      onIORegistry,
      onTelemetry,
      onPinStateBatch,
    } = opts;

    // Lazy initialization: ensure Docker is checked and temp directory exists
    // Intentionally not awaited to keep startup responsive while detection runs.
    void this.ensureDockerChecked();
    await this.ensureTempDir();

    if (!this.transitionTo(SimulationState.STARTING)) {
      this.logger.warn(
        `runSketch ignored - invalid state: ${this.state}`,
      );
      return;
    }

    // Clear pending cleanup for a fresh run
    this.pendingCleanup = false;
    
    // Create and start PinStateBatcher for this simulation run
    this.pinStateBatcher = new PinStateBatcher({
      tickIntervalMs: 50, // 20 batches/sec
      onBatch: (batch: PinStateBatch) => {
        // Queue pin states until registry is synchronized
        if (this.registryManager.isWaiting()) {
          for (const state of batch.states) {
            this.messageQueue.push({
              type: "pinState",
              data: { pin: state.pin, stateType: state.stateType, value: state.value },
            });
          }
        } else if (onPinStateBatch) {
          // Send batch as a single pin_state_batch message
          onPinStateBatch(batch);
        } else if (onPinState) {
          // Fallback: Send each pin state individually for backward compatibility
          for (const state of batch.states) {
            onPinState(state.pin, state.stateType, state.value);
          }
        }
      },
    });
    this.pinStateBatcher.start();
    
    // Give RegistryManager reference to PinStateBatcher for telemetry
    this.registryManager.setPinStateBatcher(this.pinStateBatcher);
    
    // Bind callbacks to instance BEFORE initializeRunState (which also sets onOutputCallback)
    this.outputCallback = onOutput;
    this.errorCallback = onError;
    this.pinStateCallback = onPinState || null;
    this.telemetryCallback = onTelemetry || null;

    // Initialize run state (will also set this.onOutputCallback and this.ioRegistryCallback)
    this.initializeRunState(code, onOutput, onIORegistry, timeoutSec);
    
    // Create and start SerialOutputBatcher for this simulation run
    this.serialOutputBatcher = new SerialOutputBatcher({
      baudrate: this.baudrate,
      tickIntervalMs: 50, // 20 batches/sec (matching PinStateBatcher)
      onChunk: (data: string, firstLineIncomplete?: boolean) => {
        // Capture stable reference and ensure it's callable to avoid race conditions
        const out = this.outputCallback;
        if (typeof out !== 'function') return;

        // If we were stopped for backpressure and the buffer is now below the
        // threshold, resume the child process (but only if not globally paused).
        // We defer the check to the next macrotask because the batcher clears
        // pendingData *after* calling our callback; checking immediately would
        // still see the old full value and never resume.
        if (this.backpressurePaused) {
          setTimeout(() => {
            if (
              this.backpressurePaused &&
              this.serialOutputBatcher &&
              !this.serialOutputBatcher.isOverloaded() &&
              !this.isPaused &&
              this.processController.hasProcess()
            ) {
              this.logger.info("Backpressure relieved, sending SIGCONT");
              this.processController.kill("SIGCONT");
              this.backpressurePaused = false;
            }
          }, 0);
        }

        // Split batched data by newlines to preserve Serial.print() vs println() semantics.
        // Data from Serial.println() contains trailing \n, Serial.print() does not.
        // Each part before a \n is a complete line; the trailing part (if any) is incomplete.
        const endsWithNewline = data.endsWith('\n');
        const parts = data.split('\n');
        for (let i = 0; i < parts.length; i++) {
          const isLastPart = i === parts.length - 1;
          if (isLastPart && endsWithNewline) {
            // Trailing empty string from split("...\n") — already handled by previous part
            break;
          }
          // Parts before the last had a \n after them → complete lines.
          // BUT: if firstLineIncomplete=true and this is the first part (i==0), 
          // it's a truncated fragment from a drop, so mark as incomplete.
          const isComplete = !isLastPart && !(i === 0 && firstLineIncomplete);
          out(parts[i], isComplete);
        }
      },
    });
    this.serialOutputBatcher.start();
    // Give RegistryManager reference to SerialOutputBatcher for telemetry
    this.registryManager.setSerialOutputBatcher(this.serialOutputBatcher);
    
    try {
      // prepare environment (write files, validate code)
      const files = await this.prepareEnvironment(code);
      this.processKilled = false;

      // If stop() was called during startup, cleanup and exit early
      if (this.pendingCleanup || this.processKilled || this.state === SimulationState.STOPPED) {
        this.markTempDirForCleanup();
        return;
      }

      // Create wrapped callbacks for message queuing
      const wrapped = this.createWrappedCallbacks(onOutput, onError, onPinState);

      // Delegate compilation and process startup to helper
      await this.setupSimulationProcess(files, wrapped, opts);
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
      
      // Ensure any underlying process streams are destroyed
      this.processController.destroySockets();

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
    onIORegistry?: (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void,
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
    this.totalPausedTime = 0;
    this.registryManager.reset();
    this.registryManager.setBaudrate(this.baudrate);
    this.registryManager.enableWaitMode(5000); // 5s timeout: wait for IO_REGISTRY_START; if never comes, flush once
    this.messageQueue = [];
    this.outputBuffer = "";
    this.outputBufferIndex = 0;
    this.isSendingOutput = false;
    this.totalOutputBytes = 0;
    this.onOutputCallback = onOutput;
    this.ioRegistryCallback = onIORegistry;
  }

  /**
   * Prepare environment: write sketch files and perform basic validation.
   */
  private async prepareEnvironment(code: string): Promise<{ sketchDir: string; sketchFile: string; exeFile: string }> {
    const sketchId = randomUUID();
    const files = await this.fileBuilder.build(code, sketchId);
    this.currentSketchDir = files.sketchDir;
    return files;
  }

  /**
   * Perform compilation for local execution; docker path compiles inside container.
   * Errors bubble up so callers can handle onCompileError.
   */

  private static get compileGatekeeper() {
    return getCompileGatekeeper();
  }
  private async performCompilation(
    sketchFile: string,
    exeFile: string,
    opts: RunSketchOptions,
  ): Promise<void> {
    // enforce concurrency limit even when Docker path is chosen
    // Use HIGH priority for user-initiated simulations
    const WAIT_TIMEOUT_MS = 30000;
    let release: () => void;
    try {
      release = await Promise.race([
        SandboxRunner.compileGatekeeper.acquireHighPriority(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("compile-gatekeeper timeout")), WAIT_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      this.logger.error(`Gatekeeper wait failed: ${err instanceof Error ? err.message : String(err)}`);
      // mark runner state error to prevent further activity
      this.transitionTo(SimulationState.ERROR);
      throw err;
    }
    try {
      if (this.dockerAvailable && this.dockerImageBuilt) {
        // Docker handles compilation internally
        return;
      }
      await this.localCompiler.compile(sketchFile, exeFile);
      if (opts.onCompileSuccess) opts.onCompileSuccess();
      await this.localCompiler.makeExecutable(exeFile);
    } finally {
      try {
        release();
      } catch {
        // should never happen, but don't let it bubble
      }
    }
  }

  /**
   * Setup simulation process: compile if needed and spawn either local or docker container.
   */
  private async setupSimulationProcess(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    opts: RunSketchOptions,
  ): Promise<void> {
    const { onCompileError, onCompileSuccess, onExit, timeoutSec } = opts;
    const executionTimeout =
      timeoutSec !== undefined ? timeoutSec : SANDBOX_CONFIG.maxExecutionTimeSec;

    if (this.dockerAvailable && this.dockerImageBuilt) {
      await this.runInDocker(
        files,
        callbacks,
        onCompileError,
        onCompileSuccess,
        onExit,
        executionTimeout,
      );
    } else {
      try {
        this.isCompiling = true;
        await this.performCompilation(files.sketchFile, files.exeFile, opts);
        this.isCompiling = false;
        if (
          this.pendingCleanup ||
          this.processKilled ||
          this.state === SimulationState.STOPPED
        ) {
          this.markTempDirForCleanup();
          return;
        }

        // compile finished successfully, clear flag before running
        this.isCompiling = false;
        // Clear listeners from previous run before spawning new process
        this.processController.clearListeners();
        await this.processController.spawn(files.exeFile);
        this.processStartTime = Date.now();
        this.transitionTo(SimulationState.RUNNING);
        this.setupLocalHandlers(callbacks, onExit, executionTimeout);
      } catch (err) {
        this.isCompiling = false;
        if (onCompileError) onCompileError(err instanceof Error ? err.message : String(err));
        if (onExit) onExit(-1);
        this.transitionTo(SimulationState.STOPPED);
        this.processController.destroySockets();
        this.markTempDirForCleanup();
        throw err;
      }
    }
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
        // Filter out SIM_TELEMETRY markers and handle them separately
        if (typeof line === "string" && line.startsWith("[[SIM_TELEMETRY:") && line.endsWith("]]")) {
          // Extract JSON from the marker
          try {
            const jsonStr = line.slice("[[SIM_TELEMETRY:".length, -2);
            const metrics = JSON.parse(jsonStr);
            // Send to telemetry callback instead of serial output
            if (this.telemetryCallback) {
              this.telemetryCallback(metrics);
            }
            return; // Don't output to serial stream
          } catch (err) {
            // If parsing fails, fall through to normal output
            this.logger.warn(`Failed to parse telemetry marker: ${err}`);
          }
        }
        
        // Serial output should be batched via SerialOutputBatcher
        // This applies baudrate-based rate limiting and collects telemetry
        if (this.serialOutputBatcher) {
          // Send to batcher for rate-limiting and batching
          this.serialOutputBatcher.enqueue(line);
        } else if (onOutput && !this.processKilled) {
          // Fallback if batcher not available (shouldn't happen in normal flow)
          // Guard: discard data from OS pipe buffer after stop() killed the process
          onOutput(line, isComplete);
        }
      },
      onPinState: (
        pin: number,
        stateType: "mode" | "value" | "pwm",
        value: number,
      ) => {
          // Pin states are queued until registry is synchronized
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
          // Errors are sent immediately (not registry-dependent)
          if (onError) {
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

    // Clear listeners from previous run before spawning new process
    this.processController.clearListeners();
    await this.processController.spawn("docker", dockerArgs);
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
      // Ask controller to kill underlying process (no-op if none)
      this.processController.kill("SIGKILL");
      callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);
      this.logger.info(`Docker timeout after ${executionTimeout}s`);
    };

    this.timeoutManager.schedule(
      executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null,
      handleTimeout,
    );

    // Error handler -> wired through ProcessController
    this.processController.onError((err) => {
      this.logger.error(`Docker process error: ${err.message}`);
      callbacks.onError(`Docker process failed: ${err.message}`);
    });

    // Stdout: Not used for serial data anymore (all via stderr SERIAL_EVENT)
    // But as a safety net we parse it too in case the binary outputs directly
    // to stdout (some environments behave differently).
    // Keep handler to prevent broken pipe errors, detect end of compilation
    this.processController.onStdout((data) => {
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

      // parse stdout lines as if they came from stderr
      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        if (!line) return;
        const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
        this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
      });
    });

    // Raw stderr stream (always) for compile aggregation and optional fallback parsing.
    const useFallbackParser = !this.processController.supportsStderrLineStreaming();
    this.stderrFallbackBuffer = ""; // Reset buffer for this run

    this.processController.onStderr((data) => {
      const chunk = data.toString();
      if (isCompilePhase) {
        compileErrorBuffer += chunk;
      }

      // Fallback only when readline line-streaming is unavailable (mocked streams).
      if (useFallbackParser) {
        this.stderrFallbackBuffer += chunk;
        const lines = this.stderrFallbackBuffer.split(/\r?\n/);
        this.stderrFallbackBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
          this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
        }
      }
    });

    // Stderr line stream for O(n) parsing without manual global-buffer concatenation
    this.processController.onStderrLine((line) => {
      if (line.length === 0) return;

      const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
      this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
    });

    // Close handler wired via ProcessController
    this.processController.onClose((code) => {
      this.transitionTo(SimulationState.STOPPED);

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      // CRITICAL: Flush any remaining data in stderr fallback buffer to prevent line loss
      if (this.stderrFallbackBuffer && useFallbackParser) {
        const buffered = this.stderrFallbackBuffer;
        this.stderrFallbackBuffer = "";
        if (buffered.trim()) {
          const parsed = this.stderrParser.parseStderrLine(buffered, this.processStartTime);
          this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
        }
      }

      // CRITICAL: Flush message queue before exit to prevent losing queued output
      // Messages may be queued if sketch exits before registry wait mode timeout
      this.flushMessageQueue();
      
      // CRITICAL: Flush any buffered data in batchers before we tear them down.
      // The explicit flush ensures that performance tests cannot lose data when
      // the process terminates unexpectedly.  A helper method centralises the
      // logic so it can also be called from other shutdown paths later if
      // required.
      if (!isCompilePhase) {
        this.flushBatchers();

        if (this.serialOutputBatcher) {
          this.serialOutputBatcher.destroy();
          this.serialOutputBatcher = null;
        }
        if (this.pinStateBatcher) {
          this.pinStateBatcher.destroy();
          this.pinStateBatcher = null;
        }
      }

      if (code !== 0 && isCompilePhase && compileErrorBuffer && onCompileError) {
        onCompileError(this.cleanCompilerErrors(compileErrorBuffer));
      } else {
        if (code === 0 && !compileSuccessSent && onCompileSuccess) {
          compileSuccessSent = true;
          onCompileSuccess();
        }
      }

      if (!this.processKilled && onExit) onExit(code);
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
      this.processController.kill("SIGKILL");
      callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);
    };

    this.timeoutManager.schedule(
      executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null,
      handleTimeout,
    );

    // Stdout: while we normally expect serial data on stderr, some
    // environment setups occasionally emit content on stdout (especially when
    // shell redirections or platform differences occur).  Parse stdout lines
    // through the same parser so we never miss output in integration tests.
    this.processController.onStdout((data) => {
      const str = data.toString();

      // size accounting (keep existing behaviour)
      this.totalOutputBytes += str.length;
      if (this.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        this.stop();
        callbacks.onError("Output size limit exceeded");
        return;
      }

      // feed each line through stderr parser
      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        if (!line) return;
        const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
        this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
      });

      // we no longer completely ignore stdout; serial events above will be
      // handled.  Any remaining data (non-protocol) is simply dropped.
    });

    const useFallbackParser = !this.processController.supportsStderrLineStreaming();
    this.stderrFallbackBuffer = ""; // Reset buffer for this run

    this.processController.onStderr((data) => {
      if (useFallbackParser) {
        this.stderrFallbackBuffer += data.toString();
        const lines = this.stderrFallbackBuffer.split(/\r?\n/);
        this.stderrFallbackBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
          this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
        }
      }
    });

    this.processController.onStderrLine((line) => {
      if (line.length === 0) return;
      const parsed = this.stderrParser.parseStderrLine(line, this.processStartTime);
      this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
    });

    this.processController.onClose((code) => {
      const wasRunning = this.state === SimulationState.RUNNING;
      this.transitionTo(SimulationState.STOPPED);

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      // CRITICAL: Flush any remaining data in stderr fallback buffer to prevent line loss
      if (this.stderrFallbackBuffer) {
        const buffered = this.stderrFallbackBuffer;
        this.stderrFallbackBuffer = "";
        if (buffered.trim()) {
          const parsed = this.stderrParser.parseStderrLine(buffered, this.processStartTime);
          this.handleParsedLine(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError);
        }
      }

      // CRITICAL: Flush message queue before exit to prevent losing queued output
      this.flushMessageQueue();
      
      // CRITICAL: Flush and stop batchers to prevent data loss
      // Only stop batchers if we were actually RUNNING (not during mock test setup)
      // In mock tests, close fires during setup before state reaches RUNNING
      if (wasRunning) {
        this.flushBatchers();
        
        if (this.serialOutputBatcher) {
          this.serialOutputBatcher.destroy(); // Cleans up timer
          this.serialOutputBatcher = null;
        }
        if (this.pinStateBatcher) {
          this.pinStateBatcher.destroy(); // Cleans up timer
          this.pinStateBatcher = null;
        }
      }

      if (this.ioRegistryCallback) {
        const finalRegistry = this.registryManager.getRegistry();
        if (finalRegistry.length > 0) {
          this.ioRegistryCallback([...finalRegistry], this.baudrate, "process-exit");
        }
      }

      if (!this.processKilled && onExit) onExit(code);
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
        if (this.pinStateBatcher) {
          this.pinStateBatcher.enqueue(parsed.pin, "mode", parsed.mode);
        } else if (onPinState) {
          // Fallback if batcher not initialized
          onPinState(parsed.pin, "mode", parsed.mode);
        }
        break;

      case "pin_value":
        if (this.pinStateBatcher) {
          this.pinStateBatcher.enqueue(parsed.pin, "value", parsed.value);
        } else if (onPinState) {
          // Fallback if batcher not initialized
          onPinState(parsed.pin, "value", parsed.value);
        }
        break;

      case "pin_pwm":
        if (this.pinStateBatcher) {
          this.pinStateBatcher.enqueue(parsed.pin, "pwm", parsed.value);
        } else if (onPinState) {
          // Fallback if batcher not initialized
          onPinState(parsed.pin, "pwm", parsed.value);
        }
        break;

      case "serial_event":
        // Backpressure: if batcher exists and has already exceeded threshold,
        // stop the child process immediately before enqueuing more data.  Do
        // nothing if we're already paused globally or have already paused
        // for backpressure.
        if (
          this.serialOutputBatcher &&
          !this.backpressurePaused &&
          !this.isPaused &&
          this.baudrate > 300 && // don't throttle when baudrate is already very low
          this.serialOutputBatcher.isOverloaded()
        ) {
          this.logger.info("Backpressure: buffer overloaded, sending SIGSTOP");
          this.processController.kill("SIGSTOP");
          this.backpressurePaused = true;
        }
        // Route through SerialOutputBatcher for baudrate-based rate limiting
        if (this.serialOutputBatcher) {
          this.serialOutputBatcher.enqueue(parsed.data);
        } else if (onOutput) {
          // Fallback if batcher not initialized (should not happen in normal flow)
          onOutput(parsed.data, true);
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
    if (this.state !== SimulationState.RUNNING || !this.processController.hasProcess()) {
      return false;
    }

    // Transition first to update pauseStartTime and pause timeout clock
    if (!this.transitionTo(SimulationState.PAUSED)) {
      return false;
    }

    try {
      // Pause PinStateBatcher (stops ticking, keeps pending states)
      if (this.pinStateBatcher) {
        this.pinStateBatcher.pause();
      }
      
      // Pause SerialOutputBatcher (stops ticking, keeps pending data)
      if (this.serialOutputBatcher) {
        this.serialOutputBatcher.pause();
      }
      
      // Stop telemetry reporting while paused (no need to send data)
      this.registryManager.pauseTelemetry();
      
      // Send pause command to freeze timing in C++ (stdin write + SIGSTOP)
      if (!this.processKilled) {
        this.processController.writeStdin("[[PAUSE_TIME]]\n");
      }

      // record pause timestamp for registry events if they arrive during freeze
      this.lastPauseTimestamp = Date.now();
      this.registryManager.markPauseTime(this.lastPauseTimestamp);
      
      // Note: SIGSTOP is sent immediately after PAUSE_TIME. This can cause a race
      // condition where C++ is frozen mid-write of TIME_FROZEN message, resulting
      // in protocol fragments. The ArduinoOutputParser handles these fragments by
      // detecting and ignoring incomplete protocol messages like "]]".
      this.processController.kill("SIGSTOP");
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
    if (this.state !== SimulationState.PAUSED || !this.processController.hasProcess()) {
      return false;
    }

    try {
      // first, wake the C++ process; this reduces IPC latency window
      this.processController.kill("SIGCONT");
      const now = Date.now();
      const pauseDuration = now - (this.pauseStartTime || now);

      // accumulate so server knows total pause time (used for diagnostics if needed)
      this.totalPausedTime += pauseDuration;

      // send resume command with the measured pause duration
      if (!this.processKilled) {
        this.processController.writeStdin(`[[RESUME_TIME:${pauseDuration}]]\n`);
      }

      // clear pause timestamp marker
      this.lastPauseTimestamp = null;
      this.registryManager.markPauseTime(null);

      // Transition state *after* updating timings but before resuming batchers
      if (!this.transitionTo(SimulationState.RUNNING)) {
        return false;
      }

      // Resume PinStateBatcher
      if (this.pinStateBatcher) {
        this.pinStateBatcher.resume();
      }
      
      // Resume SerialOutputBatcher
      if (this.serialOutputBatcher) {
        this.serialOutputBatcher.resume();
      }
      
      // Resume telemetry reporting
      this.registryManager.resumeTelemetry();
      
      this.logger.info(`Simulation resumed after ${pauseDuration}ms pause (SIGCONT)`);
      
      // Send a newline to stdin to wake up any blocked read() calls
      // This ensures the C++ process processes any buffered stdin data
      if (!this.processKilled) {
        this.processController.writeStdin("\n");
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
    if (this.isRunning && !this.isPaused && this.processController.hasProcess() && !this.processKilled) {
      this.processController.writeStdin(input + "\n");
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

  /**
   * Attempts to remove the current sketch directory.  If a compile is still
   * in progress we simply mark the request and return; the caller who finished
   * the compile (success or error) will re‑invoke this method later.
   *
   * This is a defensive guard against the race observed in CI where the linker
   * was still writing the executable while another path deleted the temp
   * directory.  We check both the historic `isCompiling` flag and also ask the
   * LocalCompiler whether it still has an active process.  Under no
   * circumstances may we remove the directory while the compile phase is
   * running.
   */
  private markTempDirForCleanup() {
    if (!this.currentSketchDir) return;

    // if compile is in progress, defer permanently rather than spinning a
    // timer.  `pendingCleanup` will be cleared once the cleanup actually
    // happens, so redundant calls are harmless.
    const compilerBusy = this.isCompiling || this.localCompiler.isBusy;
    if (compilerBusy) {
      this.logger.debug("cleanup deferred until compile finishes");
      this.pendingCleanup = true;
      return;
    }

    const dir = this.currentSketchDir;
    if (!existsSync(dir)) {
      this.fileBuilder.clearCreatedSketchDir(dir);
      this.currentSketchDir = null;
      this.pendingCleanup = false;
      return;
    }

    const cleaned = this.attemptCleanupDir(dir);
    if (cleaned) {
      this.fileBuilder.clearCreatedSketchDir(dir);
      this.currentSketchDir = null;
      this.pendingCleanup = false;
    } else {
      this.scheduleCleanupRetry(dir);
    }
  }

  private attemptCleanupDir(dir: string): boolean {
    try {
      const cleanupDir = dir + ".cleanup";
      renameSync(dir, cleanupDir);
      this.logger.debug(`Marked temp directory for cleanup: ${cleanupDir}`);
      return true;
    } catch (err) {
      try {
        rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
        this.logger.debug(`Removed temp directory directly: ${dir}`);
        return true;
      } catch (rmErr) {
        this.logger.warn(
          `Failed to mark temp directory for cleanup: ${err instanceof Error ? err.message : String(err)}; remove failed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        );
        return false;
      }
    }
  }

  private scheduleCleanupRetry(dir: string): void {
    const attempts = (this.cleanupRetries.get(dir) ?? 0) + 1;
    this.cleanupRetries.set(dir, attempts);
    if (attempts > 8) return;

    const delayMs = Math.min(200 + attempts * 150, 2000);
    const timer = setTimeout(() => {
      if (!existsSync(dir)) {
        this.cleanupRetries.delete(dir);
        this.fileBuilder.clearCreatedSketchDir(dir);
        return;
      }
      const cleaned = this.attemptCleanupDir(dir);
      if (cleaned) {
        this.cleanupRetries.delete(dir);
        this.fileBuilder.clearCreatedSketchDir(dir);
      } else {
        this.scheduleCleanupRetry(dir);
      }
    }, delayMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  setPinValue(pin: number, value: number) {
    // Note: Use processKilled instead of process.killed since killed is true after any signal (including SIGSTOP/SIGCONT)
    if ((this.isRunning || this.isPaused) && this.processController.hasProcess() && !this.processKilled) {
      const command = `[[SET_PIN:${pin}:${value}]]\n`;
      const success = this.processController.writeStdin(command);

      if (!success) {
        this.logger.warn(`[SET_PIN] stdin buffer full`);
      }

      this.logger.debug(`[SET_PIN] pin=${pin} value=${value}`);
    } else {
      this.logger.warn(
        `[SET_PIN] Ignored - isRunning=${this.isRunning}, isPaused=${this.isPaused}, process=${this.processController.hasProcess()}, stdin=${this.processController.hasProcess()}, killed=${this.processKilled}`,
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

    // Check if we've sent all characters (using index instead of slice to avoid O(n²))
    if (this.outputBufferIndex >= this.outputBuffer.length) {
      this.isSendingOutput = false;
      return;
    }

    this.isSendingOutput = true;
    const char = this.outputBuffer[this.outputBufferIndex];
    this.outputBufferIndex++;

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

  async stop(): Promise<void> {
    // idempotency: multiple calls should be harmless (e.g. flush callback
    // triggers another stop).  If we're already stopped or the process was
    // previously killed, just return early.
    if (this.state === SimulationState.STOPPED || this.processKilled) {
      return;
    }

    this.transitionTo(SimulationState.STOPPED);
    this.processKilled = true;
    this.pendingCleanup = true;
    
    // Reset timing counters to avoid leaks when stop() is called manually
    this.pauseStartTime = null;
    this.totalPausedTime = 0;

    // Stop and destroy PinStateBatcher
    if (this.pinStateBatcher) {
      this.pinStateBatcher.stop();
      this.pinStateBatcher.destroy();
      this.pinStateBatcher = null;
    }
    
    // Flush any pending serial data before we kill the process.  Early
    // versions discarded the buffer on manual stop, but the integration
    // lifecycle test relies on output arriving even when the runner is
    // stopped explicitly.
    if (this.serialOutputBatcher) {
      this.serialOutputBatcher.stop(); // flush remaining bytes
      this.serialOutputBatcher.destroy();
      this.serialOutputBatcher = null;
    }
    
    // Stop telemetry reporting when simulation stops
    this.registryManager.pauseTelemetry();
    
    // Clear all callbacks for memory leak prevention
    this.onOutputCallback = null;
    this.outputCallback = null;
    this.errorCallback = null;
    this.telemetryCallback = null;
    this.pinStateCallback = null;
    this.ioRegistryCallback = undefined;

    // Cleanup all manager timers (debounce, timeout, wait timers)
    this.registryManager.reset(); // Clears debounce and wait timers
    this.timeoutManager.clear(); // Clears timeout timer
    
    // Destroy registry manager to prevent post-test logging
    this.registryManager.destroy();

    // Ask controller to hard-kill underlying process and destroy streams
    this.processController.kill("SIGKILL");
    this.processController.destroySockets();

    // Also mark registry file for delayed cleanup when stopping manually
    this.markRegistryForCleanup();

    // Mark temp directory for delayed cleanup instead of immediate deletion
    this.markTempDirForCleanup();

    // Ensure all known sketch dirs are cleaned up (covers rapid stop during startup)
    for (const dir of this.fileBuilder.getCreatedSketchDirs()) {
      if (!existsSync(dir)) {
        this.fileBuilder.clearCreatedSketchDir(dir);
        continue;
      }
      const cleaned = this.attemptCleanupDir(dir);
      if (cleaned) {
        this.fileBuilder.clearCreatedSketchDir(dir);
      } else {
        this.scheduleCleanupRetry(dir);
      }
    }

    this.outputBuffer = "";
    this.outputBufferIndex = 0;
    this.isSendingOutput = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }


  /**
   * Flush any pending data held by the batchers without destroying them.
   * Both batcher implementations already provide a `stop()` method that
   * performs a flush; we reuse that behaviour here so the callbacks will be
   * invoked with any buffered content before the caller nulls out the
   * references.
   */
  private flushBatchers(): void {
    if (this.serialOutputBatcher) {
      this.serialOutputBatcher.stop();
    }
    if (this.pinStateBatcher) {
      this.pinStateBatcher.stop();
    }
  }

  /* killProcessAndWait removed (unused) */


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

// sandboxRunner singleton removed; not used
