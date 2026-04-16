import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { getCompilationPool } from "./services/compilation-worker-pool";
import { config } from "./config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseAllowedFrameAncestors(): string[] {
  return Array.from(new Set(config.server.allowedFrameAncestors));
}

// Cleanup service: Delete old .cleanup.json files and .cleanup directories (> 5 minutes old)
function startCleanupService() {
  const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute
  const CLEANUP_AGE_MS = 5 * 60 * 1000; // Delete files/dirs older than 5 minutes

  setInterval(async () => {
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
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: isTestMode ? 10000 : 300, // 10000 in Test-Modus, 300 in Produktion
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    isTestMode ||
    req.originalUrl === "/api/examples" ||
    req.originalUrl === "/api/status" ||
    req.originalUrl === "/api/health" ||
    req.originalUrl === "/api/config", // Skip for lightweight/polling endpoints
});

// Apply rate limiting to API routes
app.use("/api/", apiLimiter);

app.use(express.json({ limit: "1mb" })); // Limit payload size
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Resolve public folder for both dev (repo root) and prod (dist/public)
const publicPathCandidates = [
  path.resolve(__dirname, "..", "public"),
  path.resolve(__dirname, "public"),
];
const publicPath =
  publicPathCandidates.find((candidate) => fs.existsSync(candidate)) ||
  publicPathCandidates[0];
const examplesPath = path.resolve(publicPath, "examples");

// Serve example files
app.use("/examples", express.static(examplesPath));

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

let isServerReady = false; // Flag to indicate server initialization complete

// Ensure temp/ directory exists before any services try to write into it
fs.mkdirSync(path.join(process.cwd(), "temp"), { recursive: true });

const server = await registerRoutes(app);

  // Middleware to prevent requests during initialization
  // Returns 503 (Service Unavailable) until Docker checks complete
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Always allow health and browser static requests
    if (req.path === "/api/health" || req.path === "/" || req.path.startsWith("/assets/") || req.path.endsWith(".js") || req.path.endsWith(".css") || req.path.endsWith(".wasm")) {
      return next();
    }

    // If not ready yet, return 503 Service Unavailable for other endpoints
    if (!isServerReady) {
      return res.status(503).json({ error: "Service Unavailable", message: "Server is initializing Docker checks..." });
    }

    next();
  });

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

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // In production, use serveStatic to serve the pre-built client
  // In development, use Vite middleware for HMR
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 3000
  // this serves both the API and the client.
  const PORT = 3000;
  const httpServer = server.listen(PORT, "0.0.0.0", async () => {
    console.log(`[express] Server running at http://0.0.0.0:${PORT}`);
    console.log(`[startup] Warming up Docker checks asynchronously...`);

    // Start cleanup service for old temp files
    startCleanupService();

    // Warm up Docker checks asynchronously without blocking requests
    // This runs in the background and doesn't prevent incoming requests
    try {
      // Get any runner and warm it up (triggers lazy ensureDockerChecked)
      const { getSandboxRunnerPool } = await import("./services/sandbox-runner-pool");
      const pool = getSandboxRunnerPool();
      
      // Start warmup in background - don't await to avoid blocking
      (async () => {
        try {
          const runner = await pool.acquireRunner();
          // Just acquiring the runner will trigger ensureDockerChecked() if needed
          pool.releaseRunner(runner);
          isServerReady = true;
          console.log(`[startup] Docker checks warm-up complete, server ready for production requests`);
        } catch (err) {
          console.warn(`[startup] Docker warmup failed (non-blocking):`, err);
          // Still mark as ready even if warmup fails - requests will handle errors
          isServerReady = true;
        }
      })();

      // Also set isServerReady after a small delay as fallback (in case warmup is very fast)
      // This is a safety net for non-Docker environments
      setTimeout(() => {
        if (!isServerReady) {
          isServerReady = true;
          console.log(`[startup] Timeout-based ready flag set (Docker checks may still be pending)`);
        }
      }, 2000); // 2 second timeout for warmup
    } catch (err) {
      console.error(`[startup] Failed to start Docker warmup:`, err);
      // Still mark as ready to not break the server
      isServerReady = true;
    }
  });

  // Graceful shutdown handler for worker pool and server
  async function gracefulShutdown(signal: string) {
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
