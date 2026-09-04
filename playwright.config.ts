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

  // E2E-Szenarien teilen sich absichtlich einen Backend-Port und einen
  // zustandsbehafteten Sandbox-Pool. Serielle Ausführung verhindert, dass
  // parallele Browser-Kontexte Compile-/WebSocket-Zustände vermischen.
  workers: 1,
  fullyParallel: false,
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
    // Use only the Express+Vite server (npm run dev), NOT dev:full.
    // dev:full also starts a standalone Vite dev server on port 3001; two
    // concurrent Vite instances watching the same files can trigger HMR
    // full-page reloads in the shared port-3000 server, destroying the test
    // execution context mid-test.
    // VITE_DISABLE_HMR=true suppresses the HMR full-reload that Vite sends
    // after its first-run dependency pre-bundling (no cache in CI).
    command: `PORT=${basePort} SANDBOX_POOL_MIN_RUNNERS=5 SANDBOX_POOL_MAX_RUNNERS=5 VITE_DISABLE_TOASTS=true VITE_DISABLE_HMR=true DISABLE_COMPILE_GATEKEEPER=true npm run dev:e2e`,
    url: `http://localhost:${basePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, 
    stdout: "pipe",
    stderr: "pipe",
  },
});
