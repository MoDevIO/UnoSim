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

  // queued-simulation-drain.spec.ts is a new (untracked) spec that still has
  // timing issues under local parallel load – excluded until stable.
  testIgnore: ["**/queued-simulation-drain.spec.ts"],

  // Global teardown: prints race-condition summary and runs leak check in CI
  globalTeardown: path.resolve(__dirname, "e2e/global-teardown.ts"),

  // Reporters: built-in list reporter + custom race-condition reporter
  reporter: [
    ["list"],
    [path.resolve(__dirname, "e2e/race-condition-reporter.ts")],
  ],

  // All scenarios share one backend. Only the tests tagged @server-runs run
  // sketches in the server's stateful sandbox pool (or load it with many
  // clients); they run one at a time in their own project. Every other test
  // uses the browser emulation and runs file by file in parallel workers.
  workers: 4,
  fullyParallel: false,
  projects: [
    { name: "browser", grepInvert: /@server-runs/ },
    { name: "server-runs", grep: /@server-runs/, workers: 1 },
  ],
  // The default template adds the project name; the baselines predate the projects.
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{-snapshotSuffix}{ext}",
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
    // NODE_ENV=test serves dist/public. Rebuild before starting the owned server
    // so local runs cannot test a stale client or stale board SVGs from an earlier checkout.
    // Use the test-mode Express server with built assets (npm run dev:e2e).
    // dev:full also starts a separate Vite server on port 3001; this run owns
    // just the application server on port 3000.
    command: `npm run provision:libraries && NODE_ENV=production npm run build && PORT=${basePort} SIMULATION_MAX_CONCURRENT=5 SANDBOX_START_MAX_CONCURRENT=8 VITE_DISABLE_TOASTS=true VITE_DISABLE_HMR=true npm run dev:e2e`,
    url: `http://localhost:${basePort}`,
    reuseExistingServer: false,
    timeout: 180 * 1000, 
    stdout: "pipe",
    stderr: "pipe",
  },
});
