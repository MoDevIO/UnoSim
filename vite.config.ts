import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAllowedFrameAncestors(): string {
  const envValue = process.env.SIMULATOR_ALLOWED_PARENT_ORIGINS ?? process.env.ALLOW_EMBED_ORIGINS;
  const defaultOrigins = [
    "'self'",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  const customOrigins = envValue
    ? envValue.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

  const origins = Array.from(new Set([...defaultOrigins, ...customOrigins]));
  return `frame-ancestors ${origins.join(" ")}`;
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      "@assets": path.resolve(__dirname, "attached_assets"),
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist", "public"),
    emptyOutDir: true,
    manifest: true,
    // Monaco (~2.54 MB) and recharts (~514 kB) are lazy-loaded vendor chunks and
    // cannot shrink below 500 kB. Limit sits just above Monaco; the real size
    // gate is scripts/check-bundle-budget.mjs (total/largest/initial).
    chunkSizeWarningLimit: 2600,
    minify: "terser",
    terserOptions: {
      compress: {
        pure_funcs: ["console.debug"],
        drop_console: false,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Keep the `?worker` wrapper out of this group: main.tsx imports it statically and it
            // would otherwise make the whole Monaco chunk a static dependency of the entry.
            { name: "monaco-editor", test: /node_modules[\\/]monaco-editor[\\/](?!.*\?worker)/ },
          ],
        },
      },
    },
  },
  server: {
    // Loopback only: the proxied local backend runs sketches as native processes.
    host: "127.0.0.1",
    port: 3001, // Vite devserver Port
    headers: {
      "Content-Security-Policy": getAllowedFrameAncestors(),
    },
    proxy: {
      // Leitet API-Aufrufe an Backend auf Port 3000 weiter
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path, // Don't rewrite the path
      },
      // Proxy für WebSocket Pfad, wichtig für WS-Verbindungen (backend WS läuft auf 3000)
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
