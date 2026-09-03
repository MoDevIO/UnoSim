import type { Express } from "express";
import type { CompilationResult } from "./services/arduino-compiler";

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { storage } from "./storage";
import { getCompilerWithFallback } from "./services/compiler-with-fallback";
import { SandboxRunner } from "./services/sandbox-runner";
import { getSimulationRateLimiter } from "./services/rate-limiter";
import { shouldSendSimulationEndMessage } from "./services/simulation-end";
import {
  getSandboxRunnerPool,
  initializeSandboxRunnerPool,
} from "./services/sandbox-runner-pool";
import { insertSketchSchema } from "@shared/schema";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen

// modular route registrations
import { registerCompilerRoutes } from "./routes/compiler.routes";
import { registerSimulationWebSocket } from "./routes/simulation.ws";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerStatusRoutes } from "./routes/status.routes";
import { registerConfigRoutes } from "./routes/config.routes";
import { registerTestResetRoute } from "./routes/test-reset.routes";
import { config } from "./config";
import { createUserAuthorizationMiddleware } from "./security/access-control";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hashCode(
  code: string,
  headers?: Array<{ name: string; content: string }>,
  options?: { fqbn?: string; libraries?: string[] },
): string {
  const combinedInput = JSON.stringify({
    cacheVersion: 1,
    code,
    headers: headers || [],
    fqbn: options?.fqbn || "",
    libraries: [...(options?.libraries || [])].sort((a, b) => a.localeCompare(b)),
  });
  return createHash("sha256").update(combinedInput).digest("hex");
}

class CompilationCache extends Map<string, { result: CompilationResult; timestamp: number }> {
  constructor(private readonly maxEntries = 100) {
    super();
  }

  override get(key: string) {
    const entry = super.get(key);
    if (entry) {
      super.delete(key);
      super.set(key, entry);
    }
    return entry;
  }

  override set(key: string, value: { result: CompilationResult; timestamp: number }) {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.maxEntries) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) break;
      super.delete(oldest);
    }
    return this;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const logger = new Logger("Routes");
  const httpServer = createServer(app);

  await initializeSandboxRunnerPool();

  // Lightweight health endpoint for backend reachability checks
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const requireUser = createUserAuthorizationMiddleware(config.trust);
  app.use("/api/status", requireUser);
  app.use("/api/compile", requireUser);
  app.use("/api/sketches", requireUser);

  // Detailed status endpoint: pool stats + compile semaphore stats
  registerStatusRoutes(app);

  // Client configuration endpoint
  registerConfigRoutes(app);

  /**
   * Legacy compatibility fallback for clients that omit code in
   * start_simulation. New clients must send the compiled code per session.
   * Planned for removal after the legacy protocol sunset (next major release).
   */
  let lastCompiledCode: string | null = null;

  // Compilation Cache: Map<codeHash, CompilationResult>
  const compilationCache = new CompilationCache(100);
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Placeholder for simulation websocket API (populated when WS module is registered)
  let simulationApi: {
    wss: { close: (callback?: () => void) => void };
    stopAllRunnersAndNotify: () => Promise<{
      cleanedUpCount: number;
      cleanedTestRunIds: string[];
    }>;
  } | null = null;

  registerTestResetRoute(app, {
    isTest: config.isTest,
    enabled: config.server.enableTestEndpoints,
    getSimulationApi: () => simulationApi,
    logger,
  });

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
      async function readExamplesRecursive(
        dir: string,
        basePath: string = "",
      ): Promise<void> {
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
      exampleFiles.sort((a, b) => a.localeCompare(b));

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
  // Use CompilerWithFallback which routes work through worker threads for parallelization
  const compiler = getCompilerWithFallback();
  registerCompilerRoutes(app, {
    compiler,
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
    trust: config.trust,
    allowedWebSocketOrigins: config.server.allowedWebSocketOrigins,
    disableRateLimit: config.server.disableRateLimit,
  });

  (httpServer as Server & { shutdownServices?: () => Promise<void> }).shutdownServices = async () => {
    await simulationApi?.stopAllRunnersAndNotify();
    await new Promise<void>((resolve) => {
      if (!simulationApi) return resolve();
      simulationApi.wss.close(() => resolve());
    });
    await runnerPool.shutdown();
  };

  // (WS implementation moved to server/routes/simulation.ws.ts)

  return httpServer;
}
