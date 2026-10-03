import type { Express } from "express";
import type { CompilationResult } from "./services/arduino-compiler";
import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { ownedSketches } from "./storage";
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

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen

// modular route registrations
import { registerCompilerRoutes } from "./routes/compiler.routes";
import { registerSimulationWebSocket } from "./routes/simulation.ws";
import { registerStatusRoutes } from "./routes/status.routes";
import { registerConfigRoutes } from "./routes/config.routes";
import { registerTestResetRoute } from "./routes/test-reset.routes";
import { registerExamplesRoutes } from "./routes/examples.routes";
import { registerTutorRoutes } from "./routes/tutor.routes";
import { registerSketchRoutes } from "./routes/sketches.routes";
import { LastCompiledCodeStore } from "./services/last-compiled-code-store";
import { ExamplesRepository } from "./services/examples/examples-repository";
import { config } from "./config";
import { createUserAuthorizationMiddleware } from "./security/access-control";
import { apiVersionMiddleware } from "./services/protocol-version";
import { ProcessExecutor } from "./services/process-executor";
import { removeOrphanedSandboxContainers, sandboxOwner } from "./services/sandbox/orphan-sweep";

const WEBSOCKET_CLOSE_GRACE_MS = 250;

async function closeWebSocketClients(wss: WebSocketServer): Promise<void> {
  const clients = [...wss.clients].filter((client) => client.readyState !== WebSocket.CLOSED);
  if (clients.length === 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceCloseTimer);
      resolve();
    };
    const checkClosed = () => {
      if (clients.every((client) => client.readyState === WebSocket.CLOSED)) finish();
    };
    const forceCloseTimer = setTimeout(() => {
      for (const client of clients) {
        if (client.readyState !== WebSocket.CLOSED) client.terminate();
      }
      finish();
    }, WEBSOCKET_CLOSE_GRACE_MS);

    for (const client of clients) {
      client.once("close", checkClosed);
      client.close(1001, "Server shutdown");
    }
    checkClosed();
  });
}

function hashCode(
  code: string,
  headers?: Array<{ name: string; content: string }>,
  options?: { fqbn?: string; libraries?: string[]; entryFile?: string },
): string {
  const combinedInput = JSON.stringify({
    cacheVersion: 1,
    code,
    headers: headers || [],
    fqbn: options?.fqbn || "",
    libraries: [...(options?.libraries || [])].sort((a, b) => a.localeCompare(b)),
    entryFile: options?.entryFile || "sketch.ino",
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

  if (config.serverMode === "docker") {
    // Before any sandbox of this process exists: remove those a crashed predecessor left running.
    await removeOrphanedSandboxContainers(new ProcessExecutor(), sandboxOwner(), logger);
  }
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
   * Kept per subject: a start never runs code that another user compiled.
   */
  const lastCompiledCode = new LastCompiledCodeStore(config.compilation.lastCompiledCodeMaxSubjects);

  // Compilation Cache: Map<codeHash, CompilationResult>
  const compilationCache = new CompilationCache(config.compilation.resultCacheMaxEntries);
  const CACHE_TTL = config.compilation.resultCacheTtlMs; // 5 minutes

  // Placeholder for simulation websocket API (populated when WS module is registered)
  let simulationApi: {
    wss: WebSocketServer;
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
  const examplesRepository = new ExamplesRepository();
  registerExamplesRoutes(app, examplesRepository, {
    trust: config.trust,
    disableRateLimit: config.server.disableRateLimit,
  });
  registerTutorRoutes(app, {
    logger,
    disableRateLimit: config.server.disableRateLimit,
    courseContent: examplesRepository,
  });
  registerSketchRoutes(app, ownedSketches);

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
    setLastCompiledCode: (subject: string, code: string) => {
      lastCompiledCode.set(subject, code);
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
    getLastCompiledCode: (subject: string) => lastCompiledCode.get(subject),
    logger,
    runnerPool,
    trust: config.trust,
    allowedWebSocketOrigins: config.server.allowedWebSocketOrigins,
    disableRateLimit: config.server.disableRateLimit,
  });

  (httpServer as Server & { shutdownServices?: () => Promise<void> }).shutdownServices = async () => {
    await simulationApi?.stopAllRunnersAndNotify();
    if (simulationApi) {
      const { wss } = simulationApi;
      const closePromise = new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await closeWebSocketClients(wss);
      await closePromise;
    }
    await runnerPool.shutdown();
  };

  // (WS implementation moved to server/routes/simulation.ws.ts)

  return httpServer;
}
