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
  timeout: 90000, 
  
  // PARALLELISIERUNG AKTIVIERT
  // Nutzt 4 Worker lokal, in der CI (GitHub Actions etc.) 2, um Überlastung zu vermeiden
  workers: process.env.CI ? 2 : 4,               
  fullyParallel: true, // Erlaubt Playwright, Tests innerhalb einer Datei parallel auszuführen

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
    // Übergibt den dynamischen Port an den Server-Startbefehl
    command: `PORT=${basePort} npm run dev:full`,
    url: `http://localhost:${basePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, 
    stdout: "pipe",
    stderr: "pipe",
  },
});
