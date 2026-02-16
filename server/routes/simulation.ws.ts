import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { SandboxRunner } from "../services/sandbox-runner";
import type { IOPinRecord } from "@shared/schema";
import type { Logger } from "@shared/logger";
import fs from "fs";
import path from "path";

export type SimulationDeps = {
  SandboxRunner: typeof SandboxRunner;
  getSimulationRateLimiter: () => { checkLimit: (ws: WebSocket) => { allowed: boolean; retryAfter?: number }; removeClient: (ws: WebSocket) => void };
  shouldSendSimulationEndMessage: (compileFailed: boolean) => boolean;
  getLastCompiledCode: () => string | null;
  logger: Logger;
};

// Return type exposes a small API used by other modules (test-reset)
export function registerSimulationWebSocket(httpServer: Server, deps: SimulationDeps) {
  const { SandboxRunner, getSimulationRateLimiter, shouldSendSimulationEndMessage, getLastCompiledCode, logger } = deps;

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clientRunners = new Map<
    WebSocket,
    { runner: InstanceType<typeof SandboxRunner> | null; isRunning: boolean; isPaused: boolean; testRunId?: string }
  >();

  function sendMessageToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
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
                clientState.runner.stop();
                clientState.isRunning = false;
                clientState.isPaused = false;
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
                clientState.runner.stop();
                clientState.isRunning = false;
                clientState.isPaused = false;
              }

              sendMessageToClient(ws, { type: "serial_output", data: "[ERR] No compiled code available. Please compile first.\n" });
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              break;
            }

            if (clientState.runner) clientState.runner.stop();

            const runnerTempDir = clientState.testRunId ? path.join(process.cwd(), "temp", clientState.testRunId) : undefined;

            clientState.runner = new SandboxRunner({ tempDir: runnerTempDir });
            clientState.isRunning = true;
            clientState.isPaused = false;

            sendMessageToClient(ws, { type: "simulation_status", status: "running" });
            sendMessageToClient(ws, { type: "compilation_status", gccStatus: "compiling" });

            let gccSuccessSent = false;
            let compileFailed = false;

            const timeoutValue = "timeout" in data ? data.timeout : undefined;
            logger.info(`[Simulation] Starting with timeout: ${timeoutValue}s`);

            clientState.runner.runSketch(
              lastCompiledCode,
              (line: string, isComplete?: boolean) => {
                if (!gccSuccessSent) {
                  gccSuccessSent = true;
                  sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
                }
                sendMessageToClient(ws, { type: "serial_output", data: line, isComplete: isComplete ?? true });
              },
              (err: string) => {
                logger.warn(`[Client WS][ERR]: ${err}`);
                sendMessageToClient(ws, { type: "serial_output", data: "[ERR] " + err });
              },
              (exitCode: number | null) => {
                setTimeout(() => {
                  try {
                    const cs = clientRunners.get(ws);
                    if (cs) {
                      cs.isRunning = false;
                      cs.isPaused = false;
                    }

                    if (!shouldSendSimulationEndMessage(compileFailed)) return;

                    if (exitCode === 0 && !gccSuccessSent) {
                      gccSuccessSent = true;
                      sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
                    }

                    sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation ended: Loop cycles completed ---\n", isComplete: true });
                    sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
                  } catch (err) {
                    logger.error(`Error sending stop message: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }, 100);
              },
              (compileErr: string) => {
                compileFailed = true;
                sendMessageToClient(ws, { type: "compilation_error", data: compileErr });
                sendMessageToClient(ws, { type: "compilation_status", gccStatus: "error" });
                sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
                const cs = clientRunners.get(ws);
                if (cs) { cs.isRunning = false; cs.isPaused = false; }
                logger.error(`[Client Compile Error]: ${compileErr}`);
              },
              () => {
                if (!gccSuccessSent) {
                  gccSuccessSent = true;
                  sendMessageToClient(ws, { type: "compilation_status", gccStatus: "success" });
                }
              },
              (pin: number, type: "mode" | "value" | "pwm", value: number) => {
                sendMessageToClient(ws, { type: "pin_state", pin, stateType: type, value });
              },
              timeoutValue,
              (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => {
                const message: any = { type: "io_registry", registry, reason };
                if (baudrate !== undefined) message.baudrate = baudrate;
                sendMessageToClient(ws, message);
                logger.info(`[io_registry] ${registry.length} pins${baudrate !== undefined ? `, baud=${baudrate}` : ""}`);

                try {
                  const sketchDir = clientState?.runner?.getSketchDir();
                  if (sketchDir && fs.existsSync(sketchDir)) {
                    const registryFile = path.join(sketchDir, `io-registry-${Date.now()}.pending.json`);
                    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
                    logger.debug(`Registry saved: ${path.basename(registryFile)}`);
                    if (clientState.runner) clientState.runner.setRegistryFile(registryFile);
                  }
                } catch (err) {
                  logger.warn(`Failed to save I/O Registry file: ${err instanceof Error ? err.message : String(err)}`);
                }
              },
              (metrics: any) => sendMessageToClient(ws, { type: "sim_telemetry", metrics }),
              (batch: { states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }>; timestamp: number }) => {
                sendMessageToClient(ws, { type: "pin_state_batch", states: batch.states, timestamp: batch.timestamp });
              },
            );
          }
            break;

          case "code_changed": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner && (clientState?.isRunning || clientState?.isPaused)) {
              clientState.runner.stop();
              clientState.isRunning = false;
              clientState.isPaused = false;
              sendMessageToClient(ws, { type: "simulation_status", status: "stopped" });
              sendMessageToClient(ws, { type: "serial_output", data: "--- Simulation stopped due to code change ---\n" });
            }
          }
            break;

          case "stop_simulation": {
            const clientState = clientRunners.get(ws);
            if (clientState?.runner) {
              clientState.runner.stop();
              clientState.isRunning = false;
              clientState.isPaused = false;
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

    ws.on("close", () => {
      const clientState = clientRunners.get(ws);
      if (clientState?.runner) clientState.runner.stop();
      clientRunners.delete(ws);
      const rateLimiter = getSimulationRateLimiter();
      rateLimiter.removeClient(ws);
      logger.info(`Client disconnected. Remaining clients: ${wss.clients.size}`);
    });

    ws.on("error", (error) => {
      logger.error(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  function stopAllRunnersAndNotify() {
    const cleanedUpCount = clientRunners.size;
    const cleanedTestRunIds: (string | undefined)[] = [];

    for (const [ws, clientState] of clientRunners.entries()) {
      if (clientState.runner) {
        try { clientState.runner.stop(); } catch (err) { logger.debug(`Failed to stop runner during reset: ${err}`); }
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
