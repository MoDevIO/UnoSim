import { WebSocketServer, WebSocket } from "ws";
import { createHash } from "node:crypto";
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
import {
  type ClientState,
  hasSimulationLifecycle,
  WsSessionManager,
} from "./simulation/ws-session-manager";
import { sendMessageToClient, WsOutputBuffer } from "./simulation/ws-output-buffer";
import { WEBSOCKET_PROTOCOL_VERSION } from "../services/protocol-version";
import {
  AdmissionResult,
  SimulationAdmissionController,
  SimulationReservation,
} from "../services/simulation-admission-controller";
import { operationError, SYSTEM_BUSY_MESSAGE } from "@shared/operation-errors";
import { config } from "../config";
import { InboundMessageLimiter } from "./simulation/ws-inbound-limiter";
import { safeErrorLogMetadata } from "../services/safe-error-log-metadata";
import { mapWithConcurrency, settleWithin } from "../services/concurrency";

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
        "RATE_LIMITED",
        "Rate-Limit erreicht: Pro Nutzer sind höchstens 5 laufende oder wartende Simulationen erlaubt.",
      ),
    );
  }
}

/**
 * Waits until no earlier lifecycle of this connection is being released.
 * Returns false when a stop, code change or disconnect arrived meanwhile.
 */
async function waitForPreviousRelease(clientState: ClientState): Promise<boolean> {
  const generation = clientState.startGeneration ?? 0;
  while (clientState.releasing) {
    await clientState.releasing.catch(() => undefined);
  }
  return !clientState.closed && (clientState.startGeneration ?? 0) === generation;
}

function rejectActiveLifecycle(ws: WebSocket, clientState: ClientState): void {
  sendMessageToClient(ws, {
    type: WSMessageType.OPERATION_ERROR,
    operation: "start_simulation",
    ...operationError(
      "SIMULATION_ALREADY_ACTIVE",
      "In dieser Sitzung läuft bereits eine Simulation oder wartet auf den Start. Bitte zuerst stoppen.",
    ),
  });
  // Resynchronise the client with the run that keeps going.
  let status: "paused" | "running" | "queued" = "queued";
  if (clientState.isPaused) status = "paused";
  else if (clientState.isRunning) status = "running";
  sendMessageToClient(ws, { type: WSMessageType.SIMULATION_STATUS, status });
}

/** Whether a start continuation still owns the connection's lifecycle. */
function ownsLifecycle(
  clientState: ClientState,
  reservation: SimulationReservation,
  runner: SandboxRunner,
): boolean {
  return clientState.reservation === reservation && clientState.runner === runner;
}

/** Preserve the existing serial diagnostic and stopped-status protocol. */
async function releaseFailedControl(
  ws: WebSocket, clientState: ClientState, sessionManager: WsSessionManager,
  operation: "pause" | "resume",
): Promise<void> {
  sendMessageToClient(ws, {
    type: WSMessageType.SERIAL_OUTPUT,
    data: `[ERR] Docker ${operation} failed; simulation stopped.\n`,
  });
  const reservation = clientState.reservation;
  await sessionManager.safeReleaseRunner(clientState, `${operation}_failed`, reservation);
  // A release can finish after a new run has already reserved this session.
  if (clientState.reservation && clientState.reservation !== reservation) return;
  sendMessageToClient(ws, { type: WSMessageType.SIMULATION_STATUS, status: "stopped" });
}

/**
 * Handle "pause_simulation" WebSocket message
 */
async function handlePauseSimulation(
  _ws: WebSocket,
  clientState: ClientState,
  sessionManager: WsSessionManager,
): Promise<void> {
  if (clientState?.runner && clientState.isRunning) {
    const runner = clientState.runner;
    const reservation = clientState.reservation;
    if (!runner.pause()) return;
    const paused = runner.controlResult ? await runner.controlResult : true;
    if (clientState.runner !== runner || clientState.reservation !== reservation) return;
    if (!paused) {
      await releaseFailedControl(_ws, clientState, sessionManager, "pause");
      return;
    }
    if (paused) {
      clientState.isPaused = true;
      sessionManager.markSessionPaused(clientState);
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
async function handleResumeSimulation(
  _ws: WebSocket,
  clientState: ClientState,
  sessionManager: WsSessionManager,
): Promise<void> {
  if (clientState?.runner && clientState.isPaused) {
    const runner = clientState.runner;
    const reservation = clientState.reservation;
    if (!runner.resume()) return;
    const resumed = runner.controlResult ? await runner.controlResult : true;
    if (clientState.runner !== runner || clientState.reservation !== reservation) return;
    if (!resumed) {
      await releaseFailedControl(_ws, clientState, sessionManager, "resume");
      return;
    }
    if (resumed) {
      clientState.isPaused = false;
      clientState.isRunning = true;
      sessionManager.markSessionRunning(clientState);
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
  getLastCompiledCode: (subject: string) => string | null;
  logger: Logger;
  runnerPool?: ReturnType<typeof getSandboxRunnerPool>;
  trust: TrustConfig;
  allowedWebSocketOrigins: readonly string[];
  disableRateLimit: boolean;
  heartbeatIntervalMs?: number;
  inboundMessageLimit?: { perSecond: number; burst: number };
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

  // Half-open connections (closed laptop, dropped Wi-Fi) would otherwise keep
  // their runner and admission until the simulation timeout.
  const answeredPing = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (answeredPing.get(client) === false) {
        client.terminate();
        continue;
      }
      answeredPing.set(client, false);
      client.ping();
    }
  }, deps.heartbeatIntervalMs ?? config.server.webSocketHeartbeatIntervalMs);
  heartbeat.unref?.();
  wss.on("close", () => clearInterval(heartbeat));
  const inboundLimit = deps.inboundMessageLimit ?? {
    perSecond: config.server.webSocketInboundMessagesPerSecond,
    burst: config.server.webSocketInboundMessageBurst,
  };

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
      logger.warn(`[Client WS][ERR] diagnostic received (${Buffer.byteLength(err)} bytes)`);
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
            // A start waiting for this release may already own the session.
            if (capturedCs.reservation && capturedCs.reservation !== reservation) return;
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
      logger.error(`[Client Compile Error] diagnostic received (${Buffer.byteLength(compileErr)} bytes)`);
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
    const clearOwnAbort = () => {
      if (clientState.queueAbortController === acquireAbort) {
        clientState.queueAbortController = null;
      }
    };
    let runner: SandboxRunner;
    try {
      runner = await pool.acquireRunner(acquireAbort.signal);
    } catch (error) {
      clearOwnAbort();
      // Stop, code change or disconnect already ended this lifecycle.
      if (clientState.reservation !== reservation) return false;
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
      await sessionManager.safeReleaseRunner(
        clientState,
        "runner-acquire-failed",
        reservation,
      );
      return false;
    }
    clearOwnAbort();
    if (clientState.reservation !== reservation) {
      // The lifecycle ended while the grant was in flight: the runner was
      // never attached to the session, so nothing else would return it.
      await pool.releaseRunner(runner);
      return false;
    }
    clientState.runner = runner;
    logger.debug(
      `[SandboxRunnerPool] Acquired runner for client. Pool stats: ${JSON.stringify(pool.getStats())}`,
    );
    return true;
  }

  /**
   * Log the run request for audit/evidence. Sketch source is never logged
   * (SECURITY.md); its length and a short digest identify the run.
   */
  function logRunPayloadAudit(
    code: string,
    timeoutSec: number | undefined,
    sessionId: string | undefined,
  ): void {
    const payload = {
      codeLength: code.length,
      codeSha256: createHash("sha256").update(code).digest("hex").slice(0, 12),
      timeoutSec,
      context: { sessionId, label: "default-ws" },
    };
    logger.debug(`[B1-Evidence] Payload: ${JSON.stringify(payload)}`);
  }

  /**
   * Admission phase of a start: waits for this connection's previous release,
   * then checks lifecycle, rate limit and code and reserves admission. Returns
   * null when the start was rejected or cancelled.
   */
  async function admitStart(
    ws: WebSocket,
    data: Extract<ClientToServerWSMessage, { type: "start_simulation" }>,
    clientState: ClientState,
  ): Promise<{ code: string; reservation: SimulationReservation } | null> {
    if (!(await waitForPreviousRelease(clientState))) return null;
    // From here to the reservation everything runs synchronously, so the
    // lifecycle check and the reservation are atomic for this connection.
    if (hasSimulationLifecycle(clientState)) {
      rejectActiveLifecycle(ws, clientState);
      return null;
    }

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
          `Rate-Limit: Bitte warte ${retryAfter} Sekunden, bevor du eine weitere Simulation startest.`,
          retryAfter,
        ),
      );
      return null;
    }

    // Use per-client code from the WS message if provided (multi-client isolation),
    // Deprecated compatibility fallback. New clients send code per session;
    // remove this branch at the next protocol-major release.
    const code =
      "code" in data &&
      typeof data.code === "string" &&
      data.code.trim().length > 0
        ? data.code
        : getLastCompiledCode(clientState.subject);
    if (!code) {
      sendMessageToClient(ws, {
        type: WSMessageType.SERIAL_OUTPUT,
        data: "[ERR] No compiled code available. Please compile first.\n",
      });
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      return null;
    }

    const admission = admissionController.reserve(clientState.subject);
    if (!admission.admitted) {
      rejectAdmission(ws, admission);
      return null;
    }
    clientState.reservation = admission.reservation;
    return { code, reservation: admission.reservation };
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
    const admitted = await admitStart(ws, data, clientState);
    if (!admitted) return;
    const { code, reservation } = admitted;

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

    // Keep the client in STARTING until runSketch confirms process readiness.
    // The lifecycle manager performs the actual running transition atomically.
    sendMessageToClient(ws, {
      type: WSMessageType.COMPILATION_STATUS,
      arduinoCliStatus: "compiling",
      workerIndex: acquiredWorkerIndex,
      workerTotal: sessionManager.countRunningClients() + 1,
    });

    // Broadcast updated count to all OTHER running clients (ws excluded because
    // it just received the full workerIndex+workerTotal message above).
    sessionManager.broadcastWorkerTotal(ws);

    // Build callbacks
    const callbacks = buildRunSketchCallbacks(ws, clientState, reservation);
    let runnerReady = false;
    let pendingCompileSuccesses = 0;
    const onCompileSuccess = () => {
      if (runnerReady) {
        callbacks.onCompileSuccess();
      } else {
        pendingCompileSuccesses += 1;
      }
    };
    const timeoutValue = "timeout" in data ? data.timeout : undefined;
    logger.info(`[Simulation] Starting with timeout: ${timeoutValue}s`);

    // Log consolidated payload for audit
    logRunPayloadAudit(code, timeoutValue, clientState.testRunId);

    // Start sketch execution once the runner has resolved.
    try {
      const processReady = await acquiredRunner.runSketch({
        code,
        headers: data.headers,
        entryFile: data.entryFile,
        onOutput: callbacks.onOutput,
        onError: callbacks.onError,
        onExit: callbacks.onExit,
        onCompileError: callbacks.onCompileError,
        onCompileSuccess,
        onCompileQueued: callbacks.onCompileQueued,
        onPinState: callbacks.onPinState,
        timeoutSec: timeoutValue,
        onIORegistry: callbacks.onIORegistry,
        onTelemetry: callbacks.onTelemetry,
        onPinStateBatch: callbacks.onPinStateBatch,
        context: { sessionId: clientState.testRunId, label: "default-ws" },
      });
      if (!processReady) return;
    } catch (error) {
      logger.error(`[Simulation] runSketch failed (${safeErrorLogMetadata(error)})`);
      // A stop or disconnect during startup already released and reported.
      if (clientState.reservation !== reservation) return;
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
    // Ended during startup: never mark a released session as running.
    if (!ownsLifecycle(clientState, reservation, acquiredRunner)) return;

    sessionManager.markSessionRunning(clientState);
    sendMessageToClient(ws, {
      type: WSMessageType.SIMULATION_STATUS,
      status: "running",
    });
    runnerReady = true;
    while (pendingCompileSuccesses > 0) {
      callbacks.onCompileSuccess();
      pendingCompileSuccesses -= 1;
    }
  }

  /**
   * Handle "code_changed" WebSocket message
   */
  async function handleCodeChanged(
    _ws: WebSocket,
    clientState: ClientState,
  ): Promise<void> {
    sessionManager.cancelPendingStart(clientState);
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
    sessionManager.cancelPendingStart(clientState);
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
      pauseSimulation: (ws, _data, clientState) => handlePauseSimulation(ws, clientState, sessionManager),
      resumeSimulation: (ws, _data, clientState) => handleResumeSimulation(ws, clientState, sessionManager),
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
      metricsState: null,
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

    answeredPing.set(ws, true);
    ws.on("pong", () => answeredPing.set(ws, true));

    const inbound = new InboundMessageLimiter(inboundLimit.perSecond, inboundLimit.burst);
    let droppedMessages = 0;
    ws.on("message", async (message) => {
      if (!inbound.tryTake()) {
        droppedMessages += 1;
        if (droppedMessages === 1) {
          logger.warn(`[WS] Inbound message rate exceeded for subject ${identity.subject}; dropping excess messages`);
        }
        return;
      }
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

  /**
   * Ends every session's lifecycle (shutdown and test reset). Releases run in
   * parallel with bounded concurrency, and a release that hangs stops being
   * awaited after the shutdown stop timeout: the pool shutdown and the final
   * owner sweep remove what is left.
   */
  async function stopAllRunnersAndNotify() {
    const sessions = [...sessionManager.entries()];
    const settled = await mapWithConcurrency(sessions, config.sandbox.pool.shutdownConcurrency, async ([ws, clientState]) => {
      sessionManager.cancelPendingStart(clientState);
      sessionManager.abortQueuedAcquire(clientState);
      const released = clientState.runner || clientState.reservation
        ? await settleWithin(safeReleaseRunner(clientState, "test-reset"), config.sandbox.pool.shutdownStopTimeoutMs)
        : true;
      clientState.isRunning = false;
      clientState.isPaused = false;
      sendMessageToClient(ws, {
        type: WSMessageType.SIMULATION_STATUS,
        status: "stopped",
      });
      return released;
    });
    const unfinished = settled.filter((released) => !released).length;
    if (unfinished > 0) {
      logger.warn(`[Simulation] ${unfinished} session release(s) exceeded the shutdown stop timeout`);
    }

    const cleanedTestRunIds = sessions
      .map(([, clientState]) => clientState.testRunId)
      .filter((id): id is string => Boolean(id));
    return { cleanedUpCount: sessions.length, cleanedTestRunIds };
  }

  return { wss, stopAllRunnersAndNotify };
}
