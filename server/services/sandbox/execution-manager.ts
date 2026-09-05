// execution-manager.ts
// Orchestrates the complete simulation lifecycle (prepare, compile, run)
// Extracted from SandboxRunner to reduce runner complexity

import { randomUUID } from "node:crypto";
import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";
import type { PinStateChange } from "@shared/types/arduino.types";
import type { IProcessController } from "../process-controller";
import { ArduinoOutputParser as StderrParser } from "../arduino-output-parser";
import { RegistryManager } from "../registry-manager";
import { SimulationTimeoutManager } from "../simulation-timeout-manager";
import { SketchFileBuilder } from "../sketch-file-builder";
import { LocalCompiler } from "../local-compiler";
import { PinStateBatcher, type PinStateBatch } from "../pin-state-batcher";
import { SerialOutputBatcher } from "../serial-output-batcher";
import type { RunSketchOptions } from "../run-sketch-types";
import { getUnifiedGatekeeper } from "../unified-gatekeeper";
import { getDockerCompileSemaphore } from "./docker-compile-semaphore";
import { DockerManager } from "./docker-manager";
import { StreamHandler } from "./stream-handler";
import { FilesystemHelper } from "./filesystem-helper";
import { config } from "../../config";
import { normalizeBaudrate, normalizeSimulationTimeout } from "@shared/input-limits";
import { canTransition } from "../simulation-state-machine";
import { createProcessExecutionPort, type ProcessExecution } from "../process-execution-port";
import { OutputCollector } from "../output-collector";
import { flushMessageQueue, flushBatchers, cleanupDockerContainer } from "./execution-phases/cleanup-phase";
import { scheduleExecutionTimeout } from "./execution-phases/timeout-phase";
import { createStreamCallbacks, delegateParsedLineToStreamHandler, handleStderrFallbackData } from "./execution-phases/stream-phase";
import { runLocalStart, runDockerStart, type LocalStartContext, type DockerStartContext, type DockerStartParams, type TransitionToFn } from "./execution-phases/start-phase";

export enum SimulationState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  PAUSED = "paused",
  ERROR = "error",
}

export const SANDBOX_CONFIG = {
  dockerImage: config.sandbox.dockerImage,
  useDocker: config.simulationMode === "docker-sandbox",
  maxMemoryMB: config.sandbox.resources.memoryMB,
  cpuLimit: config.sandbox.resources.cpuLimit,
  maxCpuPercent: Math.round(Number.parseFloat(config.sandbox.resources.cpuLimit) * 100),
  maxExecutionTimeSec: config.sandbox.resources.maxExecutionTimeSec,
  maxOutputBytes: config.sandbox.resources.maxOutputBytes,
  noNetwork: true,
  readOnlyFs: true,
  dropCapabilities: true,
};

// Type aliases for callbacks
// Output / error / pin state callbacks (from sandbox runner to consumers)
type OutputCallback = (line: string, isComplete?: boolean) => void;
type PinStateCallback = (pin: number, type: PinStateChange, value: number) => void;
type ErrorCallback = (line: string) => void;

export interface TelemetryMetrics {
  timestamp: number;
  intendedPinChangesPerSecond: number;
  actualPinChangesPerSecond: number;
  droppedPinChangesPerSecond: number;
  batchesPerSecond: number;
  avgStatesPerBatch: number;
  serialOutputPerSecond: number;
  serialBytesPerSecond: number;
  serialBytesTotal: number;
  serialIntendedBytesPerSecond: number;
  serialDroppedBytesPerSecond: number;
}

type TelemetryCallback = (metrics: TelemetryMetrics) => void;

type ProcessMessage =
  | { type: "pinState"; data: { pin: number; stateType: PinStateChange; value: number } }
  | { type: "output"; data: { line: string; isComplete?: boolean } }
  | { type: "error"; data: { line: string } };

type DockerState = {
  isCompilePhase: { value: boolean };
  compileErrorBuffer: { value: string };
  compileSuccessSent: { value: boolean };
  totalOutputBytes: { value: number };
  processStartTime: number | null;
  stderrFallbackBuffer: string;
  flushTimer: NodeJS.Timeout | null;
};

interface ExecutionCallbacks {
  onOutput: OutputCallback;
  onError: ErrorCallback;
  onPinState?: PinStateCallback;
}

type IORegistryCallback = (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void;

// Nullable type aliases
type Nullable<T> = T | null;

export interface ExecutionState {
  outputBuffer: string;
  outputBufferIndex: number;
  isSendingOutput: boolean;
  totalOutputBytes: number;
  messageQueue: ProcessMessage[];
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
  currentContainerName?: string;
  dockerAvailable?: boolean;
  dockerImageBuilt?: boolean;
  outputCollector?: OutputCollector;
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
  private readonly processExecutor: ProcessExecution;

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
    this.processExecutor = createProcessExecutionPort();
  }

  private static get compileGatekeeper() {
    return getUnifiedGatekeeper();
  }

  /**
   * Main execution entry point: orchestrates prepare → start → stream → timeout → cleanup
   */
  async runSketch(options: RunSketchOptions, state: ExecutionState): Promise<void> {
    const { code, onOutput, onError, onExit, onCompileError, onPinState, timeoutSec, onIORegistry, onTelemetry, onPinStateBatch } = options;

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
      tickIntervalMs: config.timeouts.batcherTickIntervalMs,
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
      tickIntervalMs: config.timeouts.batcherTickIntervalMs,
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
      const wrapped = createStreamCallbacks(onOutput, onError, onPinState, state, {
        registryManager: this.registryManager,
        logger: this.logger,
      });

      // Setup and run simulation
      await this.setupSimulationProcess(files, wrapped, options, state);
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
    state.baudrate = normalizeBaudrate(
      baudMatch ? Number.parseInt(baudMatch[1]) : 9600,
    );

    const executionTimeout = normalizeSimulationTimeout(timeoutSec);
    this.logger.info(
      `🕐 runSketch called with timeoutSec=${timeoutSec}, using executionTimeout=${executionTimeout}s`,
    );
    this.logger.info(`Parsed baudrate: ${state.baudrate}`);

    state.pauseStartTime = null;
    state.totalPausedTime = 0;
    this.registryManager.reset();
    this.registryManager.setBaudrate(state.baudrate);
    this.registryManager.enableWaitMode(config.timeouts.registryWaitModeAfterStartMs);
    state.messageQueue = [];
    state.outputBuffer = "";
    state.outputBufferIndex = 0;
    state.isSendingOutput = false;
    state.totalOutputBytes = 0;
    state.outputCollector = new OutputCollector(SANDBOX_CONFIG.maxOutputBytes);
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
    const WAIT_TIMEOUT_MS = config.timeouts.compileGatekeeperAcquireMs;
    let release: () => void;
    try {
      release = await Promise.race([
        ExecutionManager.compileGatekeeper.acquireCompileSlotHighPriority(
          "simulation-start",
          opts.onCompileQueued,
        ),
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
    callbacks: ExecutionCallbacks,
    opts: RunSketchOptions,
    state: ExecutionState,
  ): Promise<void> {
    const { timeoutSec } = opts;
    const executionTimeout = normalizeSimulationTimeout(timeoutSec);

    const useDocker = !!(state.dockerAvailable && state.dockerImageBuilt);

    if (useDocker) {
      await this.runDocker(files, callbacks, opts, state, executionTimeout);
    } else if (config.serverMode === "docker" && config.simulationMode === "docker-sandbox") {
      throw new Error("Docker sandbox is unavailable; refusing local fallback in production mode");
    } else {
      await this.runLocal(files, callbacks, opts, state, executionTimeout);
    }
  }

  /**
   * Run in Docker container
   */
  private async runDocker(
    files: { sketchDir: string; sketchFile: string; exeFile: string },
    callbacks: ExecutionCallbacks,
    opts: RunSketchOptions,
    state: ExecutionState,
    executionTimeout: number,
  ): Promise<void> {
    const containerName = `unosim-sandbox-${randomUUID()}`;
    state.currentContainerName = containerName;

    const { onCompileError, onCompileSuccess, onExit } = opts;

    // ── Docker compile gating ─────────────────────────────────────────────────
    // Limit the number of simultaneous g++ compilations inside Docker containers
    // to prevent CPU starvation when many students start simulations at once.
    // The slot is released once [[RUNTIME_START]] is detected (compile done) or
    // on any error, so the semaphore only covers the compile phase.
    const releaseSemaphore = await getDockerCompileSemaphore().acquire(() => {
      opts.onCompileQueued?.();
    }, config.timeouts.compileGatekeeperAcquireMs);

    // Guard: abort if the simulation was stopped while we were waiting
    if (state.processKilled || state.pendingCleanup || state.state === SimulationState.STOPPED) {
      releaseSemaphore();
      return;
    }

    // Release wrapper – idempotent, called from compile-phase callbacks or onClose
    let semaphoreReleased = false;
    const releaseOnce = () => {
      if (!semaphoreReleased) {
        semaphoreReleased = true;
        releaseSemaphore();
      }
    };

    // Wrap compile callbacks so the semaphore is released as soon as the
    // compile phase ends (success or error), freeing the slot for the next waiter.
    const wrappedOnCompileSuccess = () => {
      releaseOnce();
      onCompileSuccess?.();
    };
    const wrappedOnCompileError = (err: string) => {
      releaseOnce();
      onCompileError?.(err);
    };

    try {
      // Start-Phase extrahiert: Docker-Command + Spawn + processStartTime + RUNNING-Transition
      const dockerStartContext: DockerStartContext = {
        processController: state.processController,
        transitionTo: this.transitionTo.bind(this) as TransitionToFn,
      };
      const dockerStartParams: DockerStartParams = {
        sketchDir: files.sketchDir,
        containerName,
      };
      await runDockerStart(dockerStartParams, state, dockerStartContext);
      this.logger.info("🚀 Docker: Compile + Run in single container");

      const dockerState: DockerState = {
        isCompilePhase: { value: true },
        compileErrorBuffer: { value: "" },
        compileSuccessSent: { value: false },
        totalOutputBytes: { value: state.totalOutputBytes },
        processStartTime: state.processStartTime,
        stderrFallbackBuffer: state.stderrFallbackBuffer,
        flushTimer: state.flushTimer,
      };

      const dockerCallbacks = {
        onOutput: callbacks.onOutput,
        onPinState: callbacks.onPinState ?? (() => {}),
        onError: callbacks.onError,
      };

      state.processController.onError((err) => {
        this.logger.error(`Docker process error: ${err.message}`);
        callbacks.onError(`Docker process failed: ${err.message}`);
      });

      // Single close handler: state transition + cleanup.
      // Note: compile callbacks, batchers, and onExit are handled exclusively
      // by dockerManager.setupDockerHandlers → handleDockerExit to avoid
      // double invocation (which previously caused a double "stopped" event).
      // releaseOnce() here is a safety net for edge cases where the container
      // dies before emitting any compile output.
      state.processController.onClose((_code) => {
        releaseOnce();
        this.transitionTo(state, SimulationState.STOPPED);
        if (state.flushTimer) {
          clearTimeout(state.flushTimer);
          state.flushTimer = null;
        }
        void cleanupDockerContainer(state.currentContainerName, {
          processExecutor: this.processExecutor,
          logger: this.logger,
        });
        this.filesystemHelper.markTempDirForCleanup(this.extractFilesystemState(state));
      });

      this.dockerManager.setupDockerHandlers(
        dockerCallbacks,
        dockerState,
        {
        flushBatchers: () => flushBatchers(state),
        flushMessageQueue: () => flushMessageQueue(state),
          getProcessKilled: () => state.processKilled,
          executionTimeout,
        },
        {
          onCompileError: wrappedOnCompileError,
          onCompileSuccess: wrappedOnCompileSuccess,
          onExit,
        },
      );
    } catch (err) {
      releaseOnce();
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
    callbacks: ExecutionCallbacks,
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

      // Start-Phase extrahiert: Process-Spawn + processStartTime + RUNNING-Transition
      const startContext: LocalStartContext = {
        processController: state.processController,
        transitionTo: this.transitionTo.bind(this) as TransitionToFn,
      };
      await runLocalStart(files.exeFile, state, startContext);
      
      // Stream-Phase: Event-Handler registrieren
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
    callbacks: ExecutionCallbacks,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
    state?: ExecutionState,
  ): void {
    if (!state) return;

    scheduleExecutionTimeout(this.timeoutManager, executionTimeout, state, callbacks, {
      processExecutor: this.processExecutor,
      logger: this.logger,
    });

    state.processController.onStdout((data) => {
      const str = data.toString();
      const withinLimit = state.outputCollector?.append(str) ?? false;
      state.totalOutputBytes = state.outputCollector?.totalBytes ?? state.totalOutputBytes + str.length;
      if (!withinLimit) {
        state.processController.kill("SIGKILL"); // Trigger stop
        callbacks.onError("Output size limit exceeded");
        return;
      }

      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        if (!line) return;
        const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime);
        delegateParsedLineToStreamHandler(parsed, state, callbacks, {
          registryManager: this.registryManager,
          streamHandler: this.streamHandler,
        });
      });
    });

    const useFallbackParser = !state.processController.supportsStderrLineStreaming();
    state.stderrFallbackBuffer = "";

    state.processController.onStderr((data) => {
      if (useFallbackParser) {
        handleStderrFallbackData(data, state, callbacks, {
          registryManager: this.registryManager,
          streamHandler: this.streamHandler,
          stderrParser: this.stderrParser,
        });
      }
    });

    state.processController.onStderrLine((line) => {
      if (line.length === 0) return;
      const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime);
      delegateParsedLineToStreamHandler(parsed, state, callbacks, {
        registryManager: this.registryManager,
        streamHandler: this.streamHandler,
      });
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
          delegateParsedLineToStreamHandler(parsed, state, callbacks, {
            registryManager: this.registryManager,
            streamHandler: this.streamHandler,
          });
        }
      }

      flushMessageQueue(state);

      if (wasRunning) {
        flushBatchers(state);
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
   * State transition (delegated from runner)
   */
  private transitionTo(state: ExecutionState, newState: SimulationState): boolean {
    if (!canTransition(state.state, newState)) return false;
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
