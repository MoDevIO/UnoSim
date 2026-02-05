"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var vite_1 = require("vite");
var plugin_react_1 = require("@vitejs/plugin-react");
var vite_tsconfig_paths_1 = require("vite-tsconfig-paths");
var path_1 = require("path");
var url_1 = require("url");
var vite_plugin_runtime_error_modal_1 = require("@replit/vite-plugin-runtime-error-modal");
var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
exports.default = (0, vite_1.defineConfig)({
    plugins: __spreadArray([
        (0, vite_tsconfig_paths_1.default)(),
        (0, plugin_react_1.default)()
    ], (process.env.NODE_ENV !== "production" &&
        process.env.REPL_ID !== undefined
        ? [
            (0, vite_plugin_runtime_error_modal_1.default)(),
            await Promise.resolve().then(function () { return require("@replit/vite-plugin-cartographer"); }).then(function (m) {
                return m.cartographer();
            }),
        ]
        : []), true),
    resolve: {
        alias: {
            "@assets": path_1.default.resolve(__dirname, "attached_assets"),
        },
    },
    root: path_1.default.resolve(__dirname, "client"),
    build: {
        outDir: path_1.default.resolve(__dirname, "dist", "public"),
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
                rewrite: function (path) { return path; }, // Don't rewrite the path
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
                rewrite: function (path) { return path; },
            },
        },
        fs: {
            strict: true,
            deny: ["**/.*"],
        },
    },
});
