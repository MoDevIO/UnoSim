import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All workers share the single webServer on port 3000.
// The previous per-worker port logic (basePort += PW_WORKER_INDEX) caused Worker 1
// to connect to the standalone Vite dev server on port 3001, which has its own HMR
// WebSocket.  HMR full-reloads triggered by that separate Vite instance were
// disconnecting the simulation WebSocket mid-test → killing Docker → no serial output.
const basePort = 3000;

export default defineConfig({
  testDir: "./e2e",
  // In CI, Arduino CLI compilation (cold start) can take 60-90 s, so we need
  // a larger per-test budget.  Locally 90 s is still the default.
  timeout: process.env.CI ? 180000 : 90000,
  
  // Global teardown: prints race-condition summary and runs leak check in CI
  globalTeardown: path.resolve(__dirname, "e2e/global-teardown.ts"),

  // Reporters: built-in list reporter + custom race-condition reporter
  reporter: [
    ["list"],
    [path.resolve(__dirname, "e2e/race-condition-reporter.ts")],
  ],

  // PARALLELISIERUNG AKTIVIERT
  // Nutzt 4 Worker lokal, in der CI (GitHub Actions etc.) 2, um Überlastung zu vermeiden
  workers: process.env.CI ? 2 : 4,               
  fullyParallel: true, // Erlaubt Playwright, Tests innerhalb einer Datei parallel auszuführen
  retries: 1, // 1 Retry für flaky Cold-Start-Timing-Probleme

  expect: {
    timeout: 10000,         
  },
  use: {
    // Nutzt den dynamischen basePort für die Kommunikation mit dem Webserver
    baseURL: process.env.BASE_URL || `http://localhost:${basePort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  // ... restliche Config
  webServer: {
    // Übergibt den dynamischen Port an den Server-Startbefehl mit zusätzlichen gatekeeper-overrides
    command: `PORT=${basePort} VITE_DISABLE_TOASTS=true DISABLE_COMPILE_GATEKEEPER=true DISABLE_RATE_LIMIT=true npm run dev:full`,
    url: `http://localhost:${basePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, 
    stdout: "pipe",
    stderr: "pipe",
  },
});
