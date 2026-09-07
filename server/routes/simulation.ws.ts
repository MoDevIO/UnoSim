import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { SandboxRunner } from "../services/sandbox-runner";
import {
  type IOPinRecord,
  type ClientToServerWSMessage,
  type WSMessage,
  WSMessageType,
} from "@shared/schema";
import type { Logger } from "@shared/logger";
import type { PinStateChange } from "@shared/types/arduino.types";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import path from "node:path";
import { writeFile, access } from "node:fs/promises";
import {
  createWebSocketAuthorizationVerifier,
  getRequestAuthorization,
  type TrustConfig,
} from "../security/access-control";
import { INPUT_LIMITS } from "@shared/input-limits";
import { WsMessageRouter } from "./simulation/ws-message-router";
import { type ClientState, WsSessionManager } from "./simulation/ws-session-manager";
import { sendMessageToClient, WsOutputBuffer } from "./simulation/ws-output-buffer";
import { WEBSOCKET_PROTOCOL_VERSION } from "../services/protocol-version";
import {
  AdmissionResult,
  SimulationAdmissionController,
  SimulationReservation,
} from "../services/simulation-admission-controller";
import { operationError, SYSTEM_BUSY_MESSAGE } from "@shared/operation-errors";

function sendStartError(
  ws: WebSocket,
  error: ReturnType<typeof operationError>,
): void {
  sendMessageToClient(ws, {
    type: WSMessageType.OPERATION_ERROR,
    operation: "start_simulation",
    ...error,
  });
  sendMessageToClient(ws, {
    type: WSMessageType.SIMULATION_STATUS,
    status: "stopped",
  });
}

function rejectAdmission(
  ws: WebSocket,
  admission: Extract<AdmissionResult, { admitted: false }>,
): void {
  if (admission.reason === "capacity") {
    sendStartError(
      ws,
      operationError("SYSTEM_BUSY", SYSTEM_BUSY_MESSAGE, 5),
    );
  } else {
    sendStartError(
      ws,
      operationError(
        "SIMULATION_ALREADY_ACTIVE",
        "Für diesen Nutzer läuft bereits eine Simulation oder wartet auf einen Runner.",
      ),
    );
  }
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

type SimulationDeps = {
  SandboxRunner: typeof SandboxRunner;
  getSimulationRateLimiter: () => {
    checkLimit: (identity: string) => {
      allowed: boolean;
      retryAfter?: number;
    };
  };
  getSimulationAdmissionController?: () => SimulationAdmissionController;
  shouldSendSimulationEndMessage: (compileFailed: boolean) => boolean;
  getLastCompiledCode: () => string | null;
  logger: Logger;
  runnerPool?: ReturnType<typeof getSandboxRunnerPool>;
  trust: TrustConfig;
  allowedWebSocketOrigins: readonly string[];
  disableRateLimit: boolean;
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
  const admissionController = deps.getSimulationAdmissionController?.() ??
    new SimulationAdmissionController();

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

  const sessionManager = new WsSessionManager({
    pool,
    logger,
    admissionController,
  });
  const outputBuffer = new WsOutputBuffer();

  function safeReleaseRunner(
    state: ClientState,
    reason: string,
  ): Promise<void> {
    return sessionManager.safeReleaseRunner(state, reason);
  }

  /**
   * Build all callback functions for sketch execution (onOutput, onError, etc.)
   * Extracted to reduce cognitive complexity of message handler.
   */
  function buildRunSketchCallbacks(
    ws: WebSocket,
    clientState: ClientState,
    reservation: SimulationReservation,
  ) {
    let compileFailed = false;

    const onOutput = (line: string, isComplete?: boolean) => {
      outputBuffer.sendSerialOutputBatched(ws, line, isComplete);
    };

    const onError = (err: string) => {
      logger.warn(`[Client WS][ERR]: ${err}`);
      outputBuffer.flushSerialOutputBuffer(ws);
      sendMessageToClient(ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: "[ERR] " + err,
      });
    };

    const onExit = (_exitCode: number | null) => {
      // Capture client state immediately — the session entry
      // may be deleted by the ws "close" handler before the setTimeout fires.
      const capturedCs = sessionManager.get(ws);

      setTimeout(async () => {
        try {
          outputBuffer.flushSerialOutputBuffer(ws);
          if (capturedCs) {
            await sessionManager.safeReleaseRunner(
              capturedCs,
              "onExit",
              reservation,
            );
          }

          if (!shouldSendSimulationEndMessage(compileFailed)) return;

          sendMessageToClient(ws, {
            type: WSMessageType.SERIAL_OUTPUT,
            data: "--- Simulation ended: Loop cycles completed ---\n",
            isComplete: true,
          });
          sendMessageToClient(ws, {
            type: WSMessageType.SIMULATION_STATUS,
            status: "stopped",
          });

          outputBuffer.clearClient(ws);
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
        arduinoCliStatus: "error",
      });
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      const cs = sessionManager.get(ws);
      if (cs) {
        sessionManager.safeReleaseRunner(
          cs,
          "onCompileError",
          reservation,
        ).catch((error) => {
          logger.warn(
            `[SandboxRunnerPool] safeReleaseRunner failed in onCompileError: ${error}`,
          );
        });
      }
      logger.error(`[Client Compile Error]: ${compileErr}`);
    };

    const onCompileSuccess = () => {
      sendMessageToClient(ws, {
        type: WSMessageType.COMPILATION_STATUS,
        arduinoCliStatus: "success",
      });
    };

    const onCompileQueued = () => {
      // gccStatus:queued removed in Phase 3.3.6 - queue state no longer emitted via WS
      // arduinoCliStatus does not have a "queued" state
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

  /**
   * Acquires a runner from the pool for the given client.
   * Manages the AbortController and handles pool-exhaustion / cancel errors.
   * Returns false when the caller should return early.
   * Extracted to keep handleStartSimulation below cognitive complexity threshold.
   */
  async function acquireRunnerForClient(
    ws: WebSocket,
    clientState: ClientState,
    reservation: SimulationReservation,
  ): Promise<boolean> {
    const acquireAbort = new AbortController();
    clientState.queueAbortController = acquireAbort;
    try {
      clientState.runner = await pool.acquireRunner(acquireAbort.signal);
      clientState.queueAbortController = null;
      if (clientState.reservation !== reservation) {
        await pool.releaseRunner(clientState.runner);
        clientState.runner = null;
        return false;
      }
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
        sendStartError(
          ws,
          operationError("SYSTEM_BUSY", SYSTEM_BUSY_MESSAGE, 5),
        );
      }
      clientState.runner = null;
      clientState.isRunning = false;
      clientState.isPaused = false;
      await sessionManager.safeReleaseRunner(
        clientState,
        "runner-acquire-failed",
        reservation,
      );
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

      sendStartError(
        ws,
        operationError(
          "RATE_LIMITED",
          `Simulation start rate limit exceeded. Please wait ${retryAfter} seconds before starting again.`,
          retryAfter,
        ),
      );
      return;
    }

    // Use per-client code from the WS message if provided (multi-client isolation),
    // Deprecated compatibility fallback. New clients send code per session;
    // remove this branch at the next protocol-major release.
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

    const admission = admissionController.reserve(clientState.subject);
    if (!admission.admitted) {
      rejectAdmission(ws, admission);
      return;
    }
    const reservation = admission.reservation;
    clientState.reservation = reservation;

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
    if (!(await acquireRunnerForClient(ws, clientState, reservation))) return;
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
      arduinoCliStatus: "compiling",
      workerIndex: acquiredWorkerIndex,
      workerTotal: sessionManager.countRunningClients(),
    });

    // Broadcast updated count to all OTHER running clients (ws excluded because
    // it just received the full workerIndex+workerTotal message above).
    sessionManager.broadcastWorkerTotal(ws);

    // Build callbacks
    const callbacks = buildRunSketchCallbacks(ws, clientState, reservation);
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
        headers: data.headers,
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
      await sessionManager.safeReleaseRunner(
        clientState,
        "runSketch-error",
        reservation,
      );
      sendStartError(
        ws,
        operationError(
          "SIMULATION_START_FAILED",
          "Simulation could not be started.",
        ),
      );
      return;
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
    if (clientState?.runner || clientState?.reservation) {
      sessionManager.abortQueuedAcquire(clientState);
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
    sessionManager.abortQueuedAcquire(clientState);
    if (clientState?.runner || clientState?.reservation) {
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

  let _wsConnectAttempts = 0;

  const messageRouter = new WsMessageRouter({
    logger,
    getClientState: (ws) => sessionManager.get(ws),
    handlers: {
      startSimulation: handleStartSimulation,
      codeChanged: (ws, _data, clientState) => handleCodeChanged(ws, clientState),
      stopSimulation: (ws, _data, clientState) => handleStopSimulation(ws, clientState),
      pauseSimulation: (ws, _data, clientState) => handlePauseSimulation(ws, clientState),
      resumeSimulation: (ws, _data, clientState) => handleResumeSimulation(ws, clientState),
      serialInput: handleSerialInput,
      setPinValue: handleSetPinValue,
    },
  });

  wss.on("connection", (ws, req) => {
    const authorization = getRequestAuthorization(req, deps.trust);
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

    sessionManager.register(ws, {
      subject: identity.subject,
      runner: null,
      isRunning: false,
      isPaused: false,
      testRunId,
      queueAbortController: null,
      reservation: null,
    });

    const clientState = sessionManager.get(ws);
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
        protocolVersion: WEBSOCKET_PROTOCOL_VERSION,
      });
    }

    ws.on("message", async (message) => {
      await messageRouter.route(ws, message);
    });

    ws.on("close", async (code: number, reason: Buffer) => {
      await sessionManager.cleanupClient(ws, "ws-close");

      // Clean up serial output buffer and timer
      outputBuffer.clearClient(ws);

      logger.warn(
        `Client disconnected (code=${code}, reason=${reason.toString() || "—"}). Remaining clients: ${wss.clients.size}`,
      );
    });

    ws.on("error", async (error) => {
      await sessionManager.cleanupClient(ws, "ws-error");

      // Clean up serial output buffer and timer
      outputBuffer.clearClient(ws);

      logger.error(
        `WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  async function stopAllRunnersAndNotify() {
    const cleanedUpCount = sessionManager.size;
    const cleanedTestRunIds: (string | undefined)[] = [];

    for (const [ws, clientState] of sessionManager.entries()) {
      sessionManager.abortQueuedAcquire(clientState);
      if (clientState.runner || clientState.reservation) {
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
