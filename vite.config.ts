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
    minify: "terser",
    terserOptions: {
      compress: {
        pure_funcs: ["console.debug"],
        drop_console: false,
      },
      mangle: true,
      output: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          "monaco-editor": ["monaco-editor"],
          "recharts": ["recharts"],
        },
      },
    },
  },
  server: {
    host: true,
    port: 3001, // Vite devserver Port
    hmr: {
      host: "localhost",
      port: 3001,
      protocol: "ws",
    },
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
