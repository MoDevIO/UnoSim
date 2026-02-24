import { defineConfig, devices } from "@playwright/test";

// choose a unique port per worker to avoid collisions when tests start their own server
// PW_WORKER_INDEX is provided by Playwright when spawning workers.
// ensure we don't end up with NaN if the env var is missing or corrupt
let basePort = 3000;
if (process.env.PW_WORKER_INDEX) {
  const idx = parseInt(process.env.PW_WORKER_INDEX, 10);
  if (!Number.isNaN(idx)) {
    basePort += idx;
  }
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 90000, // <--- Das globale Test-Limit auf 90s hochsetzen
  workers: 1,               // single worker for backend-simulator stability
  fullyParallel: false,
  expect: {
    timeout: 10000,         // allow a little extra for selector waits
  },
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:3000`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  // ignore anything in the archive – it's just a backup, not runnable
  testIgnore: ["archive/**"],
  // ... restliche Config
  webServer: {
    command: `PORT=${basePort} npm run dev:full`,
    url: `http://localhost:${basePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, // <--- Dem Server 3 Minuten Zeit zum Kompilieren geben
    stdout: "pipe",
    stderr: "pipe",
  },
});
