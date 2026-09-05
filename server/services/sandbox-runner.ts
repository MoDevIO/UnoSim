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
import { flushMessageQueue } from "./sandbox/execution-phases/cleanup-phase";
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

    // Start docker check eagerly so getSandboxStatus() has cached results (S7059: moved to private method)
    this._scheduleEagerDockerCheck();
  }

  /** Schedule docker availability check immediately after construction. (S7059: move async-op out of constructor) */
  private _scheduleEagerDockerCheck(): void {
    this.ensureDockerChecked().catch(() => {
      // Docker check failed, but we already have defaults set
      // (dockerAvailable=false, dockerImageBuilt=false)
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

  private get pauseStartTime(): number | null { return this.executionState.pauseStartTime; }



  async runSketch(options: RunSketchOptions): Promise<void> {
    await this.ensureDockerChecked();
    await this.ensureTempDir();
    this.executionState.dockerAvailable = this.dockerAvailable;
    this.executionState.dockerImageBuilt = this.dockerImageBuilt;
    await this.executionManager.runSketch(options, this.executionState);
  }

  private async ensureDockerChecked(): Promise<void> {
    if (this.dockerChecked) return;
    if (config.simulationMode === "docker-sandbox" && config.serverMode !== "docker") {
      this.dockerAvailable = true; this.dockerImageBuilt = true; this.dockerChecked = true; return;
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
      timeout: 2000,
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
      timeout: 2000,
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
      timeout: 2000,
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
      `Docker socket not available at ${socketPath}; sandbox mode disabled, using local-limited execution`,
    );
  }

  private async ensureTempDir(): Promise<void> {
    if (this.tempDirCreated) return;
    this.tempDirCreated = true;
    try { await mkdir(this.tempDir, { recursive: true }); } catch { /* ignore */ }
  }

  private async cleanupDockerContainer(containerName?: string): Promise<void> {
    if (!containerName) return;

    try {
      const result = await this.processExecutor.execute("docker", ["rm", "-f", containerName], {
        timeout: 5000,
        stdio: "pipe",
      });
      this.logger.info(`Docker cleanup for ${containerName} finished (code ${result.code})`);
    } catch (error) {
      this.logger.debug(`Docker cleanup for ${containerName} failed: ${error}`);
    }
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
    // SIGSTOP only suspends the local `docker run` client process; the
    // container itself would continue producing output into the pipe. Pause
    // the container when running in Docker so the sketch really stops at the
    // exact instruction boundary and no ten-second backlog accumulates.
    if (s.currentContainerName) {
      const containerName = s.currentContainerName;
      void this.processExecutor.execute("docker", ["pause", containerName], {
        timeout: 5000,
        stdio: "pipe",
      }).catch((error) => {
        this.logger.warn(`Docker pause failed for ${containerName}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      this.processController.kill("SIGSTOP");
    }
    this.logger.info("Simulation paused (SIGSTOP)");
    return true;
  }

  resume(): boolean {
    const s = this.executionState;
    if (this.state !== SimulationState.PAUSED || !this.processController.hasProcess()) return false;
    const containerName = s.currentContainerName;
    if (!containerName) this.processController.kill("SIGCONT");
    const pauseDuration = Date.now() - (this.pauseStartTime ?? Date.now());
    s.totalPausedTime += pauseDuration;
    const resumeContainer = containerName
      ? this.processExecutor.execute("docker", ["unpause", containerName], {
          timeout: 5000,
          stdio: "pipe",
        })
      : Promise.resolve();
    void resumeContainer
      .catch((error) => {
        this.logger.warn(`Docker resume failed for ${containerName}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (!s.processKilled) {
          this.processController.writeStdin(`[[RESUME_TIME:${pauseDuration}]]\n`);
        }
      });
    s.pauseStartTime = null;
    this.registryManager.markPauseTime(null);
    this.state = SimulationState.RUNNING;
    this.timeoutManager.resume();
    s.pinStateBatcher?.resume();
    s.serialOutputBatcher?.resume();
    this.registryManager.resumeTelemetry();
    this.logger.info(`Simulation resumed after ${pauseDuration}ms (SIGCONT)`);
    if (!containerName && !s.processKilled) this.processController.writeStdin("\n");
    if (s.outputBuffer.length > 0 && s.onOutputCallback && !s.isSendingOutput) {
      this.sendOutputWithDelay(s.onOutputCallback);
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
    const containerName = s.currentContainerName;
    s.currentContainerName = undefined;
    if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = null; }

    await this.cleanupDockerContainer(containerName);
  }

  getSandboxStatus(): { dockerAvailable: boolean; dockerImageBuilt: boolean; mode: "docker-sandbox" | "local-limited" } {
    // Docker check is started in constructor, so just return cached values
    return {
      dockerAvailable: this.dockerAvailable,
      dockerImageBuilt: this.dockerImageBuilt,
      mode: this.dockerAvailable && this.dockerImageBuilt ? "docker-sandbox" : "local-limited",
    };
  }
}
