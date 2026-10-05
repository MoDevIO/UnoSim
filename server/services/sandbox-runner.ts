// Lean orchestrator for Arduino sketch simulation
// Delegates execution flow to ExecutionManager, manages state transitions and process control

import { ProcessController, type IProcessController } from "./process-controller";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@shared/logger";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import { ArduinoOutputParser as StderrParser } from "./arduino-output-parser";
import { RegistryManager } from "./registry-manager";
import { SimulationTimeoutManager } from "./simulation-timeout-manager";
import { SketchFileBuilder } from "./sketch-file-builder";
import { LocalCompiler } from "./local-compiler";
import type { RunSketchOptions } from "./run-sketch-types";
import { ProcessExecutor } from "./process-executor";

// Manager delegation imports
import { DockerManager } from "./sandbox/docker-manager";
import { StreamHandler } from "./sandbox/stream-handler";
import { FilesystemHelper } from "./sandbox/filesystem-helper";
import { ExecutionManager, type ExecutionState, SimulationState, SANDBOX_CONFIG } from "./sandbox/execution-manager";
import { cleanupExecutionContainer, flushMessageQueue } from "./sandbox/execution-phases/cleanup-phase";
import { config } from "../config";

export class SandboxRunner {
  private static missingDockerSocketLogEmitted = false;

  private readonly logger = new Logger("SandboxRunner");
  private readonly tempDir: string;
  private readonly processController: IProcessController;
  private readonly registryManager: RegistryManager;
  private readonly timeoutManager: SimulationTimeoutManager;
  private readonly fileBuilder: SketchFileBuilder;
  private readonly localCompiler: LocalCompiler;
  private readonly dockerManager: DockerManager;
  private readonly streamHandler: StreamHandler;
  private readonly filesystemHelper: FilesystemHelper;
  private readonly executionManager: ExecutionManager;
  private readonly executionState: ExecutionState;
  private readonly processExecutor: ProcessExecutor;

  private controlCompletion?: Promise<boolean>;
  private controlPending = false;

  /** Completion of the last accepted control; Stop never waits for it. */
  get controlResult(): Promise<boolean> | undefined {
    return this.controlCompletion;
  }

  get hasPendingContainerCleanup(): boolean {
    return Boolean(this.executionState.currentContainerName);
  }

  private dockerAvailable = false;
  private dockerImageBuilt = false;
  private dockerChecked = false;
  private tempDirCreated = false;

  private get state(): SimulationState { return this.executionState?.state ?? SimulationState.STOPPED; }
  private set state(v: SimulationState | string) { this.executionState.state = v as SimulationState; }

  constructor(options?: { tempDir?: string; processController?: IProcessController }) {
    this.processController = options?.processController ?? new ProcessController();
    this.tempDir = options?.tempDir ?? join(getFastTmpBaseDir(), "unosim-temp");
    this.timeoutManager = new SimulationTimeoutManager();
    this.fileBuilder = new SketchFileBuilder(this.tempDir);
    this.localCompiler = new LocalCompiler();
    this.processExecutor = new ProcessExecutor();
    const stderrParser = new StderrParser();
    
    this.registryManager = new RegistryManager({
      onUpdate: (registry, baudrate, reason) => {
        if (this.executionState?.ioRegistryCallback) {
          this.executionState.ioRegistryCallback(registry, baudrate, reason);
        }
        flushMessageQueue(this.executionState);
      },
      onTelemetry: (metrics) => {
        if (this.executionState?.telemetryCallback) {
          this.executionState.telemetryCallback(metrics);
        }
      },
      enableTelemetry: true,
    });

    // Initialize managers with dependencies
    this.dockerManager = new DockerManager(
      this.processController,
      stderrParser,
      this.timeoutManager,
      (parsed, callbacks) => {
        // Delegate parsed line to stream handler
        if (this.executionState) {
          const streamState = {
            pinStateBatcher: this.executionState.pinStateBatcher,
            serialOutputBatcher: this.executionState.serialOutputBatcher,
            backpressurePaused: this.executionState.backpressurePaused,
            isPaused: this.executionState.state === SimulationState.PAUSED,
            baudrate: this.executionState.baudrate,
            registryManager: this.registryManager,
          };
          this.streamHandler.handleParsedLine(parsed, streamState, callbacks);
          this.executionState.backpressurePaused = streamState.backpressurePaused;
        }
      },
      () => { this.executionState.terminationRequested = true; },
    );
    this.streamHandler = new StreamHandler(this.processController);
    this.filesystemHelper = new FilesystemHelper(this.fileBuilder, this.localCompiler);

    // Initialize execution manager with dependencies
    this.executionManager = new ExecutionManager(
      this.registryManager,
      this.timeoutManager,
      this.fileBuilder,
      this.localCompiler,
      this.dockerManager,
      this.streamHandler,
      this.filesystemHelper,
    );

    // Initialize execution state
    this.executionState = {
      outputBuffer: "",
      outputBufferIndex: 0,
      isSendingOutput: false,
      totalOutputBytes: 0,
      messageQueue: [],
      pauseStartTime: null,
      totalPausedTime: 0,
      isCompiling: false,
      currentSketchDir: null,
      currentRegistryFile: null,
      processStartTime: null,
      onOutputCallback: null,
      pinStateCallback: null,
      errorCallback: null,
      telemetryCallback: null,
      ioRegistryCallback: undefined,
      pinStateBatcher: null,
      serialOutputBatcher: null,
      backpressurePaused: false,
      baudrate: 9600,
      stderrFallbackBuffer: "",
      flushTimer: null,
      state: SimulationState.STOPPED,
      processKilled: false,
      pendingCleanup: false,
      processController: this.processController,
    };

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

  async initialize(): Promise<void> {
    await this.ensureDockerChecked();
    if (
      config.serverMode === "docker" &&
      (!this.dockerAvailable || !this.dockerImageBuilt)
    ) {
      throw new Error("Docker sandbox is unavailable");
    }
  }

  private get pauseStartTime(): number | null { return this.executionState.pauseStartTime; }



  async runSketch(options: RunSketchOptions): Promise<boolean> {
    await this.ensureDockerChecked();
    await this.ensureTempDir();
    this.executionState.dockerAvailable = this.dockerAvailable;
    this.executionState.dockerImageBuilt = this.dockerImageBuilt;
    return this.executionManager.runSketch(options, this.executionState);
  }

  private async ensureDockerChecked(): Promise<void> {
    if (this.dockerChecked) return;
    if (config.serverMode === "local") {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      this.dockerChecked = true;
      return;
    }
    
    // Always use async path; ProcessExecutor handles test mocking internally
    try {
      await this.checkDockerAsync();
    } catch {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
    } finally {
      this.dockerChecked = true;
    }
  }

  private async checkDockerAsync(): Promise<void> {
    const dockerSocketPath = this.getDockerSocketPath();
    if (dockerSocketPath && !existsSync(dockerSocketPath)) {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      this.logMissingDockerSocketOnce(dockerSocketPath);
      return;
    }

    // Use ProcessExecutor for all Docker checks
    // docker --version
    const versionResult = await this.processExecutor.execute("docker", ["--version"], {
      timeout: config.sandbox.dockerControlTimeoutMs,
      stdio: "pipe",
    });

    if (versionResult.error || versionResult.code !== 0) {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      return;
    }

    const versionOutput = versionResult.stdout || "";
    if (!versionOutput.includes("Docker")) {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      return;
    }

    // docker info
    const infoResult = await this.processExecutor.execute("docker", ["info"], {
      timeout: config.sandbox.dockerControlTimeoutMs,
      stdio: "pipe",
    });

    if (infoResult.error || infoResult.code !== 0) {
      this.dockerAvailable = false;
      this.dockerImageBuilt = false;
      return;
    }

    this.dockerAvailable = true;

    // docker image inspect <image>
    const imageName = SANDBOX_CONFIG.dockerImage;
    const inspectResult = await this.processExecutor.execute("docker", ["image", "inspect", imageName], {
      timeout: config.sandbox.dockerControlTimeoutMs,
      stdio: "pipe",
    });

    this.dockerImageBuilt = inspectResult.code === 0;
  }

  private getDockerSocketPath(): string | null {
    const dockerHost = config.sandbox.dockerHost.trim();
    if (dockerHost === "unix:///var/run/docker.sock") {
      return "/var/run/docker.sock";
    }

    if (!dockerHost.startsWith("unix://")) {
      return null;
    }

    const socketPath = dockerHost.slice("unix://".length).trim();
    return socketPath || "/var/run/docker.sock";
  }

  private logMissingDockerSocketOnce(socketPath: string): void {
    if (SandboxRunner.missingDockerSocketLogEmitted) {
      return;
    }

    SandboxRunner.missingDockerSocketLogEmitted = true;
    this.logger.info(
      `Docker socket not available at ${socketPath}`,
    );
  }

  private async ensureTempDir(): Promise<void> {
    if (this.tempDirCreated) return;
    this.tempDirCreated = true;
    try { await mkdir(this.tempDir, { recursive: true }); } catch { /* ignore */ }
  }

  private async cleanupDockerContainer(containerName?: string): Promise<void> {
    if (!containerName) return;
    const s = this.executionState;
    await cleanupExecutionContainer(s, {
      processExecutor: this.processExecutor, logger: this.logger,
    });
  }

  private controlDocker(operation: "pause" | "unpause", commit: () => void): void {
    const s = this.executionState;
    const containerName = s.currentContainerName!;
    const generation = s.runGeneration;
    const expectedState = this.state;
    const abort = s.runAbort;
    const isCurrent = () => s.runGeneration === generation && s.runAbort === abort &&
      !abort?.signal.aborted && !s.processKilled && s.currentContainerName === containerName &&
      !s.terminationRequested && this.state === expectedState && this.processController.hasProcess();
    this.controlPending = true;
    const finish = async (result: Awaited<ReturnType<ProcessExecutor["execute"]>>): Promise<boolean> => {
      if (!isCurrent()) return false;
      this.controlPending = false;
      if (result.code !== 0 || result.error) {
        this.logger.warn(`Docker ${operation} failed for ${containerName} (code ${result.code}): ${String(result.error ?? "nonzero exit")}`);
        await this.stop();
        return false;
      }
      commit();
      return true;
    };
    this.controlCompletion = this.processExecutor.execute("docker", [operation, containerName], {
      timeout: 5000, stdio: "pipe",
    }).then(finish, (error: unknown) => finish({
      code: -1, error: error instanceof Error ? error : new Error(String(error)),
    }));
  }

  private commitPause(): void {
    const s = this.executionState;
    this.state = SimulationState.PAUSED;
    this.timeoutManager.pause();
    s.pinStateBatcher?.pause();
    s.serialOutputBatcher?.pause();
    this.registryManager.pauseTelemetry();
    if (!s.processKilled) this.processController.writeStdin("[[PAUSE_TIME]]\n");
    s.pauseStartTime = Date.now();
    this.registryManager.markPauseTime(s.pauseStartTime);
    this.logger.info("Simulation paused");
  }

  pause(): boolean {
    if (this.controlPending || this.executionState.terminationRequested || this.state !== SimulationState.RUNNING || !this.processController.hasProcess()) return false;
    if (this.executionState.currentContainerName) {
      this.controlDocker("pause", () => this.commitPause());
    } else {
      this.processController.kill("SIGSTOP");
      this.commitPause();
      this.controlCompletion = undefined;
    }
    return true;
  }

  private commitResume(): void {
    const s = this.executionState;
    const pauseDuration = Date.now() - (this.pauseStartTime ?? Date.now());
    s.totalPausedTime += pauseDuration;
    if (!s.processKilled) this.processController.writeStdin(`[[RESUME_TIME:${pauseDuration}]]\n`);
    s.pauseStartTime = null;
    this.registryManager.markPauseTime(null);
    this.state = SimulationState.RUNNING;
    this.timeoutManager.resume();
    s.pinStateBatcher?.resume();
    s.serialOutputBatcher?.resume();
    this.registryManager.resumeTelemetry();
    this.logger.info(`Simulation resumed after ${pauseDuration}ms`);
    if (!s.currentContainerName && !s.processKilled) this.processController.writeStdin("\n");
    if (s.outputBuffer.length > 0 && s.onOutputCallback && !s.isSendingOutput) {
      this.sendOutputWithDelay(s.onOutputCallback);
    }
  }

  resume(): boolean {
    if (this.controlPending || this.executionState.terminationRequested || this.state !== SimulationState.PAUSED || !this.processController.hasProcess()) return false;
    if (this.executionState.currentContainerName) {
      this.controlDocker("unpause", () => this.commitResume());
    } else {
      this.processController.kill("SIGCONT");
      this.commitResume();
      this.controlCompletion = undefined;
    }
    return true;
  }

  sendSerialInput(input: string): void {
    const s = this.executionState;
    if (this.isRunning && !this.isPaused && this.processController.hasProcess() && !s.processKilled) {
      this.processController.writeStdin(input + "\n");
    } else {
      this.logger.warn("Simulator is not running or is paused — serial input ignored");
    }
  }

  setRegistryFile(filePath: string): void { this.executionState.currentRegistryFile = filePath; }
  getSketchDir(): string | null { return this.executionState.currentSketchDir; }

  setPinValue(pin: number, value: number): void {
    const s = this.executionState;
    if ((this.isRunning || this.isPaused) && this.processController.hasProcess() && !s.processKilled) {
      this.processController.writeStdin(`[[SET_PIN:${pin}:${value}]]\n`);
    }
  }

  // Send output character by character with baudrate delay
  private sendOutputWithDelay(onOutput: (line: string, isComplete?: boolean) => void): void {
    const s = this.executionState;
    if (!this.isRunning || this.isPaused) { s.isSendingOutput = false; return; }
    if (s.outputBufferIndex >= s.outputBuffer.length) { s.isSendingOutput = false; return; }
    s.isSendingOutput = true;
    const char = s.outputBuffer[s.outputBufferIndex++];
    s.totalOutputBytes++;
    if (s.totalOutputBytes > SANDBOX_CONFIG.maxOutputBytes) { void this.stop(); return; }
    onOutput(char, char === "\n");
    setTimeout(() => this.sendOutputWithDelay(onOutput), Math.max(1, 10_000 / s.baudrate));
  }

  async stop(): Promise<void> {
    const s = this.executionState;
    // Cancels a run that is still preparing or waiting for a start slot.
    s.runAbort?.abort();
    this.controlPending = false;
    if (this.state === SimulationState.STOPPED || s.processKilled) {
      await this.cleanupDockerContainer(s.currentContainerName);
      return;
    }
    this.state = SimulationState.STOPPED;
    s.processKilled = true;
    s.pendingCleanup = true;
    s.pauseStartTime = null;
    s.totalPausedTime = 0;

    s.pinStateBatcher?.stop(); s.pinStateBatcher?.destroy(); s.pinStateBatcher = null;
    s.serialOutputBatcher?.stop(); s.serialOutputBatcher?.destroy(); s.serialOutputBatcher = null;
    this.registryManager.pauseTelemetry();
    s.onOutputCallback = null; s.errorCallback = null;
    s.telemetryCallback = null; s.pinStateCallback = null; s.ioRegistryCallback = undefined;
    this.registryManager.reset();
    this.timeoutManager.clear();
    this.localCompiler.kill();
    this.processController.kill("SIGKILL");
    this.processController.destroySockets();

    const fsState = {
      currentSketchDir: s.currentSketchDir, isCompiling: s.isCompiling,
      pendingCleanup: s.pendingCleanup, cleanupRetries: new Map<string, number>(),
      currentRegistryFile: s.currentRegistryFile,
    };
    const deferredCompileDir = this.filesystemHelper.isCompilationInProgress(fsState)
      ? fsState.currentSketchDir
      : null;
    this.filesystemHelper.markRegistryForCleanup(fsState);
    this.filesystemHelper.markTempDirForCleanup(fsState);
    s.currentSketchDir = fsState.currentSketchDir;
    s.currentRegistryFile = fsState.currentRegistryFile;
    s.pendingCleanup = fsState.pendingCleanup;

    for (const dir of this.fileBuilder.getCreatedSketchDirs()) {
      if (dir === deferredCompileDir) continue;
      if (!existsSync(dir)) { this.fileBuilder.clearCreatedSketchDir(dir); continue; }
      if (this.filesystemHelper.attemptCleanupDir(dir)) {
        this.fileBuilder.clearCreatedSketchDir(dir);
      } else {
        this.filesystemHelper.scheduleCleanupRetry(fsState, dir);
      }
    }

    s.outputBuffer = ""; s.outputBufferIndex = 0; s.isSendingOutput = false;
    const containerName = s.currentContainerName;
    if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = null; }

    await this.cleanupDockerContainer(containerName);
  }

  /**
   * Returns the runner to a clean state before the pool hands it to the next
   * user: stops a run still in progress and clears everything the previous run
   * left in the execution state, the process listeners and the I/O registry.
   */
  async resetForReuse(): Promise<void> {
    if (this.isRunning) {
      try {
        await this.stop();
      } catch (error) {
        this.logger.warn(`stop() failed during reset: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const s = this.executionState;
    s.runAbort?.abort();
    this.controlPending = false;
    this.controlCompletion = undefined;
    if (s.currentContainerName) {
      await this.cleanupDockerContainer(s.currentContainerName);
      if (s.currentContainerName) throw new Error(`Docker cleanup unconfirmed for ${s.currentContainerName}`);
    }
    this.processController.clearListeners();
    s.state = SimulationState.STOPPED;
    s.processKilled = false;
    s.terminationRequested = false;
    s.pauseStartTime = null;
    s.totalPausedTime = 0;
    s.pinStateBatcher = null;
    s.serialOutputBatcher = null;
    s.onOutputCallback = null;
    s.errorCallback = null;
    s.telemetryCallback = null;
    s.pinStateCallback = null;
    s.ioRegistryCallback = undefined;
    s.outputBuffer = "";
    s.outputBufferIndex = 0;
    s.totalOutputBytes = 0;
    s.isSendingOutput = false;
    s.pendingCleanup = false;
    s.messageQueue = [];
    s.stderrFallbackBuffer = "";
    s.backpressurePaused = false;
    if (s.flushTimer) {
      clearTimeout(s.flushTimer);
      s.flushTimer = null;
    }

    // Reset rather than destroy: the ExecutionManager keeps this instance and its
    // onUpdate callback reads the next run's ioRegistryCallback from the state.
    try {
      this.registryManager.reset();
    } catch (error) {
      this.logger.debug(`RegistryManager reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.timeoutManager.clear();
  }

  getSandboxStatus(): { dockerAvailable: boolean; dockerImageBuilt: boolean } {
    return {
      dockerAvailable: this.dockerAvailable,
      dockerImageBuilt: this.dockerImageBuilt,
    };
  }
}
