import type { Express } from "express";
import type { CompilationResult } from "./services/arduino-compiler";
import type { IOPinRecord } from "@shared/schema";

import { createServer, type Server } from "http";
import { createHash } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { compiler } from "./services/arduino-compiler";
import { SandboxRunner } from "./services/sandbox-runner";
import { getSimulationRateLimiter } from "./services/rate-limiter";
import { shouldSendSimulationEndMessage } from "./services/simulation-end";
import {
  insertSketchSchema,
  wsMessageSchema,
  type WSMessage,
} from "@shared/schema";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function registerRoutes(app: Express): Promise<Server> {
  const logger = new Logger("Routes");
  const httpServer = createServer(app);

  // Lightweight health endpoint for backend reachability checks
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Test Reset Endpoint: Cleanup all running simulations for idempotent test isolation
  // Each E2E test can call this before starting to ensure a clean backend state
  app.post("/api/test-reset", (_req, res) => {
    try {
      // Stop all active client runners and clean up their state
      const cleanedUpCount = clientRunners.size;
      const cleanedTestRunIds: (string | undefined)[] = [];
      
      for (const [ws, clientState] of clientRunners.entries()) {
        if (clientState.runner) {
          try {
            clientState.runner.stop();
          } catch (err) {
            logger.debug(`Failed to stop runner during reset: ${err}`);
          }
        }
        // Reset client state
        clientState.isRunning = false;
        clientState.isPaused = false;
        clientState.runner = null;
        cleanedTestRunIds.push(clientState.testRunId);

        // Send reset confirmation to client
        sendMessageToClient(ws, {
          type: "simulation_status",
          status: "stopped",
        });
      }

      logger.info(
        `[Test Reset] Cleaned up ${cleanedUpCount} client runner(s). TestRunIds: ${cleanedTestRunIds.filter(id => id).join(", ") || "none"}`
      );
      res.json({
        status: "reset",
        message: `Backend reset complete. Cleaned up ${cleanedUpCount} runner(s).`,
        cleanedTestRunIds: cleanedTestRunIds.filter(id => id),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`[Test Reset] Error during reset: ${error}`);
      res.status(500).json({
        error: "Reset failed",
        message: String(error),
      });
    }
  });

  // Setup WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  let lastCompiledCode: string | null = null;

  // Compilation Cache: Map<codeHash, CompilationResult>
  const compilationCache = new Map<
    string,
    { result: CompilationResult; timestamp: number }
  >();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Helper function to generate code hash
  function hashCode(
    code: string,
    headers?: Array<{ name: string; content: string }>,
  ): string {
    const combinedInput = code + JSON.stringify(headers || []);
    return createHash("sha256").update(combinedInput).digest("hex");
  }

  // Map to store per-client runner processes with testRunId for test isolation
  const clientRunners = new Map<
    WebSocket,
    { 
      runner: SandboxRunner | null; 
      isRunning: boolean; 
      isPaused: boolean;
      testRunId?: string; // For E2E test isolation - unique ID per test
    }
  >();

  function sendMessageToClient(ws: WebSocket, message: WSMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // --- Examples API endpoint ---
  app.get("/api/examples", (_req, res) => {
    try {
      const publicCandidates = [
        path.resolve(__dirname, "..", "public"),
        path.resolve(__dirname, "public"),
      ];
      const publicDir =
        publicCandidates.find((candidate) => fs.existsSync(candidate)) ||
        publicCandidates[0];
      const examplesDir = path.resolve(publicDir, "examples");
      const exampleFiles: string[] = [];

      // Recursively read all .ino and .h files from examples and subdirectories
      function readExamplesRecursive(dir: string, basePath: string = ""): void {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          const relativePath = basePath ? `${basePath}/${file}` : file;

          if (stat.isDirectory()) {
            // Recursively read subdirectories
            readExamplesRecursive(fullPath, relativePath);
          } else if (file.endsWith(".ino") || file.endsWith(".h")) {
            exampleFiles.push(relativePath);
          }
        }
      }

      readExamplesRecursive(examplesDir);
      exampleFiles.sort();

      res.json(exampleFiles);
    } catch (error) {
      logger.error(`Failed to read examples directory: ${error}`);
      res.status(500).json({ error: "Failed to fetch examples" });
    }
  });

  // --- Sketch CRUD routes (leicht gekürzt) ---
  app.get("/api/sketches", async (_req, res) => {
    try {
      const sketches = await storage.getAllSketches();
      res.json(sketches);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sketches" });
    }
  });

  app.get("/api/sketches/:id", async (req, res) => {
    try {
      const sketch = await storage.getSketch(req.params.id);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sketch" });
    }
  });

  app.post("/api/sketches", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.parse(req.body);
      const sketch = await storage.createSketch(validatedData);
      res.status(201).json(sketch);
    } catch (error) {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.put("/api/sketches/:id", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.partial().parse(req.body);
      const sketch = await storage.updateSketch(req.params.id, validatedData);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch (error) {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.delete("/api/sketches/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSketch(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Sketch not found" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete sketch" });
    }
  });

  // --- COMPILATION ---
  app.post("/api/compile", async (req, res) => {
    try {
      const { code, headers } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Code is required" });
      }

      // 🔥 CACHE CHECK: Hash the code and check if we've compiled it recently
      const codeHash = hashCode(code, headers);
      const cachedEntry = compilationCache.get(codeHash);

      if (cachedEntry) {
        const cacheAge = Date.now() - cachedEntry.timestamp;
        if (cacheAge < CACHE_TTL) {
          logger.info(`✅ Cache hit for code (age: ${cacheAge}ms)`);
          const result = cachedEntry.result;

          // Store the code for WebSocket-based simulation (even on cache hit)
          lastCompiledCode = code;

          // ❌ DO NOT BROADCAST - This is an HTTP endpoint
          // Each client manages their own compilation status locally
          // Only WebSocket messages update other clients' states

          return res.json({ ...result, cached: true });
        } else {
          // Cache expired
          compilationCache.delete(codeHash);
        }
      }

      // 🔄 ACTUAL COMPILATION: Code not in cache, compile it
      console.log(
        "[COMPILE] Received headers:",
        headers ? `${headers.length} files` : "none",
      );
      const testRunIdHeader = req.header("x-test-run-id") || undefined;
      const compileTempRoot = testRunIdHeader
        ? path.join(process.cwd(), "temp", testRunIdHeader)
        : undefined;

      const result: CompilationResult = await compiler.compile(
        code,
        headers,
        compileTempRoot,
      );

      // 💾 CACHE STORAGE: Save successful compilations
      if (result.success) {
        compilationCache.set(codeHash, { result, timestamp: Date.now() });
        logger.info(`✅ Cached compilation result for code`);
        // Store the code for WebSocket-based simulation
        lastCompiledCode = code;
      }

      // ❌ DO NOT BROADCAST - This is an HTTP endpoint
      // Each client manages their own compilation status locally
      // Only WebSocket messages update other clients' states
      // Rationale: CLI compilation is per-client (different code, different headers)

      // HTTP Response: Komplettes Ergebnis
      res.json(result);
    } catch (error) {
      // ❌ DO NOT BROADCAST errors from HTTP compile endpoint
      // Each client handles their own compilation errors
      res.status(500).json({ error: "Compilation failed" });
    }
  });

  // --- WebSocket Connection Handler (mit testRunId für Test-Isolation) ---
  wss.on("connection", (ws, req) => {
    // Extract testRunId from query params for E2E test isolation
    const url = req.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const testRunId = urlParams.get("testRunId") || undefined;
    
    logger.info(
      `New WebSocket client connected${testRunId ? ` [testRunId: ${testRunId}]` : ""}. Total clients: ${wss.clients.size}`,
    );

    // Initialize client session with testRunId
    clientRunners.set(ws, { 
      runner: null, 
      isRunning: false, 
      isPaused: false,
      testRunId 
    });

    // Send initial status
    const clientState = clientRunners.get(ws);
    sendMessageToClient(ws, {
      type: "simulation_status",
        status: clientState?.isPaused
          ? "paused"
          : clientState?.isRunning
            ? "running"
            : "stopped",
    });
    
    // Confirm testRunId handshake
    if (testRunId) {
      sendMessageToClient(ws, {
        type: "handshake",
        testRunId,
      });
    }

    ws.on("message", async (message) => {
      try {
        const data: WSMessage = wsMessageSchema.parse(
          JSON.parse(message.toString()),
        );

        switch (data.type) {
          case "start_simulation":
            {
              // 🔥 RATE LIMITING CHECK
              const rateLimiter = getSimulationRateLimiter();
              const limitCheck = rateLimiter.checkLimit(ws);
              
              if (!limitCheck.allowed) {
                const retryAfter = limitCheck.retryAfter || 30;
                logger.warn(
                  `[RateLimit] Simulation start rejected. Retry after ${retryAfter}s`
                );
                
                // Stop any running simulation for this client
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
                sendMessageToClient(ws, {
                  type: "simulation_status",
                  status: "stopped",
                });
                break;
              }

              const clientState = clientRunners.get(ws);
              if (!clientState) break;

              if (!lastCompiledCode) {
                // Stop any running simulation for this client
                if (clientState.runner) {
                  clientState.runner.stop();
                  clientState.isRunning = false;
                  clientState.isPaused = false;
                }
                
                sendMessageToClient(ws, {
                  type: "serial_output",
                  data: "[ERR] No compiled code available. Please compile first.\n",
                });
                sendMessageToClient(ws, {
                  type: "simulation_status",
                  status: "stopped",
                });
                break;
              }

              // Stop any current simulation for this client
              if (clientState.runner) clientState.runner.stop();

              const runnerTempDir = testRunId
                ? path.join(process.cwd(), "temp", testRunId)
                : undefined;

              // Create a NEW runner instance for this client (not reusing global one)
              clientState.runner = new SandboxRunner({ tempDir: runnerTempDir });
              clientState.isRunning = true;
              clientState.isPaused = false;

              // Update simulation status
              sendMessageToClient(ws, {
                type: "simulation_status",
                status: "running",
              });

              // Indicate that g++ is starting (for GCC status label)
              sendMessageToClient(ws, {
                type: "compilation_status",
                gccStatus: "compiling",
              });

              // Track if we've sent compile success
              let gccSuccessSent = false;
              let compileFailed = false;

              // Extract timeout from message (for start_simulation type)
              const timeoutValue = "timeout" in data ? data.timeout : undefined;
              logger.info(
                `[Simulation] Starting with timeout: ${timeoutValue}s`,
              );

              // Start genuine C++ execution with isComplete support!
              clientState.runner.runSketch(
                lastCompiledCode,
                (line: string, isComplete?: boolean) => {
                  // First output means compilation succeeded
                  if (!gccSuccessSent) {
                    gccSuccessSent = true;
                    sendMessageToClient(ws, {
                      type: "compilation_status",
                      gccStatus: "success",
                    });
                  }
                  // Backwards-compatible: detect wrapped SERIAL_EVENT JSON sent by backend
                  const serialWrapMatch =
                    typeof line === "string" &&
                    line.startsWith("[[SERIAL_EVENT_JSON:") &&
                    line.endsWith("]]");
                  if (serialWrapMatch) {
                    try {
                      const jsonStr = line.slice(
                        "[[SERIAL_EVENT_JSON:".length,
                        -2,
                      );
                      const payload = JSON.parse(jsonStr);
                      sendMessageToClient(ws, {
                        type: "serial_event",
                        payload,
                      });
                    } catch (err) {
                      // Fall back to raw output if parsing fails
                      sendMessageToClient(ws, {
                        type: "serial_output",
                        data: line,
                        isComplete: isComplete ?? true,
                      });
                    }
                  } else {
                    sendMessageToClient(ws, {
                      type: "serial_output",
                      data: line,
                      isComplete: isComplete ?? true,
                    });
                  }
                },
                (err: string) => {
                  logger.warn(`[Client WS][ERR]: ${err}`);
                  sendMessageToClient(ws, {
                    type: "serial_output",
                    data: "[ERR] " + err,
                  });
                },
                (exitCode: number | null) => {
                  setTimeout(() => {
                    try {
                      const clientState = clientRunners.get(ws);
                      if (clientState) {
                        clientState.isRunning = false;
                        clientState.isPaused = false;
                      }

                      if (!shouldSendSimulationEndMessage(compileFailed)) {
                        return;
                      }

                      // If we exit with code 0 and haven't sent success yet, send it now
                      if (exitCode === 0 && !gccSuccessSent) {
                        gccSuccessSent = true;
                        sendMessageToClient(ws, {
                          type: "compilation_status",
                          gccStatus: "success",
                        });
                      }
                      sendMessageToClient(ws, {
                        type: "serial_output",
                        data: "--- Simulation ended: Loop cycles completed ---\n",
                        isComplete: true,
                      });
                      sendMessageToClient(ws, {
                        type: "simulation_status",
                        status: "stopped",
                      });
                    } catch (err) {
                      logger.error(
                        `Error sending stop message: ${err instanceof Error ? err.message : String(err)}`,
                      );
                    }
                  }, 100);
                },
                (compileErr: string) => {
                  compileFailed = true;
                  // Send compile error to compilation output window
                  sendMessageToClient(ws, {
                    type: "compilation_error",
                    data: compileErr,
                  });
                  // Mark GCC compilation as failed
                  sendMessageToClient(ws, {
                    type: "compilation_status",
                    gccStatus: "error",
                  });
                  // Stop simulation status
                  sendMessageToClient(ws, {
                    type: "simulation_status",
                    status: "stopped",
                  });
                  const clientState = clientRunners.get(ws);
                  if (clientState) {
                    clientState.isRunning = false;
                    clientState.isPaused = false;
                  }
                  logger.error(`[Client Compile Error]: ${compileErr}`);
                },
                () => {
                  // onCompileSuccess callback - compilation succeeded, sketch is running
                  if (!gccSuccessSent) {
                    gccSuccessSent = true;
                    sendMessageToClient(ws, {
                      type: "compilation_status",
                      gccStatus: "success",
                    });
                  }
                },
                (
                  pin: number,
                  type: "mode" | "value" | "pwm",
                  value: number,
                ) => {
                  // Send pin state update to client
                  sendMessageToClient(ws, {
                    type: "pin_state",
                    pin,
                    stateType: type,
                    value,
                  });
                },
                timeoutValue, // Custom timeout in seconds (0 = infinite)
                (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => {
                  const baudStr = baudrate !== undefined ? `baudrate=${baudrate}` : "baudrate=not-defined";
                  logger.debug(
                    `[io_registry callback] Received registry with ${registry.length} pins, ${baudStr}`,
                  );
                  // Send I/O Registry to client
                  const message: any = {
                    type: "io_registry",
                    registry,
                    reason,
                  };
                  // Only include baudrate if it was explicitly defined
                  if (baudrate !== undefined) {
                    message.baudrate = baudrate;
                  }
                  sendMessageToClient(ws, message);
                  logger.info(
                    `[io_registry] Sent io_registry to client: ${registry.length} pins${baudrate !== undefined ? `, baud=${baudrate}` : ""}`,
                  );

                  // Also save registry to sketch directory for debugging (marked as pending)
                  try {
                    const sketchDir = clientState?.runner?.getSketchDir();
                    if (sketchDir && fs.existsSync(sketchDir)) {
                      const registryFile = path.join(
                        sketchDir,
                        `io-registry-${Date.now()}.pending.json`,
                      );
                      fs.writeFileSync(
                        registryFile,
                        JSON.stringify(registry, null, 2),
                      );
                      logger.debug(`I/O Registry saved to: ${registryFile}`);

                      // Store filename in runner for cleanup marking
                      if (clientState.runner)
                        clientState.runner.setRegistryFile(registryFile);
                    }
                  } catch (err) {
                    logger.warn(
                      `Failed to save I/O Registry file: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  }
                },
                (metrics: any) => {
                  // Forward telemetry metrics to client as dedicated SIM_TELEMETRY message
                  sendMessageToClient(ws, {
                    type: "sim_telemetry",
                    metrics,
                  });
                },
              );
            }
            break;

          case "code_changed":
            {
              logger.info("Received code_changed message");
              const clientState = clientRunners.get(ws);
              if (clientState?.runner && clientState?.isRunning) {
                logger.info("Stopping simulation due to code change");
                clientState.runner.stop();
                clientState.isRunning = false;
                clientState.isPaused = false;
                sendMessageToClient(ws, {
                  type: "simulation_status",
                  status: "stopped",
                });
                sendMessageToClient(ws, {
                  type: "serial_output",
                  data: "Simulation stopped due to code change\n",
                });
                logger.info("Simulation stopped due to code change");
              } else {
                logger.info("No running simulation to stop");
              }
            }
            break;

          case "stop_simulation":
            {
              const clientState = clientRunners.get(ws);
              if (clientState?.runner) {
                clientState.runner.stop();
                clientState.isRunning = false;
                clientState.isPaused = false;
              }
              sendMessageToClient(ws, {
                type: "simulation_status",
                status: "stopped",
              });
              sendMessageToClient(ws, {
                type: "serial_output",
                data: "--- Simulation stopped ---\n",
              });
            }
            break;

          case "pause_simulation":
            {
              const clientState = clientRunners.get(ws);
              if (clientState?.runner && clientState.isRunning) {
                const paused = clientState.runner.pause();
                if (paused) {
                  clientState.isPaused = true;
                  sendMessageToClient(ws, {
                    type: "simulation_status",
                    status: "paused",
                  });
                  sendMessageToClient(ws, {
                    type: "serial_output",
                    data: "--- Simulation paused ---\n",
                  });
                }
              } else {
                logger.warn(
                  "Pause requested but no running simulation is available.",
                );
              }
            }
            break;

          case "resume_simulation":
            {
              const clientState = clientRunners.get(ws);
              if (clientState?.runner && clientState.isPaused) {
                const resumed = clientState.runner.resume();
                if (resumed) {
                  clientState.isPaused = false;
                  clientState.isRunning = true;
                  sendMessageToClient(ws, {
                    type: "simulation_status",
                    status: "running",
                  });
                  sendMessageToClient(ws, {
                    type: "serial_output",
                    data: "--- Simulation resumed ---\n",
                  });
                }
              } else {
                logger.warn(
                  "Resume requested but simulation is not paused.",
                );
              }
            }
            break;

          case "serial_input":
            {
              const clientState = clientRunners.get(ws);
              if (
                clientState?.runner &&
                clientState?.isRunning &&
                !clientState.isPaused
              ) {
                clientState.runner.sendSerialInput(data.data);
              } else {
                logger.warn(
                  "Serial input received but simulation is not running.",
                );
              }
            }
            break;

          case "set_pin_value":
            {
              const clientState = clientRunners.get(ws);
              if (
                clientState?.runner &&
                (clientState.isRunning || clientState.isPaused)
              ) {
                clientState.runner.setPinValue(data.pin, data.value);
              } else {
                logger.warn(
                  "Pin value set received but simulation is not running.",
                );
              }
            }
            break;

          default:
            logger.warn(`Unbekannter WebSocket Nachrichtentyp: ${data.type}`);
            break;
        }
      } catch (error) {
        logger.error(
          `Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    ws.on("close", () => {
      const clientState = clientRunners.get(ws);
      if (clientState?.runner) {
        clientState.runner.stop();
      }
      clientRunners.delete(ws);
      
      // Clean up rate limiter for this client
      const rateLimiter = getSimulationRateLimiter();
      rateLimiter.removeClient(ws);
      
      logger.info(
        `Client disconnected. Remaining clients: ${wss.clients.size}`,
      );
    });

    ws.on("error", (error) => {
      logger.error(
        `WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  return httpServer;
}
