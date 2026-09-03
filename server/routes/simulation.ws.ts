import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { SandboxRunner } from "../services/sandbox-runner";
import {
  type IOPinRecord,
  type ClientToServerWSMessage,
  type ServerToClientWSMessage,
  type WSMessage,
  WSMessageType,
  clientToServerWSMessageSchema,
} from "@shared/schema";
import type { Logger } from "@shared/logger";
import type { PinStateChange } from "@shared/types/arduino.types";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import path from "node:path";
import { writeFile, access } from "node:fs/promises";
import type { RawData } from "ws";
import {
  authorizeHeaders,
  createWebSocketAuthorizationVerifier,
  type TrustConfig,
} from "../security/access-control";
import { INPUT_LIMITS } from "@shared/input-limits";

/** Safely convert WebSocket RawData (Buffer | ArrayBuffer | Buffer[]) to a string. */
function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

type SimulationDeps = {
  SandboxRunner: typeof SandboxRunner;
  getSimulationRateLimiter: () => {
    checkLimit: (identity: string) => {
      allowed: boolean;
      retryAfter?: number;
    };
  };
  shouldSendSimulationEndMessage: (compileFailed: boolean) => boolean;
  getLastCompiledCode: () => string | null;
  logger: Logger;
  runnerPool?: ReturnType<typeof getSandboxRunnerPool>;
  trust: TrustConfig;
  allowedWebSocketOrigins: readonly string[];
  disableRateLimit: boolean;
};

type ClientState = {
  subject: string;
  runner: InstanceType<typeof SandboxRunner> | null;
  isRunning: boolean;
  isPaused: boolean;
  testRunId?: string;
  queueAbortController: AbortController | null;
};

// Return type exposes a small API used by other modules (test-reset)
export function registerSimulationWebSocket(
  httpServer: Server,
  deps: SimulationDeps,
) {
  const {
    getSimulationRateLimiter,
    shouldSendSimulationEndMessage,
    getLastCompiledCode,
    logger,
    runnerPool,
  } = deps;
  const pool = runnerPool ?? getSandboxRunnerPool();

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: INPUT_LIMITS.webSocket.maxPayloadBytes,
    // Disable per-message compression to eliminate zlib concurrency bottleneck.
    // With 200+ simultaneous clients, the default concurrencyLimit:10 caused CPU
    // starvation during pin-state bursts; disabling deflate entirely removes that
    // constraint at the cost of slightly higher bandwidth (tolerable on LAN).
    perMessageDeflate: false,
    verifyClient: createWebSocketAuthorizationVerifier(
      deps.trust,
      deps.allowedWebSocketOrigins,
    ),
  });

  const clientRunners = new Map<WebSocket, ClientState>();

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

  function sendMessageToClient(
    ws: WebSocket,
    message: ServerToClientWSMessage,
  ): void {
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
          return lineObj.data + "\n";
        }
        // If line is incomplete, don't add newline
        return lineObj.data;
      })
      .join("");

    // The isComplete flag for the WebSocket message is based on the last line
    const lastLine = bufferState.lines.at(-1);
    const finalIsComplete = lastLine?.isComplete ?? true;

    bufferState.lines = [];

    sendMessageToClient(ws, {
      type: WSMessageType.SERIAL_OUTPUT,
      data: combinedData,
      isComplete: finalIsComplete,
    });
  }

  /**
   * Send serial output with 50ms batching
   * Accumulates lines for 50ms before sending them as a single batched message
   * Preserves isComplete semantic so client-side newline injection works correctly
   */
  function sendSerialOutputBatched(
    ws: WebSocket,
    line: string,
    isComplete?: boolean,
  ): void {
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
    state: ClientState,
    reason: string,
  ): Promise<void> {
    if (!state.runner) {
      return;
    }

    const runner = state.runner;
    state.runner = null;
    const wasRunning = state.isRunning;
    state.isRunning = false;
    state.isPaused = false;

    // Broadcast SYNCHRONOUSLY before any await so concurrent safeReleaseRunner
    // calls (e.g. 40 simulations ending at once) don't race: by the time the
    // second call broadcasts, this client already has isRunning=false and is
    // excluded from the count — no N² message storm.
    // This also handles the "simulation ends naturally, WS stays open" case
    // where ws.on('close') never fires but the count must still decrease.
    if (wasRunning) {
      broadcastWorkerTotal();
    }

    try {
      await runner.stop();
    } catch (error) {
      logger.debug(
        `[SandboxRunnerPool] runner.stop() failed during ${reason}: ${error}`,
      );
    }

    try {
      await pool.releaseRunner(runner);
    } catch (error) {
      logger.warn(
        `[SandboxRunnerPool] releaseRunner failed during ${reason}: ${error}`,
      );
    }
  }

  /**
   * Build all callback functions for sketch execution (onOutput, onError, etc.)
   * Extracted to reduce cognitive complexity of message handler.
   */
  function buildRunSketchCallbacks(ws: WebSocket, clientState: ClientState) {
    let gccSuccessSent = false;
    let compileFailed = false;

    const onOutput = (line: string, isComplete?: boolean) => {
      if (!gccSuccessSent) {
        gccSuccessSent = true;
        sendMessageToClient(ws, {
          type: WSMessageType.COMPILATION_STATUS,
          gccStatus: "success",
        });
      }
      sendSerialOutputBatched(ws, line, isComplete);
    };

    const onError = (err: string) => {
      logger.warn(`[Client WS][ERR]: ${err}`);
      flushSerialOutputBuffer(ws);
      sendMessageToClient(ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: "[ERR] " + err,
      });
    };

    const onExit = (exitCode: number | null) => {
      // Capture runner reference immediately — the clientRunners map entry
      // may be deleted by the ws "close" handler before the setTimeout fires.
      const capturedCs = clientRunners.get(ws);

      setTimeout(async () => {
        try {
          flushSerialOutputBuffer(ws);
          if (capturedCs) {
            await safeReleaseRunner(capturedCs, "onExit");
          }

          if (!shouldSendSimulationEndMessage(compileFailed)) return;

          if (exitCode === 0 && !gccSuccessSent) {
            gccSuccessSent = true;
            sendMessageToClient(ws, {
              type: WSMessageType.COMPILATION_STATUS,
              gccStatus: "success",
            });
          }

          sendMessageToClient(ws, {
            type: WSMessageType.SERIAL_OUTPUT,
            data: "--- Simulation ended: Loop cycles completed ---\n",
            isComplete: true,
          });
          sendMessageToClient(ws, {
            type: WSMessageType.SIMULATION_STATUS,
            status: "stopped",
          });

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
      sendMessageToClient(ws, {
        type: WSMessageType.COMPILATION_ERROR,
        data: compileErr,
      });
      sendMessageToClient(ws, {
        type: WSMessageType.COMPILATION_STATUS,
        gccStatus: "error",
      });
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      const cs = clientRunners.get(ws);
      if (cs) {
        safeReleaseRunner(cs, "onCompileError").catch((error) => {
          logger.warn(
            `[SandboxRunnerPool] safeReleaseRunner failed in onCompileError: ${error}`,
          );
        });
      }
      logger.error(`[Client Compile Error]: ${compileErr}`);
    };

    const onCompileSuccess = () => {
      if (!gccSuccessSent) {
        gccSuccessSent = true;
        sendMessageToClient(ws, {
          type: WSMessageType.COMPILATION_STATUS,
          gccStatus: "success",
        });
      }
    };

    const onCompileQueued = () => {
      sendMessageToClient(ws, {
        type: WSMessageType.COMPILATION_STATUS,
        gccStatus: "queued",
      });
    };

    const onPinState = (pin: number, type: PinStateChange, value: number) => {
      sendMessageToClient(ws, {
        type: WSMessageType.PIN_STATE,
        pin,
        stateType: type,
        value,
      });
    };

    const onIORegistry = (
      registry: IOPinRecord[],
      baudrate: number | undefined,
      reason?: string,
    ) => {
      const message: Extract<WSMessage, { type: "io_registry" }> = {
        type: WSMessageType.IO_REGISTRY,
        registry,
      };
      if (baudrate !== undefined) message.baudrate = baudrate;
      if (reason !== undefined) message.reason = reason;
      sendMessageToClient(ws, message);
      const baudSuffix = baudrate === undefined ? "" : `, baud=${baudrate}`;
      logger.info(`[io_registry] ${registry.length} pins${baudSuffix}`);

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

          const registryFile = path.join(
            sketchDir,
            `io-registry-${Date.now()}.pending.json`,
          );
          await writeFile(registryFile, JSON.stringify(registry, null, 2));
          logger.debug(`Registry saved: ${path.basename(registryFile)}`);
          if (clientState.runner)
            clientState.runner.setRegistryFile(registryFile);
        } catch (err) {
          logger.warn(
            `Failed to save I/O Registry file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    };

    const onTelemetry = (metrics: {
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
    }) => {
      sendMessageToClient(ws, { type: WSMessageType.SIM_TELEMETRY, metrics });
    };

    const onPinStateBatch = (batch: {
      states: Array<{ pin: number; stateType: PinStateChange; value: number }>;
      timestamp: number;
    }) => {
      sendMessageToClient(ws, {
        type: WSMessageType.PIN_STATE_BATCH,
        states: batch.states,
        timestamp: batch.timestamp,
      });
    };

    return {
      onOutput,
      onError,
      onExit,
      onCompileError,
      onCompileSuccess,
      onCompileQueued,
      onPinState,
      onIORegistry,
      onTelemetry,
      onPinStateBatch,
      compileFailed: () => compileFailed,
    };
  }

  /** Returns the number of clients currently running a simulation. */
  function countRunningClients(): number {
    let n = 0;
    for (const state of clientRunners.values()) {
      if (state.isRunning) n++;
    }
    return n;
  }

  /**
   * Push the current live running-client count to all running clients.
   * Optionally exclude one WebSocket (e.g. the caller that already received
   * the full workerIndex+workerTotal message).
   * Called after acquire (pool grows) and after release (pool shrinks) so the
   * denominator in #N/M is always up-to-date in every open tab.
   */
  function broadcastWorkerTotal(excludeWs?: WebSocket): void {
    const newTotal = countRunningClients();
    for (const [otherWs, otherState] of clientRunners.entries()) {
      if (otherWs !== excludeWs && otherState.isRunning) {
        sendMessageToClient(otherWs, {
          type: WSMessageType.COMPILATION_STATUS,
          workerTotal: newTotal,
        });
      }
    }
  }

  /**
   * Acquires a runner from the pool for the given client.
   * Manages the AbortController and handles pool-exhaustion / cancel errors.
   * Returns false when the caller should return early.
   * Extracted to keep handleStartSimulation below cognitive complexity threshold.
   */
  async function acquireRunnerForClient(
    ws: WebSocket,
    clientState: ClientState,
  ): Promise<boolean> {
    const acquireAbort = new AbortController();
    clientState.queueAbortController = acquireAbort;
    try {
      clientState.runner = await pool.acquireRunner(acquireAbort.signal);
      clientState.queueAbortController = null;
      logger.debug(
        `[SandboxRunnerPool] Acquired runner for client. Pool stats: ${JSON.stringify(pool.getStats())}`,
      );
      return true;
    } catch (error) {
      clientState.queueAbortController = null;
      const isCancelled =
        error instanceof Error && error.message.includes("cancelled");
      if (isCancelled) {
        // Client disconnected while waiting — nothing to send, WS is already closed
        logger.debug(
          `[SandboxRunnerPool] Acquire cancelled because WS closed while queued`,
        );
      } else {
        logger.error(`[SandboxRunnerPool] Failed to acquire runner: ${error}`);
        sendMessageToClient(ws, {
          type: WSMessageType.SERIAL_OUTPUT,
          data: "[ERR] Server overloaded. All runners busy. Please try again.\n",
        });
        sendMessageToClient(ws, {
          type: WSMessageType.SIMULATION_STATUS,
          status: "stopped",
        });
      }
      clientState.runner = null;
      clientState.isRunning = false;
      clientState.isPaused = false;
      return false;
    }
  }

  /**
   * Log consolidated run payload for audit/evidence.
   * Extracted to keep handleStartSimulation below cognitive complexity threshold.
   */
  function logRunPayloadAudit(
    code: string,
    timeoutSec: number | undefined,
    sessionId: string | undefined,
  ): void {
    try {
      const payload = {
        code,
        timeoutSec,
        context: { sessionId, label: "default-ws" },
      };
      logger.debug(
        `[B1-Evidence] Payload: ${JSON.stringify(payload, null, 2)}`,
      );
    } catch (err) {
      logger.warn(
        `Could not stringify run payload for evidence: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Handle "start_simulation" WebSocket message
   * Checks rate limits, acquires runner, and starts sketch execution.
   */
  async function handleStartSimulation(
    ws: WebSocket,
    data: Extract<ClientToServerWSMessage, { type: "start_simulation" }>,
    clientState: ClientState,
  ): Promise<void> {
    // Rate limiting check
    const rateLimiter = getSimulationRateLimiter();
    const limitCheck = deps.disableRateLimit
      ? { allowed: true }
      : rateLimiter.checkLimit(clientState.subject);
    if (!limitCheck.allowed) {
      const retryAfter = limitCheck.retryAfter || 30;
      logger.warn(
        `[RateLimit] Simulation start rejected. Retry after ${retryAfter}s`,
      );

      if (clientState?.runner) {
        await safeReleaseRunner(clientState, "rate-limit");
      }

      sendMessageToClient(ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: `[ERR] Rate limit exceeded. Too many simulation starts. Please wait ${retryAfter} seconds before starting again.\n`,
      });
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      return;
    }

    // Use per-client code from the WS message if provided (multi-client isolation),
    // otherwise fall back to the global lastCompiledCode (backward compatibility).
    const code =
      "code" in data &&
      typeof data.code === "string" &&
      data.code.trim().length > 0
        ? data.code
        : getLastCompiledCode();
    if (!code) {
      if (clientState.runner) {
        await safeReleaseRunner(clientState, "missing-compiled-code");
      }
      clientState.isRunning = false;
      clientState.isPaused = false;

      sendMessageToClient(ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: "[ERR] No compiled code available. Please compile first.\n",
      });
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      return;
    }

    // Release any existing runner
    if (clientState.runner) {
      await safeReleaseRunner(clientState, "start-replace-existing");
    }

    // If the pool is saturated, notify client it is queued and wait for a slot
    const statsBeforeAcquire = pool.getStats();
    const willQueue =
      statsBeforeAcquire.availableRunners === 0 &&
      statsBeforeAcquire.totalRunners >= statsBeforeAcquire.maxRunners;
    if (willQueue) {
      logger.debug(
        `[SandboxRunnerPool] Pool saturated — client queued (queue length: ${statsBeforeAcquire.queuedRequests + 1})`,
      );
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "queued",
      });
    }

    // Acquire new runner from pool (may block until a slot is released).
    // The AbortController is managed inside acquireRunnerForClient; it is set on
    // clientState so the WS-close handler can cancel the wait on disconnect.
    if (!(await acquireRunnerForClient(ws, clientState))) return;
    const acquiredRunner = clientState.runner!; // non-null: acquireRunnerForClient returned true

    // Slot assignment: tell client which runner slot they own immediately
    const acquiredWorkerIndex = pool.getRunnerIndex(acquiredRunner);

    // Update client state and notify running.
    // isRunning is set BEFORE countRunningClients() so the new client is
    // included in the total it (and others) receive.
    clientState.isRunning = true;
    clientState.isPaused = false;
    sendMessageToClient(ws, {
      type: WSMessageType.SIMULATION_STATUS,
      status: "running",
    });
    sendMessageToClient(ws, {
      type: WSMessageType.COMPILATION_STATUS,
      gccStatus: "compiling",
      workerIndex: acquiredWorkerIndex,
      workerTotal: countRunningClients(),
    });

    // Broadcast updated count to all OTHER running clients (ws excluded because
    // it just received the full workerIndex+workerTotal message above).
    broadcastWorkerTotal(ws);

    // Build callbacks
    const callbacks = buildRunSketchCallbacks(ws, clientState);
    const timeoutValue = "timeout" in data ? data.timeout : undefined;
    logger.info(`[Simulation] Starting with timeout: ${timeoutValue}s`);

    // Log consolidated payload for audit
    logRunPayloadAudit(code, timeoutValue, clientState.testRunId);

    // Capture runner reference before await – ws-close may set clientState.runner=null
    // concurrently while runSketch is awaited, causing a null-dereference on getSandboxStatus.
    const runnerForStatus = acquiredRunner;

    // Start sketch execution and publish sandbox mode once the runner has resolved
    try {
      await acquiredRunner.runSketch({
        code,
        onOutput: callbacks.onOutput,
        onError: callbacks.onError,
        onExit: callbacks.onExit,
        onCompileError: callbacks.onCompileError,
        onCompileSuccess: callbacks.onCompileSuccess,
        onCompileQueued: callbacks.onCompileQueued,
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

    const sandboxStatus = runnerForStatus.getSandboxStatus();
    sendMessageToClient(ws, {
      type: WSMessageType.COMPILATION_STATUS,
      sandboxMode: sandboxStatus.mode,
    });
  }

  /**
   * Handle "code_changed" WebSocket message
   */
  async function handleCodeChanged(
    _ws: WebSocket,
    clientState: ClientState,
  ): Promise<void> {
    if (
      clientState?.runner &&
      (clientState?.isRunning || clientState?.isPaused)
    ) {
      await safeReleaseRunner(clientState, "code_changed");
      sendMessageToClient(_ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      sendMessageToClient(_ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: "--- Simulation stopped due to code change ---\n",
      });
    }
  }

  /**
   * Handle "stop_simulation" WebSocket message
   */
  async function handleStopSimulation(
    _ws: WebSocket,
    clientState: ClientState,
  ): Promise<void> {
    if (clientState?.runner) {
      await safeReleaseRunner(clientState, "stop_simulation");
    }
    sendMessageToClient(_ws, {
      type: WSMessageType.SIMULATION_STATUS,
      status: "stopped",
    });
    sendMessageToClient(_ws, {
      type: WSMessageType.SERIAL_OUTPUT,
      data: "--- Simulation stopped ---\n",
    });
  }

  /**
   * Handle "pause_simulation" WebSocket message
   */
  function handlePauseSimulation(
    _ws: WebSocket,
    clientState: ClientState,
  ): void {
    if (clientState?.runner && clientState.isRunning) {
      const paused = clientState.runner.pause();
      if (paused) {
        clientState.isPaused = true;
        sendMessageToClient(_ws, {
          type: WSMessageType.SIMULATION_STATUS,
          status: "paused",
        });
        sendMessageToClient(_ws, {
          type: WSMessageType.SERIAL_OUTPUT,
          data: "--- Simulation paused ---\n",
        });
      }
    }
  }

  /**
   * Handle "resume_simulation" WebSocket message
   */
  function handleResumeSimulation(
    _ws: WebSocket,
    clientState: ClientState,
  ): void {
    if (clientState?.runner && clientState.isPaused) {
      const resumed = clientState.runner.resume();
      if (resumed) {
        clientState.isPaused = false;
        clientState.isRunning = true;
        sendMessageToClient(_ws, {
          type: WSMessageType.SIMULATION_STATUS,
          status: "running",
        });
        sendMessageToClient(_ws, {
          type: WSMessageType.SERIAL_OUTPUT,
          data: "--- Simulation resumed ---\n",
        });
      }
    }
  }

  /**
   * Handle "serial_input" WebSocket message
   */
  function handleSerialInput(
    _ws: WebSocket,
    data: Extract<ClientToServerWSMessage, { type: "serial_input" }>,
    clientState: ClientState,
  ): void {
    if (
      clientState?.runner &&
      clientState?.isRunning &&
      !clientState.isPaused
    ) {
      clientState.runner.sendSerialInput(data.data);
    }
  }

  /**
   * Handle "set_pin_value" WebSocket message
   */
  function handleSetPinValue(
    _ws: WebSocket,
    data: Extract<ClientToServerWSMessage, { type: "set_pin_value" }>,
    clientState: ClientState,
  ): void {
    if (
      clientState?.runner &&
      (clientState.isRunning || clientState.isPaused)
    ) {
      clientState.runner.setPinValue(data.pin, data.value);
    }
  }

  let _wsConnectAttempts = 0;

  wss.on("connection", (ws, req) => {
    const authorization = authorizeHeaders(req.headers, deps.trust);
    if (!authorization.allowed) {
      ws.close(1008, "Unauthorized");
      return;
    }
    const identity = authorization.identity;
    const url = req.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const testRunId = urlParams.get("testRunId") || undefined;
    const testRunIdSuffix = testRunId ? ` [testRunId: ${testRunId}]` : "";

    _wsConnectAttempts++;
    logger.warn(
      `New WebSocket client connected for subject ${identity.subject}${testRunIdSuffix}. Total clients: ${wss.clients.size} (attempt #${_wsConnectAttempts})`,
    );
    if (_wsConnectAttempts % 10 === 0) {
      logger.warn(
        `[WS milestone] ${_wsConnectAttempts} total connect attempts, ${wss.clients.size} currently open`,
      );
    }

    clientRunners.set(ws, {
      subject: identity.subject,
      runner: null,
      isRunning: false,
      isPaused: false,
      testRunId,
      queueAbortController: null,
    });

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
      type: WSMessageType.SIMULATION_STATUS,
      status: simStatus,
    });

    if (testRunId) {
      sendMessageToClient(ws, {
        type: WSMessageType.HANDSHAKE,
        testRunId,
      });
    }

    ws.on("message", async (message) => {
      try {
        // Debug: log raw incoming WS messages for E2E troubleshooting
        const msgText = rawDataToString(message);
        logger.debug(`[WS-IN] ${msgText}`);
        const parsedMessage = clientToServerWSMessageSchema.safeParse(
          JSON.parse(msgText),
        );
        if (!parsedMessage.success) {
          logger.warn(
            `[WS] Rejected invalid client message: ${parsedMessage.error.message}`,
          );
          ws.close(1008, "Invalid message");
          return;
        }
        const data = parsedMessage.data;
        const type = data.type;
        const clientState = clientRunners.get(ws);

        if (!clientState) {
          logger.warn(
            `[WS] Message received but clientState not found for type: ${type}`,
          );
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

        }
      } catch (error) {
        logger.error(
          `Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    ws.on("close", async (code: number, reason: Buffer) => {
      const clientState = clientRunners.get(ws);
      if (clientState) {
        // Cancel any pending pool-queue wait to prevent orphaned runner slot leaks.
        // Without this, a client that disconnects while QUEUED_FOR_SIMULATION would
        // leave a dangling acquireRunner() promise in the pool queue.  When a slot
        // eventually freed up, the orphaned runner would be assigned and held forever
        // (the simulation runs with no WS to stop it), consuming pool capacity.
        if (clientState.queueAbortController) {
          clientState.queueAbortController.abort();
          clientState.queueAbortController = null;
        }
        if (clientState.runner) {
          await safeReleaseRunner(clientState, "ws-close");
        }
      }
      clientRunners.delete(ws);

      // Broadcast updated count now that this client is fully removed from the
      // map, so countRunningClients() already reflects the decrease.
      broadcastWorkerTotal();

      // Clean up serial output buffer and timer
      const bufferState = clientSerialBuffers.get(ws);
      if (bufferState?.flushTimer) {
        clearTimeout(bufferState.flushTimer);
      }
      clientSerialBuffers.delete(ws);

      logger.warn(
        `Client disconnected (code=${code}, reason=${reason.toString() || "—"}). Remaining clients: ${wss.clients.size}`,
      );
    });

    ws.on("error", async (error) => {
      const clientState = clientRunners.get(ws);
      if (clientState) {
        if (clientState.queueAbortController) {
          clientState.queueAbortController.abort();
          clientState.queueAbortController = null;
        }
        if (clientState.runner) {
          await safeReleaseRunner(clientState, "ws-error");
        }
      }

      // Clean up serial output buffer and timer
      const bufferState = clientSerialBuffers.get(ws);
      if (bufferState?.flushTimer) {
        clearTimeout(bufferState.flushTimer);
      }
      clientSerialBuffers.delete(ws);

      logger.error(
        `WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
      );
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

      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
    }

    const cleaned = cleanedTestRunIds.filter((id): id is string => Boolean(id));
    return { cleanedUpCount, cleanedTestRunIds: cleaned };
  }

  return { wss, stopAllRunnersAndNotify };
}
