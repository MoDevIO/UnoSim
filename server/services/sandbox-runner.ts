// sandbox-runner.ts
// The lean orchestrator for Arduino sketch simulation
// Delegates execution flow to ExecutionManager, manages state transitions and process control

import { execFile, execSync } from "child_process";
import { ProcessController, type IProcessController } from "./process-controller";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { Logger } from "@shared/logger";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import { ArduinoOutputParser as StderrParser } from "./arduino-output-parser";
import { RegistryManager } from "./registry-manager";
import { SimulationTimeoutManager } from "./simulation-timeout-manager";
import { SketchFileBuilder } from "./sketch-file-builder";
import { LocalCompiler } from "./local-compiler";
import type { RunSketchOptions } from "./run-sketch-types";

// Extraction modules (Sandbox Dekonstruktion)
import { DockerManager } from "./sandbox/docker-manager";
import { StreamHandler } from "./sandbox/stream-handler";
import { FilesystemHelper } from "./sandbox/filesystem-helper";
import { ExecutionManager, type ExecutionState, SimulationState } from "./sandbox/execution-manager";

const DOCKER_IMAGE = process.env.DOCKER_SANDBOX_IMAGE ?? "unowebsim-sandbox:latest";
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

export class SandboxRunner {
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

  private dockerAvailable = false;
  private dockerImageBuilt = false;
  private dockerChecked = false;
  private dockerCheckPromise: Promise<void> | null = null;
  private tempDirCreated = false;

  private get state(): SimulationState { return this.executionState?.state ?? SimulationState.STOPPED; }
  private set state(v: SimulationState | string) { this.executionState.state = v as SimulationState; }

  constructor(options?: { tempDir?: string; processController?: IProcessController }) {
    this.processController = options?.processController ?? new ProcessController();
    this.tempDir = options?.tempDir ?? join(getFastTmpBaseDir(), "unowebsim-temp");
    this.timeoutManager = new SimulationTimeoutManager();
    this.fileBuilder = new SketchFileBuilder(this.tempDir);
    this.localCompiler = new LocalCompiler();
    const stderrParser = new StderrParser();
    
    this.registryManager = new RegistryManager({
      onUpdate: (registry, baudrate, reason) => {
        if (this.executionState?.ioRegistryCallback) {
          this.executionState.ioRegistryCallback(registry, baudrate, reason);
        }
        this.executionManager.flushMessageQueue(this.executionState);
      },
      onTelemetry: (metrics) => {
        if (this.executionState?.telemetryCallback) {
          this.executionState.telemetryCallback(metrics);
        }
      },
      enableTelemetry: true,
    });

    // Initialize extraction modules with proper dependencies
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

  private get pauseStartTime(): number | null { return this.executionState.pauseStartTime; }

  async runSketch(options: RunSketchOptions): Promise<void> {
    void this.ensureDockerChecked();
    await this.ensureTempDir();
    this.executionState.dockerAvailable = this.dockerAvailable;
    this.executionState.dockerImageBuilt = this.dockerImageBuilt;
    await this.executionManager.runSketch(options, this.executionState);
  }

  private async ensureDockerChecked(): Promise<void> {
    if (this.dockerChecked) return;
    if (process.env.FORCE_DOCKER === "1") {
      this.dockerAvailable = true; this.dockerImageBuilt = true; this.dockerChecked = true; return;
    }
    const hasMockedExecSync = (execSync as any)?.mock !== undefined;
    if (process.env.NODE_ENV === "test" || hasMockedExecSync) {
      try { this.checkDockerSync(); } catch { /* ignore */ }
      this.dockerChecked = true; return;
    }
    this.dockerCheckPromise ??= this.checkDockerAsync()
        .finally(() => { this.dockerChecked = true; this.dockerCheckPromise = null; });
    return this.dockerCheckPromise;
  }

  private checkDockerSync(): void {
    try {
      const version = execSync("docker --version", { stdio: "pipe", timeout: 2000 });
      if (!version?.toString()?.includes("Docker")) { this.dockerAvailable = false; return; }
      execSync("docker info", { stdio: "pipe", timeout: 2000 });
      this.dockerAvailable = true;
      try {
        execSync(`docker image inspect ${DOCKER_IMAGE}`, { stdio: "pipe", timeout: 2000 });
        this.dockerImageBuilt = true;
      } catch { this.dockerImageBuilt = false; }
    } catch { this.dockerAvailable = false; this.dockerImageBuilt = false; }
  }

  private async checkDockerAsync(): Promise<void> {
    const run = (cmd: string, args: string[]) =>
      new Promise<void>((resolve, reject) =>
        execFile(cmd, args, { timeout: 2000, windowsHide: true }, (err) => err ? reject(new Error(err.message)) : resolve()),
      );
    try {
      await Promise.all([run("docker", ["--version"]), run("docker", ["info"])]);
      this.dockerAvailable = true;
      try { await run("docker", ["image", "inspect", DOCKER_IMAGE]); this.dockerImageBuilt = true; }
      catch { this.dockerImageBuilt = false; }
    } catch { this.dockerAvailable = false; this.dockerImageBuilt = false; }
  }

  private async ensureTempDir(): Promise<void> {
    if (this.tempDirCreated) return;
    this.tempDirCreated = true;
    try { await mkdir(this.tempDir, { recursive: true }); } catch { /* ignore */ }
  }

  pause(): boolean {
    const s = this.executionState;
    if (this.state !== SimulationState.RUNNING || !this.processController.hasProcess()) return false;
    this.state = SimulationState.PAUSED;
    this.timeoutManager.pause();
    s.pinStateBatcher?.pause();
    s.serialOutputBatcher?.pause();
    this.registryManager.pauseTelemetry();
    if (!s.processKilled) this.processController.writeStdin("[[PAUSE_TIME]]\n");
    s.pauseStartTime = Date.now();
    this.registryManager.markPauseTime(s.pauseStartTime);
    this.processController.kill("SIGSTOP");
    this.logger.info("Simulation paused (SIGSTOP)");
    return true;
  }

  resume(): boolean {
    const s = this.executionState;
    if (this.state !== SimulationState.PAUSED || !this.processController.hasProcess()) return false;
    this.processController.kill("SIGCONT");
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
    this.logger.info(`Simulation resumed after ${pauseDuration}ms (SIGCONT)`);
    if (!s.processKilled) this.processController.writeStdin("\n");
    if (s.outputBuffer.length > 0 && s.onOutputCallback && !s.isSendingOutput) {
      this.sendOutputWithDelay(s.onOutputCallback);
    }
    return true;
  }

  isPausedState(): boolean { return this.isPaused; }

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
    if (s.totalOutputBytes > MAX_OUTPUT_BYTES) { void this.stop(); return; }
    onOutput(char, char === "\n");
    setTimeout(() => this.sendOutputWithDelay(onOutput), Math.max(1, 10_000 / s.baudrate));
  }

  async stop(): Promise<void> {
    const s = this.executionState;
    if (this.state === SimulationState.STOPPED || s.processKilled) return;
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
    this.registryManager.destroy();
    this.localCompiler.kill();
    this.processController.kill("SIGKILL");
    this.processController.destroySockets();

    const fsState = {
      currentSketchDir: s.currentSketchDir, isCompiling: s.isCompiling,
      pendingCleanup: s.pendingCleanup, cleanupRetries: new Map<string, number>(),
      currentRegistryFile: s.currentRegistryFile,
    };
    this.filesystemHelper.markRegistryForCleanup(fsState);
    this.filesystemHelper.markTempDirForCleanup(fsState);
    s.currentSketchDir = fsState.currentSketchDir;
    s.currentRegistryFile = fsState.currentRegistryFile;
    s.pendingCleanup = fsState.pendingCleanup;

    for (const dir of this.fileBuilder.getCreatedSketchDirs()) {
      if (!existsSync(dir)) { this.fileBuilder.clearCreatedSketchDir(dir); continue; }
      if (this.filesystemHelper.attemptCleanupDir(dir)) {
        this.fileBuilder.clearCreatedSketchDir(dir);
      } else {
        this.filesystemHelper.scheduleCleanupRetry(fsState, dir);
      }
    }

    s.outputBuffer = ""; s.outputBufferIndex = 0; s.isSendingOutput = false;
    if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = null; }
  }

  getSandboxStatus(): { dockerAvailable: boolean; dockerImageBuilt: boolean; mode: string } {
    void this.ensureDockerChecked();
    return {
      dockerAvailable: this.dockerAvailable,
      dockerImageBuilt: this.dockerImageBuilt,
      mode: this.dockerAvailable && this.dockerImageBuilt ? "docker-sandbox" : "local-limited",
    };
  }
}
