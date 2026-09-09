import type { Express } from "express";
import type { CompilationResult } from "./services/arduino-compiler";

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { storage } from "./storage";
import { getCompilerWithFallback } from "./services/compiler-with-fallback";
import { SandboxRunner } from "./services/sandbox-runner";
import {
  getCompileRateLimiter,
  getSimulationRateLimiter,
} from "./services/rate-limiter";
import { getSimulationAdmissionController } from "./services/simulation-admission-controller";
import { shouldSendSimulationEndMessage } from "./services/simulation-end";
import {
  getSandboxRunnerPool,
  initializeSandboxRunnerPool,
} from "./services/sandbox-runner-pool";
import { insertSketchSchema } from "@shared/schema";

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen

// modular route registrations
import { registerCompilerRoutes } from "./routes/compiler.routes";
import { registerSimulationWebSocket } from "./routes/simulation.ws";
import { registerStatusRoutes } from "./routes/status.routes";
import { registerConfigRoutes } from "./routes/config.routes";
import { registerTestResetRoute } from "./routes/test-reset.routes";
import { registerExamplesRoutes } from "./routes/examples.routes";
import { registerTutorRoutes } from "./routes/tutor.routes";
import { ExamplesRepository } from "./services/examples/examples-repository";
import { config } from "./config";
import { createUserAuthorizationMiddleware } from "./security/access-control";
import { apiVersionMiddleware } from "./services/protocol-version";

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

  // All REST endpoints advertise and negotiate the same additive API contract.
  app.use("/api", apiVersionMiddleware);

  // Lightweight health endpoint for backend reachability checks
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const requireUser = createUserAuthorizationMiddleware(config.trust);
  app.use("/api/status", requireUser);
  app.use("/api/compile", requireUser);
  app.use("/api/sketches", requireUser);
  app.use("/api/tutor", requireUser);

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
  const compilationCache = new CompilationCache(config.compilation.resultCacheMaxEntries);
  const CACHE_TTL = config.compilation.resultCacheTtlMs; // 5 minutes

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
  registerExamplesRoutes(app, new ExamplesRepository());
  registerTutorRoutes(app, {
    logger,
    disableRateLimit: config.server.disableRateLimit,
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
    compileRateLimiter: getCompileRateLimiter(),
    disableRateLimit: config.server.disableRateLimit,
  });

  // --- WebSocket handler (moved to modular WS file) ---
  // Register WS handlers and receive a small API back so other routes
  // (e.g. /api/test-reset) can operate on the same runner state.
  const runnerPool = getSandboxRunnerPool();
  simulationApi = registerSimulationWebSocket(httpServer, {
    SandboxRunner,
    getSimulationRateLimiter,
    getSimulationAdmissionController,
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
