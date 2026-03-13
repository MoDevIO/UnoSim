// execution-manager.ts
// Orchestrates the complete simulation lifecycle (prepare, compile, run)
// Extracted from SandboxRunner to reduce runner complexity

import { randomUUID } from "node:crypto";
import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";
import type { IProcessController } from "../process-controller";
import { ArduinoOutputParser as StderrParser } from "../arduino-output-parser";
import { RegistryManager } from "../registry-manager";
import { SimulationTimeoutManager } from "../simulation-timeout-manager";
import { DockerCommandBuilder } from "../docker-command-builder";
import { SketchFileBuilder } from "../sketch-file-builder";
import { LocalCompiler } from "../local-compiler";
import { PinStateBatcher, type PinStateBatch } from "../pin-state-batcher";
import { SerialOutputBatcher } from "../serial-output-batcher";
import type { RunSketchOptions } from "../run-sketch-types";
import { getCompileGatekeeper } from "../compile-gatekeeper";
import { DockerManager } from "./docker-manager";
import { StreamHandler } from "./stream-handler";
import { FilesystemHelper } from "./filesystem-helper";

export enum SimulationState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  PAUSED = "paused",
  ERROR = "error",
}

const SANDBOX_CONFIG = {
  dockerImage: process.env.DOCKER_SANDBOX_IMAGE ?? "unowebsim-sandbox:latest",
  useDocker: true,
  maxMemoryMB: 256,
  maxCpuPercent: 50,
  maxExecutionTimeSec: 60,
  maxOutputBytes: 100 * 1024 * 1024,
  noNetwork: true,
  readOnlyFs: true,
  dropCapabilities: true,
};

// Type aliases for callbacks
type OutputCallback = (line: string, isComplete?: boolean) => void;
type PinStateCallback = (pin: number, type: "mode" | "value" | "pwm", value: number) => void;
type ErrorCallback = (line: string) => void;
type TelemetryCallback = (metrics: any) => void;
type IORegistryCallback = (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void;

// Nullable type aliases
type Nullable<T> = T | null;

export interface ExecutionState {
  outputBuffer: string;
  outputBufferIndex: number;
  isSendingOutput: boolean;
  totalOutputBytes: number;
  messageQueue: Array<{ type: string; data: any }>;
  pauseStartTime: Nullable<number>;
  totalPausedTime: number;
  isCompiling: boolean;
  currentSketchDir: Nullable<string>;
  currentRegistryFile: Nullable<string>;
  processStartTime: Nullable<number>;
  onOutputCallback: Nullable<OutputCallback>;
  pinStateCallback: Nullable<PinStateCallback>;
  errorCallback: Nullable<ErrorCallback>;
  telemetryCallback: Nullable<TelemetryCallback>;
  ioRegistryCallback?: IORegistryCallback;
  pinStateBatcher: Nullable<PinStateBatcher>;
  serialOutputBatcher: Nullable<SerialOutputBatcher>;
  backpressurePaused: boolean;
  baudrate: number;
  stderrFallbackBuffer: string;
  flushTimer: Nullable<NodeJS.Timeout>;
  state: SimulationState;
  processKilled: boolean;
  pendingCleanup: boolean;
  processController: IProcessController;
  dockerAvailable?: boolean;
  dockerImageBuilt?: boolean;
}

export class ExecutionManager {
  private readonly logger = new Logger("ExecutionManager");
  private readonly stderrParser = new StderrParser();
  private readonly registryManager: RegistryManager;
  private readonly timeoutManager: SimulationTimeoutManager;
  private readonly fileBuilder: SketchFileBuilder;
  private readonly localCompiler: LocalCompiler;
  private readonly dockerManager: DockerManager;
  private readonly streamHandler: StreamHandler;
  private readonly filesystemHelper: FilesystemHelper;

  constructor(
    registryManager: RegistryManager,
    timeoutManager: SimulationTimeoutManager,
    fileBuilder: SketchFileBuilder,
    localCompiler: LocalCompiler,
    dockerManager: DockerManager,
    streamHandler: StreamHandler,
    filesystemHelper: FilesystemHelper,
  ) {
    this.registryManager = registryManager;
    this.timeoutManager = timeoutManager;
    this.fileBuilder = fileBuilder;
    this.localCompiler = localCompiler;
    this.dockerManager = dockerManager;
    this.streamHandler = streamHandler;
    this.filesystemHelper = filesystemHelper;
  }

  private static get compileGatekeeper() {
    return getCompileGatekeeper();
  }

  /**
   * Main execution entry point: prepare, compile, and run a sketch
   */
  async runSketch(options: RunSketchOptions, state: ExecutionState): Promise<void> {
    const opts = options;
    const { code, onOutput, onError, onExit, onCompileError, onPinState, timeoutSec, onIORegistry, onTelemetry, onPinStateBatch } = opts;

    // Transition to STARTING state
    const canStart = this.transitionTo(state, SimulationState.STARTING);
    if (!canStart) {
      this.logger.warn(`runSketch ignored - invalid state: ${state.state}`);
      return;
    }

    // Clear pending cleanup for a fresh run
    state.pendingCleanup = false;

    // Create and start PinStateBatcher
    state.pinStateBatcher = new PinStateBatcher({
      tickIntervalMs: 50,
      onBatch: (batch: PinStateBatch) => {
        if (state.messageQueue && this.registryManager.isWaiting()) {
          for (const s of batch.states) {
            state.messageQueue.push({
              type: "pinState",
              data: { pin: s.pin, stateType: s.stateType, value: s.value },
            });
          }
        } else if (onPinStateBatch) {
          onPinStateBatch(batch);
        } else if (onPinState) {
          for (const s of batch.states) {
            onPinState(s.pin, s.stateType, s.value);
          }
        }
      },
    });
    state.pinStateBatcher.start();
    this.registryManager.setPinStateBatcher(state.pinStateBatcher);

    // Bind callbacks
    state.onOutputCallback = onOutput;
    state.errorCallback = onError;
    state.pinStateCallback = onPinState || null;
    state.telemetryCallback = onTelemetry || null;

    // Initialize run state
    this.initializeRunState(code, onOutput, onIORegistry, timeoutSec, state);

    // Create and start SerialOutputBatcher
    state.serialOutputBatcher = new SerialOutputBatcher({
      baudrate: state.baudrate,
      tickIntervalMs: 50,
      onChunk: (data: string, firstLineIncomplete?: boolean) => {
        if (typeof onOutput !== "function") return;

        if (state.backpressurePaused) {
          setTimeout(() => {
            if (
              state.backpressurePaused &&
              state.serialOutputBatcher &&
              !state.serialOutputBatcher.isOverloaded() &&
              state.state !== SimulationState.PAUSED &&
              state.processController.hasProcess()
            ) {
              this.logger.info("Backpressure relieved, sending SIGCONT");
              state.processController.kill("SIGCONT");
              state.backpressurePaused = false;
            }
          }, 0);
        }

        const endsWithNewline = data.endsWith("\n");
        const parts = data.split("\n");
        for (let i = 0; i < parts.length; i++) {
          const isLastPart = i === parts.length - 1;
          if (isLastPart && endsWithNewline) {
            break;
          }
          const isComplete = !isLastPart && !(i === 0 && firstLineIncomplete);
          onOutput(parts[i], isComplete);
        }
      },
    });
    state.serialOutputBatcher.start();
    this.registryManager.setSerialOutputBatcher(state.serialOutputBatcher);

    try {
      // Prepare environment
      const files = await this.prepareEnvironment(code, state);
      state.processKilled = false;

      if (state.pendingCleanup || state.processKilled || state.state === SimulationState.STOPPED) {
        this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
        return;
      }

      // Create wrapped callbacks
      const wrapped = this.createWrappedCallbacks(onOutput, onError, onPinState, state);

      // Setup and run simulation
      await this.setupSimulationProcess(files, wrapped, opts, state);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Kompilierfehler oder Timeout: ${errorMessage}`);
      if (onCompileError) {
        onCompileError(errorMessage);
      }
      if (onExit) {
        onExit(-1);
      }
      state.processController.destroySockets();
      this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
    }
  }

  /**
   * Initialize run state for a new execution
   */
  private initializeRunState(
    code: string,
    onOutput: (line: string, isComplete?: boolean) => void,
    onIORegistry?: (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void,
    timeoutSec?: number,
    state?: ExecutionState,
  ): void {
    if (!state) return;

    const baudMatch = /Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/.exec(code);
    state.baudrate = baudMatch ? Number.parseInt(baudMatch[1]) : 9600;

    const executionTimeout = timeoutSec ?? SANDBOX_CONFIG.maxExecutionTimeSec;
    this.logger.info(
      `🕐 runSketch called with timeoutSec=${timeoutSec}, using executionTimeout=${executionTimeout}s`,
    );
    this.logger.info(`Parsed baudrate: ${state.baudrate}`);

    state.pauseStartTime = null;
    state.totalPausedTime = 0;
    this.registryManager.reset();
    this.registryManager.setBaudrate(state.baudrate);
    this.registryManager.enableWaitMode(5000);
    state.messageQueue = [];
    state.outputBuffer = "";
    state.outputBufferIndex = 0;
    state.isSendingOutput = false;
    state.totalOutputBytes = 0;
    state.onOutputCallback = onOutput;
    state.ioRegistryCallback = onIORegistry;
  }

  /**
   * Prepare environment: write sketch files
   */
  private async prepareEnvironment(
    code: string,
    state: ExecutionState,
  ): Promise<{ sketchDir: string; sketchFile: string; exeFile: string }> {
    const sketchId = randomUUID();
    const files = await this.fileBuilder.build(code, sketchId);
    state.currentSketchDir = files.sketchDir;
    return files;
  }

  /**
   * Perform compilation (local path only; Docker handles internally)
   */
  private async performCompilation(
    sketchFile: string,
    exeFile: string,
    opts: RunSketchOptions,
    state: ExecutionState,
  ): Promise<void> {
    const WAIT_TIMEOUT_MS = 30000;
    let release: () => void;
    try {
      release = await Promise.race([
        ExecutionManager.compileGatekeeper.acquireHighPriority(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("compile-gatekeeper timeout")), WAIT_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      this.logger.error(`Gatekeeper wait failed: ${err instanceof Error ? err.message : String(err)}`);
      this.transitionTo(state, SimulationState.ERROR);
      throw err;
    }
    try {
      if (state.processController && this.localCompiler) {
        await this.localCompiler.compile(sketchFile, exeFile);
        if (opts.onCompileSuccess) opts.onCompileSuccess();
        await this.localCompiler.makeExecutable(exeFile);
      }
    } finally {
      try {
        release();
      } catch {
        // should never happen
      }
    }
  }

  /**
   * Setup simulation process: compile and spawn
   */
  private async setupSimulationProcess(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    opts: RunSketchOptions,
    state: ExecutionState,
  ): Promise<void> {
    const { timeoutSec } = opts;
    const executionTimeout = timeoutSec ?? SANDBOX_CONFIG.maxExecutionTimeSec;

    const useDocker = !!(state.dockerAvailable && state.dockerImageBuilt);

    if (useDocker) {
      await this.runDocker(files, callbacks, opts, state, executionTimeout);
    } else {
      await this.runLocal(files, callbacks, opts, state, executionTimeout);
    }
  }

  /**
   * Run in Docker container
   */
  private async runDocker(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    opts: RunSketchOptions,
    state: ExecutionState,
    executionTimeout: number,
  ): Promise<void> {
    const dockerArgs = DockerCommandBuilder.buildSecureRunCommand({
      sketchDir: files.sketchDir,
      memoryMB: SANDBOX_CONFIG.maxMemoryMB,
      cpuLimit: "0.5",
      pidsLimit: 50,
      imageName: SANDBOX_CONFIG.dockerImage,
      command: DockerCommandBuilder.buildCompileAndRunCommand(),
      arduinoCacheDir: process.env.ARDUINO_CACHE_DIR,
    });

    const { onCompileError, onCompileSuccess, onExit } = opts;

    try {
      state.processController.clearListeners();
      await state.processController.spawn("docker", dockerArgs);
      this.logger.info("🚀 Docker: Compile + Run in single container");
      state.processStartTime = Date.now();
      this.transitionTo(state, SimulationState.RUNNING);

      const dockerState = {
        isCompilePhase: { value: true },
        compileErrorBuffer: { value: "" },
        compileSuccessSent: { value: false },
        totalOutputBytes: state.totalOutputBytes,
        processStartTime: state.processStartTime,
        stderrFallbackBuffer: state.stderrFallbackBuffer,
        flushTimer: state.flushTimer,
      };

      const dockerCallbacks = {
        onOutput: callbacks.onOutput,
        onPinState: callbacks.onPinState,
        onError: callbacks.onError,
      };

      state.processController.onError((err) => {
        this.logger.error(`Docker process error: ${err.message}`);
        callbacks.onError(`Docker process failed: ${err.message}`);
      });

      state.processController.onClose((code) => {
        this.transitionTo(state, SimulationState.STOPPED);
        if (state.flushTimer) {
          clearTimeout(state.flushTimer);
          state.flushTimer = null;
        }

        const isCompilePhase = (dockerState as any).isCompilePhase?.value ?? false;
        if (code !== 0 && isCompilePhase && (dockerState as any).compileErrorBuffer?.value && onCompileError) {
          onCompileError(this.cleanCompilerErrors((dockerState as any).compileErrorBuffer.value));
        } else if (code === 0 && onCompileSuccess) {
          onCompileSuccess();
        }

        if (!state.processKilled && onExit) onExit(code);
        this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
      });

      this.dockerManager.setupDockerHandlers(
        dockerCallbacks,
        dockerState,
        () => this.flushBatchers(state),
        () => this.flushMessageQueue(state),
        state.processKilled,
        onCompileError,
        onCompileSuccess,
        undefined,
        executionTimeout,
      );
    } catch (err) {
      this.logger.error(`Docker process spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      this.transitionTo(state, SimulationState.STOPPED);
      state.processController.destroySockets();
      this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
      throw err;
    }
  }

  /**
   * Run locally (without Docker)
   */
  private async runLocal(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: any,
    opts: RunSketchOptions,
    state: ExecutionState,
    executionTimeout: number,
  ): Promise<void> {
    const { onCompileError, onExit } = opts;

    try {
      state.isCompiling = true;
      await this.performCompilation(files.sketchFile, files.exeFile, opts, state);
      state.isCompiling = false;

      if (state.pendingCleanup || state.processKilled || state.state === SimulationState.STOPPED) {
        this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
        return;
      }

      state.processController.clearListeners();
      await state.processController.spawn(files.exeFile);
      state.processStartTime = Date.now();
      this.transitionTo(state, SimulationState.RUNNING);
      this.setupLocalHandlers(callbacks, onExit, executionTimeout, state);
    } catch (err) {
      state.isCompiling = false;
      if (onCompileError) onCompileError(err instanceof Error ? err.message : String(err));
      if (onExit) onExit(-1);
      this.transitionTo(state, SimulationState.STOPPED);
      state.processController.destroySockets();
      this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
      throw err;
    }
  }

  /**
   * Setup event handlers for local process
   */
  private setupLocalHandlers(
    callbacks: any,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
    state?: ExecutionState,
  ): void {
    if (!state) return;

    const handleTimeout = () => {
      state.processController.kill("SIGKILL");
      callbacks.onOutput(`--- Simulation timeout (${executionTimeout}s) ---`, true);
    };

    this.timeoutManager.schedule(executionTimeout && executionTimeout > 0 ? executionTimeout * 1000 : null, handleTimeout);

    state.processController.onStdout((data) => {
      const str = data.toString();
      state.totalOutputBytes += str.length;
      if (state.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) {
        state.processController.kill("SIGKILL"); // Trigger stop
        callbacks.onError("Output size limit exceeded");
        return;
      }

      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        if (!line) return;
        const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime);
        this.delegateParsedLineToStreamHandler(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError, state);
      });
    });

    const useFallbackParser = !state.processController.supportsStderrLineStreaming();
    state.stderrFallbackBuffer = "";

    state.processController.onStderr((data) => {
      if (useFallbackParser) {
        state.stderrFallbackBuffer += data.toString();
        const lines = state.stderrFallbackBuffer.split(/\r?\n/);
        state.stderrFallbackBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime);
          this.delegateParsedLineToStreamHandler(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError, state);
        }
      }
    });

    state.processController.onStderrLine((line) => {
      if (line.length === 0) return;
      const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime);
      this.delegateParsedLineToStreamHandler(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError, state);
    });

    state.processController.onClose((code) => {
      const wasRunning = state.state === SimulationState.RUNNING;
      this.transitionTo(state, SimulationState.STOPPED);

      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }

      if (state.stderrFallbackBuffer) {
        const buffered = state.stderrFallbackBuffer;
        state.stderrFallbackBuffer = "";
        if (buffered.trim()) {
          const parsed = this.stderrParser.parseStderrLine(buffered, state.processStartTime);
          this.delegateParsedLineToStreamHandler(parsed, callbacks.onPinState, callbacks.onOutput, callbacks.onError, state);
        }
      }

      this.flushMessageQueue(state);

      if (wasRunning) {
        this.flushBatchers(state);
        if (state.serialOutputBatcher) {
          state.serialOutputBatcher.destroy();
          state.serialOutputBatcher = null;
        }
        if (state.pinStateBatcher) {
          state.pinStateBatcher.destroy();
          state.pinStateBatcher = null;
        }
      }

      if (state.ioRegistryCallback) {
        const finalRegistry = this.registryManager.getRegistry();
        if (finalRegistry.length > 0) {
          state.ioRegistryCallback([...finalRegistry], state.baudrate, "process-exit");
        }
      }

      if (!state.processKilled && onExit) onExit(code);
      this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
    });
  }

  /**
   * Create wrapped callbacks for message queuing
   */
  private createWrappedCallbacks(
    onOutput: OutputCallback,
    onError: ErrorCallback,
    onPinState?: PinStateCallback,
    state?: ExecutionState,
  ) {
    return {
      onOutput: (line: string, isComplete?: boolean) => {
        if (typeof line === "string" && line.startsWith("[[SIM_TELEMETRY:") && line.endsWith("]]")) {
          try {
            const jsonStr = line.slice("[[SIM_TELEMETRY:".length, -2);
            const metrics = JSON.parse(jsonStr);
            if (state?.telemetryCallback) {
              state.telemetryCallback(metrics);
            }
            return;
          } catch (err) {
            this.logger.warn(`Failed to parse telemetry marker: ${err}`);
          }
        }

        if (state?.serialOutputBatcher) {
          state.serialOutputBatcher.enqueue(line);
        } else if (onOutput && state?.processKilled === false) {
          onOutput(line, isComplete);
        }
      },
      onPinState: (pin: number, stateType: "mode" | "value" | "pwm", value: number) => {
        if (state && this.registryManager.isWaiting()) {
          state.messageQueue.push({
            type: "pinState",
            data: { pin, stateType, value },
          });
        } else if (onPinState) {
          onPinState(pin, stateType, value);
        }
      },
      onError: (line: string) => {
        if (onError) {
          onError(line);
        }
      },
    };
  }

  /**
   * Delegate parsed line to StreamHandler
   */
  private delegateParsedLineToStreamHandler(
    parsed: any,
    onPinState?: (pin: number, type: "mode" | "value" | "pwm", value: number) => void,
    onOutput?: (line: string, isComplete?: boolean) => void,
    onError?: (line: string) => void,
    state?: ExecutionState,
  ): void {
    if (!state) return;

    const streamState = {
      pinStateBatcher: state.pinStateBatcher,
      serialOutputBatcher: state.serialOutputBatcher,
      backpressurePaused: state.backpressurePaused,
      isPaused: state.state === SimulationState.PAUSED,
      baudrate: state.baudrate,
      registryManager: this.registryManager,
    };

    const callbacks = {
      onPinState,
      onOutput,
      onError,
    };

    this.streamHandler.handleParsedLine(parsed, streamState, callbacks);
    state.backpressurePaused = streamState.backpressurePaused;
  }

  /**
   * Clean compiler errors (remove full paths)
   */
  private cleanCompilerErrors(errors: string): string {
    return errors
      .replaceAll("/sandbox/sketch.cpp", "sketch.ino")
      .replaceAll(/\/[^\s:]+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino")
      .trim();
  }

  /**
   * Flush message queue
   */
  flushMessageQueue(state: ExecutionState): void {
    if (state.messageQueue.length === 0) {
      return;
    }

    this.logger.debug(`[Registry] Flushing ${state.messageQueue.length} queued messages`);

    const queue = state.messageQueue;
    state.messageQueue = [];

    for (const msg of queue) {
      if (msg.type === "pinState" && state.pinStateCallback) {
        state.pinStateCallback(msg.data.pin, msg.data.stateType, msg.data.value);
      } else if (msg.type === "output" && state.onOutputCallback) {
        state.onOutputCallback(msg.data.line, msg.data.isComplete);
      } else if (msg.type === "error" && state.errorCallback) {
        state.errorCallback(msg.data.line);
      }
    }
  }

  /**
   * Flush batchers
   */
  private flushBatchers(state: ExecutionState): void {
    if (state.serialOutputBatcher) {
      state.serialOutputBatcher.stop();
    }
    if (state.pinStateBatcher) {
      state.pinStateBatcher.stop();
    }
  }

  /**
   * State transition (delegated from runner)
   */
  private transitionTo(state: ExecutionState, newState: SimulationState): boolean {
    // Guard: no transition from ERROR
    if (state.state === SimulationState.ERROR) {
      return false;
    }

    // Guard: can't stop paused simulation
    if (newState === SimulationState.STOPPED && state.state === SimulationState.PAUSED) {
      return true; // Allow stop from paused
    }

    // Check valid transitions
    const validTransitions: Record<SimulationState, SimulationState[]> = {
      [SimulationState.STOPPED]: [SimulationState.STARTING],
      [SimulationState.STARTING]: [SimulationState.STOPPED, SimulationState.RUNNING, SimulationState.ERROR],
      [SimulationState.RUNNING]: [SimulationState.PAUSED, SimulationState.STOPPED, SimulationState.ERROR],
      [SimulationState.PAUSED]: [SimulationState.RUNNING, SimulationState.STOPPED, SimulationState.ERROR],
      [SimulationState.ERROR]: [],
    };

    if (!validTransitions[state.state].includes(newState)) {
      return false;
    }

    state.state = newState;
    return true;
  }

  /**
   * Extract filesystem state for delegation
   */
  private extractFilesystemState(state: ExecutionState) {
    return {
      currentSketchDir: state.currentSketchDir,
      isCompiling: state.isCompiling,
      pendingCleanup: state.pendingCleanup,
      cleanupRetries: new Map(),
      currentRegistryFile: null,
    };
  }
}
