import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Server } from "node:http";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Dynamic imports so the vite package (dev-only) is never resolved at
  // module load time — the production bundle would fail to find it.
  // vite.config.ts is NOT imported here; Vite auto-discovers it via configFile,
  // which keeps vite.config.ts (and its own `import from "vite"`) out of the
  // server bundle entirely.
  const { createServer: createViteServer, createLogger } = await import("vite");

  const viteLogger = createLogger();
  // Disable HMR when VITE_DISABLE_HMR=true (set during E2E / Playwright runs).
  // In CI, Vite has no pre-bundled dependency cache.  The first-time dep
  // optimisation fires a full-page reload via HMR mid-test, destroying the
  // execution context and breaking every test that runs Monaco or starts a
  // simulation.  With HMR disabled, Vite still serves the app correctly —
  // it just won't push reload events to the browser.
  const hmrConfig =
    process.env.VITE_DISABLE_HMR === "true" ? false : { server };
  const serverOptions = {
    middlewareMode: true,
    hmr: hmrConfig,
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist/public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
