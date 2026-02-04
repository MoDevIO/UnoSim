import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    react(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist", "public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 3001, // Vite devserver Port
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
      // Proxy für Examples-Dateien
      "/examples": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
