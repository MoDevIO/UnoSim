import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { Server } from "node:http";
import { getCompilationPool } from "./services/compilation-worker-pool";
import { config } from "./config";
import { INPUT_LIMITS } from "@shared/input-limits";
import { createLocalSessionMiddleware } from "./security/access-control";
import {
  formatStartupLine,
  getStartupConfigurationEntries,
} from "./startup-access";
import { shouldSkipApiRateLimit } from "./rate-limit-policy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseAllowedFrameAncestors(): string[] {
  return Array.from(new Set(config.server.allowedFrameAncestors));
}

// Cleanup service: Delete old .cleanup.json files and .cleanup directories (> 5 minutes old)
function startCleanupService(): NodeJS.Timeout {
  const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute
  const CLEANUP_AGE_MS = 5 * 60 * 1000; // Delete files/dirs older than 5 minutes

  return setInterval(async () => {
    try {
      const tempDir = path.join(process.cwd(), "temp");
      try {
        await fs.promises.access(tempDir);
      } catch {
        return; // tempDir doesn't exist
      }

      const items = await fs.promises.readdir(tempDir);
      const now = Date.now();
      let deletedCount = 0;

      for (const item of items) {
        const itemPath = path.join(tempDir, item);
        const stats = await fs.promises.stat(itemPath);
        const age = now - stats.mtimeMs;

        // Delete old .cleanup.json files
        if (item.endsWith(".cleanup.json") && age > CLEANUP_AGE_MS) {
          await fs.promises.unlink(itemPath);
          deletedCount++;
        }
        // Delete old .cleanup directories
        else if (
          item.endsWith(".cleanup") &&
          stats.isDirectory() &&
          age > CLEANUP_AGE_MS
        ) {
          await fs.promises.rm(itemPath, { recursive: true, force: true });
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        console.log(`[Cleanup] Deleted ${deletedCount} old temp items`);
      }
    } catch {
      // Silently handle cleanup errors
    }
  }, CLEANUP_INTERVAL_MS);
}

const app = express();

app.use(createLocalSessionMiddleware(config.trust));

if (config.trust.mode === "gateway") {
  app.set("trust proxy", config.trust.trustedProxy);
}

// Security: Helmet adds various HTTP headers for protection
function getFrameAncestorsHeader(): string {
  return `frame-ancestors ${parseAllowedFrameAncestors().join(" ")}`;
}

app.use(
  helmet({
    frameguard: false, // Deactivate X-Frame-Options; we use CSP frame-ancestors instead
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://replit.com", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        workerSrc: ["'self'", "blob:", "data:"],
        childSrc: ["'self'", "blob:"], // Wichtig für ältere Browser/Playwright
        frameAncestors: parseAllowedFrameAncestors(),
      },
    },
  }),
);

app.use((_, res, next) => {
  res.setHeader("Content-Security-Policy", getFrameAncestorsHeader());
  next();
});

// Security: Rate limiting to prevent DoS attacks
// In test/development mode, use higher limits
const isTestMode = config.isTest || config.server.disableRateLimit;
const apiLimiter = rateLimit({
  windowMs: config.server.apiRateLimitWindowMs, // 15 Minuten
  max: isTestMode ? config.server.apiRateLimitTestMax : config.server.apiRateLimitMax, // 10000 in Test-Modus, 300 in Produktion
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => shouldSkipApiRateLimit(req.originalUrl, isTestMode),
});

// Apply rate limiting to API routes
app.use("/api/", apiLimiter);

app.use(express.json({ limit: INPUT_LIMITS.rest.maxBodyBytes }));
app.use(express.urlencoded({ extended: false, limit: INPUT_LIMITS.rest.maxBodyBytes }));

// Resolve public folder for both dev (repo root) and prod (dist/public)
const publicPathCandidates = [
  path.resolve(__dirname, "..", "public"),
  path.resolve(__dirname, "public"),
];
const publicPath =
  publicPathCandidates.find((candidate) => fs.existsSync(candidate)) ||
  publicPathCandidates[0];
// Examples are served only through the validated /api/examples routes.
app.use("/examples", (_req, res) => {
  res.status(404).json({ error: "Direct example file access is disabled" });
});

// Serve public folder static files FIRST (before API routes)
// public is copied to dist/public during build
app.use(
  express.static(publicPath, {
    index: false,
    dotfiles: "ignore",
  }),
);

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api") && reqPath !== "/api/health") {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Global error handlers to prevent server crashes
process.on("unhandledRejection", (reason, promise) => {
  console.error(`[ERROR] Unhandled Promise Rejection:`, promise, reason);
});

process.on("uncaughtException", (error) => {
  console.error(`[ERROR] Uncaught Exception:`, error);
  // In development, keep running; in production may want to restart
  if (config.serverMode === "docker") {
    console.error("Shutting down due to uncaught exception");
    process.exit(1);
  }
});

// Ensure temp/ directory exists before any services try to write into it
fs.mkdirSync(path.join(process.cwd(), "temp"), { recursive: true });

const server = await registerRoutes(app);
let cleanupTimer: NodeJS.Timeout | null = null;

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProduction = config.serverMode === "docker";

    // In Production: keine Details leaken
    const message =
      isProduction && status === 500
        ? "Internal Server Error"
        : err.message || "Internal Server Error";

    // Logging für Debugging (Server-seitig)
    if (status >= 500) {
      console.error(
        `[ERROR] ${status}: ${err.message}`,
        isProduction ? "" : err.stack,
      );
    }

    res.status(status).json({ message });
  });

  // Development uses the standalone Vite server started by dev:full.
  // Docker and test runs serve the pre-built client on the API server.
  if (app.get("env") !== "development") {
    serveStatic(app);
  }

  // Start the API and application WebSocket listener on the configured backend port.
  const PORT = config.server.port;
  const listenHost = config.server.listenHost;
  const httpServer = server.listen(PORT, listenHost, () => {
    console.log(`\n┌──────────────────────────────────────────────────┐`);
    console.log(`│  UnoSim – Active Configuration                   │`);
    console.log(`├──────────────────────────────────────────────────┤`);
    getStartupConfigurationEntries({
      serverMode: config.serverMode,
      trustMode: config.trust.mode,
      nodeEnv: config.nodeEnv,
      simulationMaxConcurrent: config.capacity.simulationMaxConcurrent,
      admissionMax: config.capacity.admissionMax,
      queueTimeoutMs: config.capacity.queueTimeoutMs,
      sandboxStartMaxConcurrent: config.capacity.sandboxStartMaxConcurrent,
      sandboxStartSlotTimeoutMs: config.capacity.sandboxStartSlotTimeoutMs,
      compileMaxConcurrent: config.compilation.maxConcurrent,
      rateLimitDisabled: config.server.disableRateLimit,
      listenHost,
      port: PORT,
      sandboxMemoryMB: config.sandbox.resources.memoryMB,
      sandboxCpuLimit: config.sandbox.resources.cpuLimit,
      fqbn: config.compilation.fqbn,
    }).forEach(({ label, value }) => {
      console.log(formatStartupLine(label, value));
    });
    console.log(`└──────────────────────────────────────────────────┘\n`);
    console.log(`[express] Server running at http://${listenHost}:${PORT}`);
    console.log(`[startup] Runtime checks complete`);

    // Start cleanup service for old temp files
    cleanupTimer = startCleanupService();
  });

  // Keep-alive tuning: set these AFTER listen() to ensure the values take effect.
  // Node's default keepAliveTimeout is 5 s, which is shorter than many reverse-proxy
  // idle timeouts (e.g. nginx default 75 s, AWS ALB 60 s).  When the proxy closes a
  // connection that Node has already released, the next request on that slot gets a
  // "socket hang up" ECONNRESET.  Setting to 65 s prevents this.
  // headersTimeout must be > keepAliveTimeout to avoid a race on pipelined requests.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 70_000;

  // Graceful shutdown handler for worker pool and server
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      console.error(`[Shutdown] Force shutdown after 10s timeout`);
      process.exit(1);
    }, 10000);

    try {
      // Close HTTP server (stop accepting new connections)
      httpServer.close((err) => {
        if (err) {
          console.error(`[Shutdown] Server close error:`, err);
        } else {
          console.log(`[Shutdown] HTTP server closed`);
        }
      });

      // Gracefully shutdown the worker pool
      try {
        const pool = getCompilationPool();
        if (pool) {
          console.log(`[Shutdown] Shutting down compilation worker pool...`);
          await pool.shutdown();
          console.log(`[Shutdown] Worker pool shut down complete`);
        }
      } catch (error_) {
        console.error(`[Shutdown] Pool shutdown error:`, error_);
      }

      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      await (server as Server & { shutdownServices?: () => Promise<void> })
        .shutdownServices?.();

      clearTimeout(shutdownTimeout);
      console.log(`[Shutdown] Graceful shutdown complete`);
      process.exit(0);
    } catch (err) {
      console.error(`[Shutdown] Unexpected error during shutdown:`, err);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

// Handle termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
