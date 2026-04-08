import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { SandboxRunner } from "../services/sandbox-runner";
import type { IOPinRecord, WSMessage } from "@shared/schema";
import type { Logger } from "@shared/logger";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import path from "node:path";
import { constants as zlibConstants } from "node:zlib";
import { writeFile, access } from "node:fs/promises";
import type { RawData } from "ws";

/** Safely convert WebSocket RawData (Buffer | ArrayBuffer | Buffer[]) to a string. */
function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

type SimulationDeps = {
  SandboxRunner: typeof SandboxRunner;
  getSimulationRateLimiter: () => { checkLimit: (ws: WebSocket) => { allowed: boolean; retryAfter?: number }; removeClient: (ws: WebSocket) => void };
  shouldSendSimulationEndMessage: (compileFailed: boolean) => boolean;
  getLastCompiledCode: () => string | null;
  logger: Logger;
  runnerPool?: ReturnType<typeof getSandboxRunnerPool>;
};

// Return type exposes a small API used by other modules (test-reset)
export function registerSimulationWebSocket(httpServer: Server, deps: SimulationDeps) {
  const { getSimulationRateLimiter, shouldSendSimulationEndMessage, getLastCompiledCode, logger, runnerPool } = deps;
  const pool = runnerPool ?? getSandboxRunnerPool();

  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: "/ws",
    // Enable WebSocket message compression (RFC 7692)
    // Reduces bandwidth by ~40-50% for repetitive JSON payloads (pin-state batches)
    perMessageDeflate: {
      // Use fast compression (Level 1) to minimize CPU overhead with 200+ clients
      zlibDeflateOptions: {
        level: zlibConstants.Z_BEST_SPEED, // Level 1: fastest compression
        memLevel: 8, // Default memory usage (1-9, higher = more memory but better compression)
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024, // 10KB chunks for decompression
      },
      // Client-to-server compression parameters
      clientNoContextTakeover: true, // Disable context reuse for simpler memory management
      serverNoContextTakeover: true, // Disable context reuse to reduce server memory
      // Negotiate compression threshold (compress messages > 256 bytes)
      threshold: 256, // Only compress messages larger than 256 bytes
      // Concurrency limit for parallel compressions (default: 10)
      concurrencyLimit: 10,
    }
  });

  const clientRunners = new Map<
    WebSocket,
    { runner: InstanceType<typeof SandboxRunner> | null; isRunning: boolean; isPaused: boolean; testRunId?: string }
  >();

  // Serial output batching: collect output lines over 50ms before sending to reduce
  // WebSocket message count (e.g., from 100 msg/batch to 1 msg/batch at 20 batches/sec)
  // 
  // STRUCTURE: Buffer stores both data AND semantic flag (isComplete) so we can
  // intelligently reconstruct newlines without duplication. The client also adds 
  // newlines based on isComplete flag, so we must be careful:
  // - Store each line with its isComplete flag
  // - When flushing, add newlines BETWEEN lines (not after final line)
  // - Let client add the final newline if needed
  const clientSerialBuffers = new Map<
    WebSocket,
    { 
      lines: Array<{ data: string; isComplete: boolean }>;
      flushTimer: NodeJS.Timeout | null;
    }
  >();

  function sendMessageToClient(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Flush buffered serial output for a client
   * Combines all lines with proper newline handling:
   * - Add newline after EVERY complete line (not just between)
   * - Don't add newline after incomplete lines
   * - Let the isComplete flag tell the client whether to add final newline
   * 
   * CRITICAL: This prevents lost newlines at batch boundaries.
   * If batch 1 ends with isComplete=false and batch 2 starts with isComplete=true,
   * we must ensure newlines are added correctly.
   */
  function flushSerialOutputBuffer(ws: WebSocket): void {
    const bufferState = clientSerialBuffers.get(ws);
    if (!bufferState || bufferState.lines.length === 0) {
      return;
    }

    bufferState.flushTimer = null;

    // Add newline after EVERY complete line (not just between them)
    // This prevents lost newlines at batch boundaries
    const combinedData = bufferState.lines
      .map((lineObj) => {
        // If line is complete (had newline originally), add it back
        if (lineObj.isComplete) {
          return lineObj.data + '\n';
        }
        // If line is incomplete, don't add newline
        return lineObj.data;
      })
      .join('');

    // The isComplete flag for the WebSocket message is based on the last line
    const lastLine = bufferState.lines.at(-1);
    const finalIsComplete = lastLine?.isComplete ?? true;

    bufferState.lines = [];

    sendMessageToClient(ws, {
      type: "serial_output",
      data: combinedData,
      isComplete: finalIsComplete,
    });
  }

  /**
   * Send serial output with 50ms batching
   * Accumulates lines for 50ms before sending them as a single batched message
   * Preserves isComplete semantic so client-side newline injection works correctly
   */
  function sendSerialOutputBatched(ws: WebSocket, line: string, isComplete?: boolean): void {
    // Ensure buffer state exists for this client
    let bufferState = clientSerialBuffers.get(ws);
    bufferState ??= { lines: [], flushTimer: null };
    clientSerialBuffers.set(ws, bufferState);

    // Store line WITH its isComplete semantic for later intelligent combination
    const lineObj = { data: line, isComplete: isComplete ?? true };
    bufferState.lines.push(lineObj);

    // Schedule flush if not already scheduled
    bufferState.flushTimer ??= setTimeout(() => {
      flushSerialOutputBuffer(ws);
    }, 50);
  }

  async function safeReleaseRunner(
    state: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean },
    reason: string,
  ): Promise<void> {
    if (!state.runner) {
      return;
    }

    const runner = state.runner;
    state.runner = null;
    state.isRunning = false;
    state.isPaused = false;

    try {
      await runner.stop();
    } catch (error) {
      logger.debug(`[SandboxRunnerPool] runner.stop() failed during ${reason}: ${error}`);
    }

    try {
      await pool.releaseRunner(runner);
    } catch (error) {
      logger.warn(`[SandboxRunnerPool] releaseRunner failed during ${reason}: ${error}`);
    }
  }

  /**
   * Build all callback functions for sketch execution (onOutput, onError, etc.)
   * Extracted to reduce cognitive complexity of message handler.
   */
  function buildRunSketchCallbacks(
    ws: WebSocket,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean },
  ) {
    let gccSuccessSent = false;
    let compileFailed = false;

    const onOutput = (line: string, isComplete?: boolean) => {
      if (!gccSuccessSent) {
        gccSuccessSent = true;
        sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
      }
      sendSerialOutputBatched(ws, line, isComplete);
    };

    const onError = (err: string) => {
      logger.warn(`[Client WS][ERR]: ${err}`);
      flushSerialOutputBuffer(ws);
      sendMessageToClient(ws, { type: "serial_output", data: "[ERR] " + err });
    };

    const onExit = (exitCode: number | null) => {
      setTimeout(async () => {
        try {
          flushSerialOutputBuffer(ws);
          const cs = clientRunners.get(ws);
          if (cs) {
            await safeReleaseRunner(cs, "onExit");
          }

          if (!shouldSendSimulationEndMessage(compileFailed)) return;

          if (exitCode === 0 && !gccSuccessSent) {
            gccSuccessSent = true;
            sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
          }

          sendMessageToClient(ws, {
            type: "serial_output",
            data: "--- Simulation ended: Loop cycles completed ---\n",
            isComplete: true,
          });
          sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });

          const bufferState = clientSerialBuffers.get(ws);
          if (bufferState?.flushTimer) {
            clearTimeout(bufferState.flushTimer);
          }
        } catch (err) {
          logger.error(
            `Error sending stop message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }, 100);
    };

    const onCompileError = (compileErr: string) => {
      compileFailed = true;
      sendMessageToClient(ws, { type: "compilation_error", data: compileErr });
      sendMessageToClient(ws, { type: "compilation_status", gccStatus: "error" });
      sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
      const cs = clientRunners.get(ws);
      if (cs) {
        safeReleaseRunner(cs, "onCompileError").catch((error) => {
          logger.warn(`[SandboxRunnerPool] safeReleaseRunner failed in onCompileError: ${error}`);
        });
      }
      logger.error(`[Client Compile Error]: ${compileErr}`);
    };

    const onCompileSuccess = () => {
      if (!gccSuccessSent) {
        gccSuccessSent = true;
        sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
      }
    };

    const onPinState = (pin: number, type: "mode" | "value" | "pwm", value: number) => {
      sendMessageToClient(ws, { type: "pin_state", pin, stateType: type, value });
    };

    const onIORegistry = (
      registry: IOPinRecord[],
      baudrate: number | undefined,
      reason?: string,
    ) => {
      const message: Extract<WSMessage, { type: "io_registry" }> = { type: "io_registry", registry };
      if (baudrate !== undefined) message.baudrate = baudrate;
      if (reason !== undefined) message.reason = reason;
      sendMessageToClient(ws, message);
      const baudSuffix = baudrate === undefined ? "" : `, baud=${baudrate}`;
      logger.info(
        `[io_registry] ${registry.length} pins${baudSuffix}`,
      );

      // Async save without blocking — fire-and-forget with error handling
      (async () => {
        try {
          const sketchDir = clientState?.runner?.getSketchDir();
          if (!sketchDir) return;

          try {
            await access(sketchDir);
          } catch {
            return;
          }

          const registryFile = path.join(sketchDir, `io-registry-${Date.now()}.pending.json`);
          await writeFile(registryFile, JSON.stringify(registry, null, 2));
          logger.debug(`Registry saved: ${path.basename(registryFile)}`);
          if (clientState.runner) clientState.runner.setRegistryFile(registryFile);
        } catch (err) {
          logger.warn(
            `Failed to save I/O Registry file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    };

    const onTelemetry = (metrics: { timestamp: number; intendedPinChangesPerSecond: number; actualPinChangesPerSecond: number; droppedPinChangesPerSecond: number; batchesPerSecond: number; avgStatesPerBatch: number; serialOutputPerSecond: number; serialBytesPerSecond: number; serialBytesTotal: number; serialIntendedBytesPerSecond: number; serialDroppedBytesPerSecond: number }) => {
      sendMessageToClient(ws, { type: "sim_telemetry", metrics });
    };

    const onPinStateBatch = (batch: {
      states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }>;
      timestamp: number;
    }) => {
      sendMessageToClient(ws, { type: "pin_state_batch", states: batch.states, timestamp: batch.timestamp });
    };

    return {
      onOutput,
      onError,
      onExit,
      onCompileError,
      onCompileSuccess,
      onPinState,
      onIORegistry,
      onTelemetry,
      onPinStateBatch,
      compileFailed: () => compileFailed,
    };
  }

  /**
   * Handle "start_simulation" WebSocket message
   * Checks rate limits, acquires runner, and starts sketch execution.
   */
  async function handleStartSimulation(
    ws: WebSocket,
    data: Extract<WSMessage, { type: "start_simulation" }>,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): Promise<void> {
    // Rate limiting check
    const rateLimiter = getSimulationRateLimiter();
    const limitCheck = rateLimiter.checkLimit(ws);
    if (!limitCheck.allowed) {
      const retryAfter = limitCheck.retryAfter || 30;
      logger.warn(`[RateLimit] Simulation start rejected. Retry after ${retryAfter}s`);

      if (clientState?.runner) {
        await safeReleaseRunner(clientState, "rate-limit");
      }

      sendMessageToClient(ws, {
        type: "serial_output",
        data: `[ERR] Rate limit exceeded. Too many simulation starts. Please wait ${retryAfter} seconds before starting again.\n`,
      });
      sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
      return;
    }

    // Verify compiled code exists
    const lastCompiledCode = getLastCompiledCode();
    if (!lastCompiledCode) {
      if (clientState.runner) {
        await safeReleaseRunner(clientState, "missing-compiled-code");
      }
      clientState.isRunning = false;
      clientState.isPaused = false;

      sendMessageToClient(ws, {
        type: "serial_output",
        data: "[ERR] No compiled code available. Please compile first.\n",
      });
      sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
      return;
    }

    // Release any existing runner
    if (clientState.runner) {
      await safeReleaseRunner(clientState, "start-replace-existing");
    }

    // Acquire new runner from pool
    try {
      clientState.runner = await pool.acquireRunner();
      logger.debug(
        `[SandboxRunnerPool] Acquired runner for client. Pool stats: ${JSON.stringify(pool.getStats())}`,
      );
    } catch (error) {
      logger.error(`[SandboxRunnerPool] Failed to acquire runner: ${error}`);
      clientState.runner = null;
      clientState.isRunning = false;
      clientState.isPaused = false;
      sendMessageToClient(ws, {
        type: "serial_output",
        data: "[ERR] Server overloaded. All runners busy. Please try again.\n",
      });
      sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
      return;
    }

    // Update client state
    clientState.isRunning = true;
    clientState.isPaused = false;
    sendMessageToClient(ws, { type: "simulation_status", status: "running" });
    sendMessageToClient(ws, { type: "compilation_status", gccStatus: "compiling" });

    // Build callbacks
    const callbacks = buildRunSketchCallbacks(ws, clientState);
    const timeoutValue = "timeout" in data ? data.timeout : undefined;
    logger.info(`[Simulation] Starting with timeout: ${timeoutValue}s`);

    // Log consolidated payload for audit
    try {
      const payload = {
        code: lastCompiledCode,
        timeoutSec: timeoutValue,
        context: { sessionId: clientState.testRunId, label: "default-ws" },
      };
      logger.debug(`[B1-Evidence] Payload: ${JSON.stringify(payload, null, 2)}`);
    } catch (err) {
      logger.warn(
        `Could not stringify run payload for evidence: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Start sketch execution and publish sandbox mode once the runner has resolved
    try {
      await clientState.runner.runSketch({
        code: lastCompiledCode,
        onOutput: callbacks.onOutput,
        onError: callbacks.onError,
        onExit: callbacks.onExit,
        onCompileError: callbacks.onCompileError,
        onCompileSuccess: callbacks.onCompileSuccess,
        onPinState: callbacks.onPinState,
        timeoutSec: timeoutValue,
        onIORegistry: callbacks.onIORegistry,
        onTelemetry: callbacks.onTelemetry,
        onPinStateBatch: callbacks.onPinStateBatch,
        context: { sessionId: clientState.testRunId, label: "default-ws" },
      });
    } catch (error) {
      logger.error(`[Simulation] runSketch failed: ${error}`);
    }

    const sandboxStatus = clientState.runner.getSandboxStatus();
    const poolStats = pool.getStats();
    const workerIndex = pool.getRunnerIndex(clientState.runner);
    sendMessageToClient(ws, {
      type: "compilation_status",
      sandboxMode: sandboxStatus.mode,
      workerIndex,
      workerTotal: poolStats.totalRunners,
    });
  }

  /**
   * Handle "code_changed" WebSocket message
   */
  async function handleCodeChanged(
    _ws: WebSocket,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): Promise<void> {
    if (clientState?.runner && (clientState?.isRunning || clientState?.isPaused)) {
      await safeReleaseRunner(clientState, "code_changed");
      sendMessageToClient(_ws, { type: "simulation_status", status: "stopped" });
      sendMessageToClient(_ws, { type: "serial_output", data: "--- Simulation stopped due to code change ---\n" });
    }
  }

  /**
   * Handle "stop_simulation" WebSocket message
   */
  async function handleStopSimulation(
    _ws: WebSocket,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): Promise<void> {
    if (clientState?.runner) {
      await safeReleaseRunner(clientState, "stop_simulation");
    }
    sendMessageToClient(_ws, { type: "simulation_status", status: "stopped" });
    sendMessageToClient(_ws, { type: "serial_output", data: "--- Simulation stopped ---\n" });
  }

  /**
   * Handle "pause_simulation" WebSocket message
   */
  function handlePauseSimulation(
    _ws: WebSocket,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): void {
    if (clientState?.runner && clientState.isRunning) {
      const paused = clientState.runner.pause();
      if (paused) {
        clientState.isPaused = true;
        sendMessageToClient(_ws, { type: "simulation_status", status: "paused" });
        sendMessageToClient(_ws, { type: "serial_output", data: "--- Simulation paused ---\n" });
      }
    }
  }

  /**
   * Handle "resume_simulation" WebSocket message
   */
  function handleResumeSimulation(
    _ws: WebSocket,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): void {
    if (clientState?.runner && clientState.isPaused) {
      const resumed = clientState.runner.resume();
      if (resumed) {
        clientState.isPaused = false;
        clientState.isRunning = true;
        sendMessageToClient(_ws, { type: "simulation_status", status: "running" });
        sendMessageToClient(_ws, { type: "serial_output", data: "--- Simulation resumed ---\n" });
      }
    }
  }

  /**
   * Handle "serial_input" WebSocket message
   */
  function handleSerialInput(
    _ws: WebSocket,
    data: Extract<WSMessage, { type: "serial_input" }>,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): void {
    if (clientState?.runner && clientState?.isRunning && !clientState.isPaused) {
      clientState.runner.sendSerialInput(data.data);
    }
  }

  /**
   * Handle "set_pin_value" WebSocket message
   */
  function handleSetPinValue(
    _ws: WebSocket,
    data: Extract<WSMessage, { type: "set_pin_value" }>,
    clientState: { runner: SandboxRunner | null; isRunning: boolean; isPaused: boolean; testRunId?: string },
  ): void {
    if (clientState?.runner && (clientState.isRunning || clientState.isPaused)) {
      clientState.runner.setPinValue(data.pin, data.value);
    }
  }

  wss.on("connection", (ws, req) => {
    const url = req.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const testRunId = urlParams.get("testRunId") || undefined;
    const testRunIdSuffix = testRunId ? ` [testRunId: ${testRunId}]` : "";

    logger.info(`New WebSocket client connected${testRunIdSuffix}. Total clients: ${wss.clients.size}`);

    clientRunners.set(ws, { runner: null, isRunning: false, isPaused: false, testRunId });

    const clientState = clientRunners.get(ws);
    let simStatus: "paused" | "running" | "stopped";
    if (clientState?.isPaused) {
      simStatus = "paused";
    } else if (clientState?.isRunning) {
      simStatus = "running";
    } else {
      simStatus = "stopped";
    }
    sendMessageToClient(ws, {
      type: "simulation_status",
      status: simStatus,
    });

    if (testRunId) {
      sendMessageToClient(ws, {
        type: "handshake",
        testRunId,
      });
    }

    ws.on("message", async (message) => {
      try {
        // Debug: log raw incoming WS messages for E2E troubleshooting
        const msgText = rawDataToString(message);
        logger.debug(`[WS-IN] ${msgText}`);
        const data = JSON.parse(msgText);
        const type = data.type;
        const clientState = clientRunners.get(ws);

        if (!clientState) {
          logger.warn(`[WS] Message received but clientState not found for type: ${type}`);
          return;
        }

        switch (type) {
          case "start_simulation":
            await handleStartSimulation(ws, data, clientState);
            break;

          case "code_changed":
            await handleCodeChanged(ws, clientState);
            break;

          case "stop_simulation":
            await handleStopSimulation(ws, clientState);
            break;

          case "pause_simulation":
            handlePauseSimulation(ws, clientState);
            break;

          case "resume_simulation":
            handleResumeSimulation(ws, clientState);
            break;

          case "serial_input":
            handleSerialInput(ws, data, clientState);
            break;

          case "set_pin_value":
            handleSetPinValue(ws, data, clientState);
            break;

          default:
            logger.warn(`Unknown WS message type: ${JSON.stringify(data?.type)}`);
            break;
        }
      } catch (error) {
        logger.error(
          `Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    ws.on("close", async () => {
      const clientState = clientRunners.get(ws);
      if (clientState?.runner) {
        await safeReleaseRunner(clientState, "ws-close");
      }
      clientRunners.delete(ws);
      
      // Clean up serial output buffer and timer
      const bufferState = clientSerialBuffers.get(ws);
      if (bufferState?.flushTimer) {
        clearTimeout(bufferState.flushTimer);
      }
      clientSerialBuffers.delete(ws);
      
      const rateLimiter = getSimulationRateLimiter();
      rateLimiter.removeClient(ws);
      logger.info(`Client disconnected. Remaining clients: ${wss.clients.size}`);
    });

    ws.on("error", async (error) => {
      const clientState = clientRunners.get(ws);
      if (clientState?.runner) {
        await safeReleaseRunner(clientState, "ws-error");
      }
      
      // Clean up serial output buffer and timer
      const bufferState = clientSerialBuffers.get(ws);
      if (bufferState?.flushTimer) {
        clearTimeout(bufferState.flushTimer);
      }
      clientSerialBuffers.delete(ws);
      
      logger.error(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  async function stopAllRunnersAndNotify() {
    const cleanedUpCount = clientRunners.size;
    const cleanedTestRunIds: (string | undefined)[] = [];

    for (const [ws, clientState] of clientRunners.entries()) {
      if (clientState.runner) {
        await safeReleaseRunner(clientState, "test-reset");
      }
      clientState.isRunning = false;
      clientState.isPaused = false;
      cleanedTestRunIds.push(clientState.testRunId);

      sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
    }

    const cleaned = cleanedTestRunIds.filter((id): id is string => Boolean(id));
    return { cleanedUpCount, cleanedTestRunIds: cleaned };
  }

  return { wss, stopAllRunnersAndNotify };
}
