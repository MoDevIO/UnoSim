import type { Express } from "express";
import type { CompilationResult } from "./services/arduino-compiler";

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { storage } from "./storage";
import { getPooledCompiler } from "./services/pooled-compiler";
import { SandboxRunner } from "./services/sandbox-runner";
import { getSimulationRateLimiter } from "./services/rate-limiter";
import { shouldSendSimulationEndMessage } from "./services/simulation-end";
import { getSandboxRunnerPool, initializeSandboxRunnerPool } from "./services/sandbox-runner-pool";
import { insertSketchSchema } from "@shared/schema";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen

// modular route registrations
import { registerCompilerRoutes } from "./routes/compiler.routes";
import { registerSimulationWebSocket } from "./routes/simulation.ws";
import { registerAuthRoutes } from "./routes/auth.routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hashCode(
  code: string,
  headers?: Array<{ name: string; content: string }>,
): string {
  const combinedInput = code + JSON.stringify(headers || []);
  return createHash("sha256").update(combinedInput).digest("hex");
}

export async function registerRoutes(app: Express): Promise<Server> {
  const logger = new Logger("Routes");
  const httpServer = createServer(app);

  await initializeSandboxRunnerPool();

  // Lightweight health endpoint for backend reachability checks
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Test Reset Endpoint: Cleanup all running simulations for idempotent test isolation
  // Each E2E test can call this before starting to ensure a clean backend state
  app.post("/api/test-reset", async (_req, res) => {
    try {
      // Delegate cleanup to the WebSocket module which owns runner state
      if (!simulationApi) {
        logger.warn("/api/test-reset called before WS module initialized");
        return res.json({ status: "reset", message: "No active runners", cleanedTestRunIds: [], timestamp: new Date().toISOString() });
      }

      const { cleanedUpCount, cleanedTestRunIds } = await simulationApi.stopAllRunnersAndNotify();

      logger.info(`[Test Reset] Cleaned up ${cleanedUpCount} client runner(s). TestRunIds: ${cleanedTestRunIds.join(", ") || "none"}`);
      res.json({ status: "reset", message: `Backend reset complete. Cleaned up ${cleanedUpCount} runner(s).`, cleanedTestRunIds, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error(`[Test Reset] Error during reset: ${error}`);
      res.status(500).json({ error: "Reset failed", message: String(error) });
    }
  });



  let lastCompiledCode: string | null = null;

  // Compilation Cache: Map<codeHash, CompilationResult>
  const compilationCache = new Map<
    string,
    { result: CompilationResult; timestamp: number }
  >();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Placeholder for simulation websocket API (populated when WS module is registered)
  let simulationApi: { stopAllRunnersAndNotify: () => Promise<{ cleanedUpCount: number; cleanedTestRunIds: string[] }> } | null = null;


  // --- Examples API endpoint ---

  // --- Examples API endpoint ---
  app.get("/api/examples", async (_req, res) => {
    try {
      const publicCandidates = [
        path.resolve(__dirname, "..", "public"),
        path.resolve(__dirname, "public"),
      ];
      
      // Find first existing public dir (async)
      let publicDir = publicCandidates[0];
      for (const candidate of publicCandidates) {
        try {
          await stat(candidate);
          publicDir = candidate;
          break;
        } catch {
          // Continue to next candidate
        }
      }
      
      const examplesDir = path.resolve(publicDir, "examples");
      const exampleFiles: string[] = [];

      // Recursively read all .ino and .h files from examples and subdirectories (async)
      async function readExamplesRecursive(dir: string, basePath: string = ""): Promise<void> {
        try {
          const files = await readdir(dir);

          for (const file of files) {
            const fullPath = path.join(dir, file);
            const s = await stat(fullPath);
            const relativePath = basePath ? `${basePath}/${file}` : file;

            if (s.isDirectory()) {
              // Recursively read subdirectories
              await readExamplesRecursive(fullPath, relativePath);
            } else if (file.endsWith(".ino") || file.endsWith(".h")) {
              exampleFiles.push(relativePath);
            }
          }
        } catch (err) {
          // Silently ignore directory read errors
          logger.debug(`Error reading examples dir ${dir}: ${err}`);
        }
      }

      await readExamplesRecursive(examplesDir);
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
    } catch {
      res.status(500).json({ error: "Failed to fetch sketches" });
    }
  });

  app.get("/api/sketches/:id", async (req, res) => {
    try {
      const sketch = await storage.getSketch(req.params.id);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch {
      res.status(500).json({ error: "Failed to fetch sketch" });
    }
  });

  app.post("/api/sketches", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.parse(req.body);
      const sketch = await storage.createSketch(validatedData);
      res.status(201).json(sketch);
    } catch {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.put("/api/sketches/:id", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.partial().parse(req.body);
      const sketch = await storage.updateSketch(req.params.id, validatedData);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.delete("/api/sketches/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSketch(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Sketch not found" });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete sketch" });
    }
  });

  // --- COMPILATION (moved to modular route) ---
  // Delegate the /api/compile handler to the compiler module and inject
  // the compilation cache + lastCompiledCode setter so behaviour is
  // unchanged but implementation is modularized.
  // 
  // Use PooledCompiler which routes work through worker threads for parallelization
  const pooledCompiler = getPooledCompiler();
  registerCompilerRoutes(app, {
    compiler: pooledCompiler,
    compilationCache,
    hashCode,
    CACHE_TTL,
    setLastCompiledCode: (code: string | null) => {
      lastCompiledCode = code;
    },
    logger,
  });

  // Register auth/session routes (placeholder)
  registerAuthRoutes(app);

  // --- WebSocket handler (moved to modular WS file) ---
  // Register WS handlers and receive a small API back so other routes
  // (e.g. /api/test-reset) can operate on the same runner state.
  const runnerPool = getSandboxRunnerPool();
  simulationApi = registerSimulationWebSocket(httpServer, {
    SandboxRunner,
    getSimulationRateLimiter,
    shouldSendSimulationEndMessage,
    getLastCompiledCode: () => lastCompiledCode,
    logger,
    runnerPool,
  });

  // (WS implementation moved to server/routes/simulation.ws.ts)

  return httpServer;
}
