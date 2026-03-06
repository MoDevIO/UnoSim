import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    chunkSizeWarningLimit: 5000, // Monaco editor (core + all language packs) ~4.2 MB minified
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
        manualChunks(id: string) {
          if (id.includes("node_modules/monaco-editor")) {
            // All monaco-editor modules go into one chunk (core + language packs).
            // Monaco's language contribution files import Monaco core APIs, which
            // creates circular Rollup chunk references when split — so we keep
            // everything together. Reduces ~80 individual language files to 1 chunk.
            return "monaco-editor";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "recharts";
          }
        },
      },
    },
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
