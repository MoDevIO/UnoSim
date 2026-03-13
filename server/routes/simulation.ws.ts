import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { SandboxRunner } from "../services/sandbox-runner";
import type { IOPinRecord } from "@shared/schema";
import type { Logger } from "@shared/logger";
import { getSandboxRunnerPool } from "../services/sandbox-runner-pool";
import path from "path";
import { constants as zlibConstants } from "zlib";
import { writeFile, access } from "fs/promises";

export type SimulationDeps = {
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

  function sendMessageToClient(ws: WebSocket, message: any) {
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
    const lastLine = bufferState.lines[bufferState.lines.length - 1];
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
    if (!bufferState) {
      bufferState = { lines: [], flushTimer: null };
      clientSerialBuffers.set(ws, bufferState);
    }

    // Store line WITH its isComplete semantic for later intelligent combination
    const lineObj = { data: line, isComplete: isComplete ?? true };
    bufferState.lines.push(lineObj);

    // Schedule flush if not already scheduled
    if (!bufferState.flushTimer) {
      bufferState.flushTimer = setTimeout(() => {
        flushSerialOutputBuffer(ws);
      }, 50);
    }
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

  wss.on("connection", (ws, req) => {
    const url = req.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const testRunId = urlParams.get("testRunId") || undefined;

    logger.info(`New WebSocket client connected${testRunId ? ` [testRunId: ${testRunId}]` : ""}. Total clients: ${wss.clients.size}`);

    clientRunners.set(ws, { runner: null, isRunning: false, isPaused: false, testRunId });

    const clientState = clientRunners.get(ws);
    sendMessageToClient(ws, {
      type: "simulation_status",
      status: clientState?.isPaused ? "paused" : clientState?.isRunning ? "running" : "stopped",
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
        try { console.info(`[WS-IN] ${message.toString()}`); } catch {}
        const data = JSON.parse(message.toString());
        const type = data.type;

        switch (type) {
          case "start_simulation": {
            const rateLimiter = getSimulationRateLimiter();
            const limitCheck = rateLimiter.checkLimit(ws as WebSocket);
            if (!limitCheck.allowed) {
              const retryAfter = limitCheck.retryAfter || 30;
              logger.warn(`[RateLimit] Simulation start rejected. Retry after ${retryAfter}s`);

              const clientState = clientRunners.get(ws);
              if (clientState?.runner) {
                await safeReleaseRunner(clientState, "rate-limit");
              }

              sendMessageToClient(ws, {
                type: "serial_output",
                data: `[ERR] Rate limit exceeded. Too many simulation starts. Please wait ${retryAfter} seconds before starting again.\n`,
              });
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              break;
            }

            const clientState = clientRunners.get(ws);
            if (!clientState) break;

            const lastCompiledCode = getLastCompiledCode();
            if (!lastCompiledCode) {
              if (clientState.runner) {
                await safeReleaseRunner(clientState, "missing-compiled-code");
              }
              clientState.isRunning = false;
              clientState.isPaused = false;

              sendMessageToClient(ws, { type: "serial_output", data: "[ERR] No compiled code available. Please compile first.\n" });
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              break;
            }

            if (clientState.runner) {
              await safeReleaseRunner(clientState, "start-replace-existing");
            }

            try {
              clientState.runner = await pool.acquireRunner();
              logger.debug(`[SandboxRunnerPool] Acquired runner for client. Pool stats: ${JSON.stringify(pool.getStats())}`);
            } catch (error) {
              logger.error(`[SandboxRunnerPool] Failed to acquire runner: ${error}`);
              clientState.runner = null;
              clientState.isRunning = false;
              clientState.isPaused = false;
              sendMessageToClient(ws, { type: "serial_output", data: "[ERR] Server overloaded. All runners busy. Please try again.\n" });
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              break;
            }

            clientState.isRunning = true;
            clientState.isPaused = false;

            sendMessageToClient(ws, { type: "simulation_status", status: "running" });
            sendMessageToClient(ws, { type: "compilation_status", gccStatus: "compiling" });

            let gccSuccessSent = false;
            let compileFailed = false;

            const timeoutValue = "timeout" in data ? data.timeout : undefined;
            logger.info(`[Simulation] Starting with timeout: ${timeoutValue}s`);

            const opts = {
              code: lastCompiledCode,
              onOutput: (line: string, isComplete?: boolean) => {
                if (!gccSuccessSent) {
                  gccSuccessSent = true;
                  sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
                }
                sendSerialOutputBatched(ws, line, isComplete);
              },
              onError: (err: string) => {
                logger.warn(`[Client WS][ERR]: ${err}`);
                // Flush any buffered output before error message
                flushSerialOutputBuffer(ws);
                sendMessageToClient(ws, { type: "serial_output", data: "[ERR] " + err });
              },
              onExit: (exitCode: number | null) => {
                setTimeout(async () => {
                  try {
                    // Flush any remaining buffered output before simulation end message
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

                    sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation ended: Loop cycles completed ---\n", isComplete: true });
                    sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });

                    // Clean up buffer and timer for this client
                    const bufferState = clientSerialBuffers.get(ws);
                    if (bufferState?.flushTimer) {
                      clearTimeout(bufferState.flushTimer);
                    }
                  } catch (err) {
                    logger.error(`Error sending stop message: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }, 100);
              },
              onCompileError: (compileErr: string) => {
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
              },
              onCompileSuccess: () => {
                if (!gccSuccessSent) {
                  gccSuccessSent = true;
                  sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
                }
              },
              onPinState: (pin: number, type: "mode" | "value" | "pwm", value: number) => {
                sendMessageToClient(ws, { type: "pin_state", pin, stateType: type, value });
              },
              timeoutSec: timeoutValue,
              onIORegistry: (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => {
                const message: any = { type: "io_registry", registry, reason };
                if (baudrate !== undefined) message.baudrate = baudrate;
                sendMessageToClient(ws, message);
                logger.info(`[io_registry] ${registry.length} pins${baudrate !== undefined ? `, baud=${baudrate}` : ""}`);

                // Async save without blocking — fire-and-forget with error handling
                (async () => {
                  try {
                    const sketchDir = clientState?.runner?.getSketchDir();
                    if (!sketchDir) return;
                    
                    // Non-blocking directory check
                    try {
                      await access(sketchDir);
                    } catch {
                      return; // Directory doesn't exist
                    }
                    
                    const registryFile = path.join(sketchDir, `io-registry-${Date.now()}.pending.json`);
                    await writeFile(registryFile, JSON.stringify(registry, null, 2));
                    logger.debug(`Registry saved: ${path.basename(registryFile)}`);
                    if (clientState.runner) clientState.runner.setRegistryFile(registryFile);
                  } catch (err) {
                    logger.warn(`Failed to save I/O Registry file: ${err instanceof Error ? err.message : String(err)}`);
                  }
                })();
              },
              onTelemetry: (metrics: any) => sendMessageToClient(ws, { type: "sim_telemetry", metrics }),
              onPinStateBatch: (batch: { states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }>; timestamp: number }) => {
                sendMessageToClient(ws, { type: "pin_state_batch", states: batch.states, timestamp: batch.timestamp });
              },
              context: { sessionId: clientState.testRunId, label: data.label || "default-ws" },
            };

            // Log the consolidated payload for audit/evidence purposes
            try {
              console.info("[B1-Evidence] Payload:", JSON.stringify(opts, null, 2));
            } catch (err) {
              logger.warn(`Could not stringify run payload for evidence: ${err instanceof Error ? err.message : String(err)}`);
            }

            clientState.runner.runSketch({
              code: lastCompiledCode,
              onOutput: opts.onOutput,
              onError: opts.onError,
              onExit: opts.onExit,
              onCompileError: opts.onCompileError,
              onCompileSuccess: opts.onCompileSuccess,
              onPinState: opts.onPinState,
              timeoutSec: opts.timeoutSec,
              onIORegistry: opts.onIORegistry,
              onTelemetry: opts.onTelemetry,
              onPinStateBatch: opts.onPinStateBatch,
              context: opts.context,
            });
          }
            break;

          case "code_changed": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && (clientState?.isRunning || clientState?.isPaused)) {
              await safeReleaseRunner(clientState, "code_changed");
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation stopped due to code change ---\n" });
            }
          }
            break;

          case "stop_simulation": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner) {
              await safeReleaseRunner(clientState, "stop_simulation");
            }
            sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
            sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation stopped ---\n" });
          }
            break;

          case "pause_simulation": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && clientState.isRunning) {
              const paused = clientState.runner.pause();
              if (paused) {
                clientState.isPaused = true;
                sendMessageToClient(ws, { type: "simulation_status", status: "paused" });
                sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation paused ---\n" });
              }
            }
          }
            break;

          case "resume_simulation": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && clientState.isPaused) {
              const resumed = clientState.runner.resume();
              if (resumed) {
                clientState.isPaused = false;
                clientState.isRunning = true;
                sendMessageToClient(ws, { type: "simulation_status", status: "running" });
                sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation resumed ---\n" });
              }
            }
          }
            break;

          case "serial_input": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && clientState?.isRunning && !clientState.isPaused) {
              clientState.runner.sendSerialInput(data.data);
            }
          }
            break;

          case "set_pin_value": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && (clientState.isRunning || clientState.isPaused)) {
              clientState.runner.setPinValue(data.pin, data.value);
            }
          }
            break;

          default:
            logger.warn(`Unknown WS message type: ${JSON.stringify(data?.type)}`);
            break;
        }
      } catch (error) {
        logger.error(`Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`);
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
