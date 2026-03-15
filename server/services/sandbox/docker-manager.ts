/**
 * Docker-Manager: Manages Docker container lifecycle, setup, and event handling
 * Extracted from Etappe A: Docker-Lifecycle refactoring
 */

import type { IProcessController } from "../process-controller";
import type { ArduinoOutputParser } from "../arduino-output-parser";
import { Logger } from "@shared/logger";
import type { SimulationTimeoutManager } from "../simulation-timeout-manager";

interface DockerManagerCallbacks {
  onOutput: (line: string, isComplete?: boolean) => void;
  onPinState: (pin: number, type: "mode" | "value" | "pwm", value: number) => void;
  onError: (line: string) => void;
}

interface DockerHandlerState {
  isCompilePhase: { value: boolean };
  compileErrorBuffer: { value: string };
  compileSuccessSent: { value: boolean };
  totalOutputBytes: number;
  processStartTime: number | null;
  stderrFallbackBuffer: string;
  flushTimer: NodeJS.Timeout | null;
}

type HandleParsedLineDelegate = (parsed: unknown, callbacks: DockerManagerCallbacks) => void;

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

  /**
   * Setup and configure Docker process timeout
   */
  setupDockerTimeout(executionTimeout: number | undefined, callbacks: DockerManagerCallbacks): void {
    const timeoutSec =
      executionTimeout && executionTimeout > 0 ? executionTimeout : this.SANDBOX_CONFIG.maxExecutionTimeSec;

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

      // Detect end of compile phase
      if (isCompilePhase.value) {
        isCompilePhase.value = false;
        if (!compileSuccessSent.value && onCompileSuccess) {
          compileSuccessSent.value = true;
          onCompileSuccess();
        }
      }

      // Check output size limit
      const currentBytes = state.totalOutputBytes || 0;
      state.totalOutputBytes = currentBytes + str.length;
      if (state.totalOutputBytes > this.SANDBOX_CONFIG.maxOutputBytes) {
        callbacks.onError("Output size limit exceeded");
        return;
      }

      // Parse stdout lines (safety net for direct binary output)
      const lines = str.split(/\r?\n/);
      lines.forEach((line) => {
        if (!line) return;
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
    flushBatchers: () => void,
    flushMessageQueue: () => void,
    processKilled: boolean,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
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
    flushMessageQueue();

    // Flush batchers if not still in compile phase
    if (!isCompilePhase.value || code === 0) {
      flushBatchers();
    }

    // Report compile errors or success
    if (code !== 0 && isCompilePhase.value && compileErrorBuffer.value && onCompileError) {
      onCompileError(this.cleanCompilerErrors(compileErrorBuffer.value));
    } else if (code === 0 && onCompileSuccess) {
        onCompileSuccess();
    }

    // Call exit callback (guard: only if process wasn't terminated by stop())
    if (!processKilled && onExit) onExit(code);
  }

  /**
   * Setup all Docker handlers (timeout, stdout, stderr, close)
   */
   
  setupDockerHandlers(
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    flushBatchers: () => void,
    flushMessageQueue: () => void,
    processKilled: boolean,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): void {
    // Setup all handlers via dedicated functions
    this.setupDockerTimeout(executionTimeout, callbacks);

    this.processController.onError((err) => {
      this.logger.error(`Docker process error: ${err.message}`);
      callbacks.onError(`Docker process failed: ${err.message}`);
    });

    this.setupStdoutHandler(callbacks, state, onCompileSuccess);
    this.setupStderrHandlers(callbacks, state);

    this.processController.onClose((code) => {
      this.handleDockerExit(
        callbacks,
        state,
        code,
        flushBatchers,
        flushMessageQueue,
        processKilled,
        onCompileError,
        onCompileSuccess,
        onExit,
      );
    });
  }

  /**
   * Clean up compiler error messages
   */
  private cleanCompilerErrors(errors: string): string {
    return errors.replaceAll("/sandbox/sketch.cpp", "sketch.ino").replaceAll(/\/[^\s:]+\/temp\/[a-f0-9-]+\/sketch\.cpp/gi, "sketch.ino").trim();
  }

  /**
   * Complete Docker orchestration: spawn process and setup all handlers
   * This consolidates runInDocker + setupDockerHandlers into a single delegated call
   */
   
  async runInDockerWithHandlers(
    dockerArgs: string[],
    callbacks: DockerManagerCallbacks,
    state: Partial<DockerHandlerState>,
    flushBatchers: () => void,
    flushMessageQueue: () => void,
    processKilled: boolean,
    onStateTransition: (state: "running" | "stopped") => void,
    onCompileError?: (error: string) => void,
    onCompileSuccess?: () => void,
    onExit?: (code: number | null) => void,
    executionTimeout?: number,
  ): Promise<void> {
    try {
      // Clear listeners from previous run before spawning new process
      this.processController.clearListeners();

      // Spawn Docker process
      await this.processController.spawn("docker", dockerArgs);
      this.logger.info("🚀 Docker: Compile + Run in single container");
      
      // Record process start time and transition to running
      state.processStartTime = Date.now();
      onStateTransition("running");

      // Setup all handlers for Docker process
      this.setupDockerHandlers(
        callbacks,
        state,
        flushBatchers,
        flushMessageQueue,
        processKilled,
        onCompileError,
        onCompileSuccess,
        onExit,
        executionTimeout,
      );
    } catch (err) {
      this.logger.error(`Docker process spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      onStateTransition("stopped");
      throw err;
    }
  }
}
