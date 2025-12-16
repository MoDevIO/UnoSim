import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security: Helmet adds various HTTP headers for protection
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Monaco Editor needs these
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));

// Security: Rate limiting to prevent DoS attacks
// In test/development mode, use higher limits
const isTestMode = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true';
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: isTestMode ? 10000 : 100, // 10000 in Test-Modus, 100 in Produktion
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestMode, // Komplett überspringen im Test-Modus
});

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' })); // Limit payload size
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Serve example files
app.use('/examples', express.static(path.resolve(__dirname, '..', 'public', 'examples')));

// Serve public folder static files FIRST (before API routes)
// public is now copied to dist/public during build
const publicPath = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicPath, { 
  index: false,
  dotfiles: 'ignore'
}));

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
    if (reqPath.startsWith("/api")) {
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

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    
    // In Production: keine Details leaken
    const message = isProduction && status === 500 
      ? "Internal Server Error" 
      : (err.message || "Internal Server Error");

    // Logging für Debugging (Server-seitig)
    if (status >= 500) {
      console.error(`[ERROR] ${status}: ${err.message}`, isProduction ? '' : err.stack);
    }

    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, () => {
    console.log(`[express] Server läuft auf http://localhost:${PORT}`);
  });

  //const PORT = process.env.PORT || 3000;
  //httpServer.listen(PORT, () => {
  //  console.log(`Backend listening on port ${PORT}`);

})();
