import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getCompilationPool } from "./services/compilation-worker-pool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    } catch (err) {
      // Silently handle cleanup errors
    }
  }, CLEANUP_INTERVAL_MS);
}

const app = express();

// Security: Helmet adds various HTTP headers for protection
app.use(
  helmet({
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
      },
    },
  }),
);

// Security: Rate limiting to prevent DoS attacks
// In test/development mode, use higher limits
const isTestMode =
  process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true";
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: isTestMode ? 10000 : 100, // 10000 in Test-Modus, 100 in Produktion
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    isTestMode ||
    req.originalUrl === "/api/examples" ||
    req.originalUrl === "/api/health", // Skip for lightweight endpoints
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
  console.error(`[ERROR] Unhandled Promise Rejection at ${promise}:`, reason);
});

process.on("uncaughtException", (error) => {
  console.error(`[ERROR] Uncaught Exception:`, error);
  // In development, keep running; in production may want to restart
  if (process.env.NODE_ENV === "production") {
    console.error("Shutting down due to uncaught exception");
    process.exit(1);
  }
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === "production";

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
  const httpServer = server.listen(PORT, "0.0.0.0", () => {
    console.log(`[express] Server running at http://0.0.0.0:${PORT}`);

    // Start cleanup service for old temp files
    startCleanupService();
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
      } catch (poolErr) {
        console.error(`[Shutdown] Pool shutdown error:`, poolErr);
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
})();
