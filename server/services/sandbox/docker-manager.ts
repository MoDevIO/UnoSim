/**
 * Docker-Manager: Manages Docker container lifecycle, setup, and event handling
 * Extracted from Etappe A: Docker-Lifecycle refactoring
 */

import type { IProcessController } from "../process-controller";
import type { ArduinoOutputParser, ParsedStderrOutput } from "../arduino-output-parser";
import { Logger } from "@shared/logger";
import type { SimulationTimeoutManager } from "../simulation-timeout-manager";
import { normalizeSimulationTimeout } from "@shared/input-limits";
import type { PinStateChange } from "@shared/types/arduino.types";

interface DockerManagerCallbacks {
  onOutput: (line: string, isComplete?: boolean) => void;
  onPinState: (pin: number, type: PinStateChange, value: number) => void;
  onError: (line: string) => void;
}

interface DockerProcessConfig {
  flushBatchers: () => void;
  flushMessageQueue: () => void;
  /** Use a getter so the guard reflects the live value, preventing stale-capture bugs. */
  getProcessKilled: () => boolean;
  executionTimeout?: number;
  onStateTransition?: (state: "running" | "stopped") => void;
}

interface DockerEventHandlers {
  onCompileError?: (error: string) => void;
  onCompileSuccess?: () => void;
  onExit?: (code: number | null) => void;
}

interface DockerHandlerState {
  isCompilePhase: { value: boolean };
  compileErrorBuffer: { value: string };
  compileSuccessSent: { value: boolean };
  totalOutputBytes: { value: number };
  processStartTime: number | null;
  stderrFallbackBuffer: string;
  flushTimer: NodeJS.Timeout | null;
}

type HandleParsedLineDelegate = (parsed: ParsedStderrOutput, callbacks: DockerManagerCallbacks) => void;

export class DockerManager {
  private readonly logger = new Logger("DockerManager");
  private readonly SANDBOX_CONFIG = {
    maxOutputBytes: 100 * 1024 * 1024, // Max 100MB output
    maxExecutionTimeSec: 60, // Max 60 seconds runtime
  };

  constructor(
    private readonly processController: IProcessController,
    private readonly stderrParser: ArduinoOutputParser,
    private readonly timeoutManager: SimulationTimeoutManager,
    private readonly handleParsedLine: HandleParsedLineDelegate,
  ) {}

  private consumeOutputBudget(state: Partial<DockerHandlerState>, data: Buffer | string, callbacks: DockerManagerCallbacks): boolean {
    const counter = state.totalOutputBytes as { value: number };
    counter.value += Buffer.byteLength(data);
    if (counter.value <= this.SANDBOX_CONFIG.maxOutputBytes) return true;
    this.processController.kill("SIGKILL");
    callbacks.onError("Output size limit exceeded");
    return false;
  }

  /**
   * Setup and configure Docker process timeout
   */
  setupDockerTimeout(executionTimeout: number | undefined, callbacks: DockerManagerCallbacks): void {
    const timeoutSec = normalizeSimulationTimeout(executionTimeout);

    const handleTimeout = () => {
      this.processController.kill("SIGKILL");
      callbacks.onOutput(`--- Simulation timeout (${timeoutSec}s) ---`, true);
      this.logger.info(`Docker timeout after ${timeoutSec}s`);
    };

    this.timeoutManager.schedule(timeoutSec * 1000, handleTimeout);
  }

  /**
   * Setup Docker stdout handler (detects end of compile phase, parses output)
   */
  setupStdoutHandler(
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    onCompileSuccess?: () => void,
  ): void {
    const isCompilePhase = state.isCompilePhase as { value: boolean };
    const compileSuccessSent = state.compileSuccessSent as { value: boolean };

    this.processController.onStdout((data) => {
      const str = data.toString();

      if (!this.consumeOutputBudget(state, data, callbacks)) return;

      // Detect end of compile phase
      if (isCompilePhase.value) {
        isCompilePhase.value = false;
        if (!compileSuccessSent.value && onCompileSuccess) {
          compileSuccessSent.value = true;
          onCompileSuccess();
        }
      }

      // Parse stdout lines (safety net for direct binary output)
      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        // Filter the compile-phase sentinel added by buildCompileAndRunCommand.
        // Its sole purpose is to trigger the isCompilePhase reset above and
        // must not be forwarded to the protocol parser or the client.
        if (!line || line.trim() === '[[RUNTIME_START]]') return;
        const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime || 0);
        this.handleParsedLine(parsed, callbacks);
      });
    });
  }

  /**
   * Setup Docker stderr handlers (raw + fallback + readline)
   */
  setupStderrHandlers(
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
  ): void {
    const isCompilePhase = state.isCompilePhase as { value: boolean };
    const compileErrorBuffer = state.compileErrorBuffer as { value: string };
    const useFallbackParser = !this.processController.supportsStderrLineStreaming();

    // Raw stderr stream for compile aggregation
    this.processController.onStderr((data) => {
      if (!this.consumeOutputBudget(state, data, callbacks)) return;
      const chunk = data.toString();
      if (isCompilePhase.value) {
        compileErrorBuffer.value += chunk;
      }

      // Fallback parsing when readline is unavailable
      if (useFallbackParser) {
        state.stderrFallbackBuffer = (state.stderrFallbackBuffer || "") + chunk;
        const lines = state.stderrFallbackBuffer.split(/\r?\n/);
        state.stderrFallbackBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime || 0);
          this.handleParsedLine(parsed, callbacks);
        }
      }
    });

    // Readline-based stderr line stream (preferred when available)
    this.processController.onStderrLine((line) => {
      if (line.length === 0) return;
      const parsed = this.stderrParser.parseStderrLine(line, state.processStartTime || 0);
      this.handleParsedLine(parsed, callbacks);
    });
  }

  /**
   * Handle Docker process exit (cleanup, final parsing, callbacks)
   */
   
  handleDockerExit(
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    code: number | null,
    config: DockerProcessConfig,
    handlers: DockerEventHandlers,
  ): void {
    const isCompilePhase = state.isCompilePhase as { value: boolean };
    const compileErrorBuffer = state.compileErrorBuffer as { value: string };
    const useFallbackParser = !this.processController.supportsStderrLineStreaming();

    // Flush any remaining data in stderr fallback buffer
    if (state.stderrFallbackBuffer && useFallbackParser) {
      const buffered = state.stderrFallbackBuffer;
      state.stderrFallbackBuffer = "";
      if (buffered.trim()) {
        const parsed = this.stderrParser.parseStderrLine(buffered, state.processStartTime || 0);
        this.handleParsedLine(parsed, callbacks);
      }
    }

    // Flush message queue before exit
    config.flushMessageQueue();

    // Flush batchers if not still in compile phase
    if (!isCompilePhase.value || code === 0) {
      config.flushBatchers();
    }

    // Report compile errors or success
    if (code !== 0 && isCompilePhase.value && compileErrorBuffer.value && handlers.onCompileError) {
      handlers.onCompileError(this.cleanCompilerErrors(compileErrorBuffer.value));
    } else if (code === 0 && handlers.onCompileSuccess) {
        handlers.onCompileSuccess();
    }

    // Call exit callback (guard: only if process wasn't terminated by stop())
    if (!config.getProcessKilled() && handlers.onExit) handlers.onExit(code);
  }

  /**
   * Setup all Docker handlers (timeout, stdout, stderr, close)
   */
   
  setupDockerHandlers(
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    config: DockerProcessConfig,
    handlers: DockerEventHandlers,
  ): void {
    // Setup all handlers via dedicated functions
    this.setupDockerTimeout(config.executionTimeout, callbacks);

    this.processController.onError((err) => {
      this.logger.error(`Docker process error: ${err.message}`);
      callbacks.onError(`Docker process failed: ${err.message}`);
    });

    this.setupStdoutHandler(callbacks, state, handlers.onCompileSuccess);
    this.setupStderrHandlers(callbacks, state);

    this.processController.onClose((code) => {
      this.handleDockerExit(
        callbacks,
        state,
        code,
        config,
        handlers,
      );
    });
  }

  /**
   * Clean up compiler error messages
   */
  private cleanCompilerErrors(errors: string): string {
    return errors.replaceAll("/sandbox/sketch.cpp", "sketch.ino").replaceAll(/(?:\/[^\s:/]+)+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino").trim();
  }

  /**
   * Complete Docker orchestration: spawn process and setup all handlers
   * This consolidates runInDocker + setupDockerHandlers into a single delegated call
   */
   
  async runInDockerWithHandlers(
    dockerArgs: string[],
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    config: DockerProcessConfig,
    handlers: DockerEventHandlers,
  ): Promise<void> {
    try {
      // Clear listeners from previous run before spawning new process
      this.processController.clearListeners();

      // Spawn Docker process
      await this.processController.spawn("docker", dockerArgs);
      this.logger.info("🚀 Docker: Compile + Run in single container");
      
      // Record process start time and transition to running
      state.processStartTime = Date.now();
      config.onStateTransition?.("running");

      // Setup all handlers for Docker process
      this.setupDockerHandlers(
        callbacks,
        state,
        config,
        handlers,
      );
    } catch (err) {
      this.logger.error(`Docker process spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      config.onStateTransition?.("stopped");
      throw err;
    }
  }
}
