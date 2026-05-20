/**
 * Playwright configuration for scalability tests.
 *
 * Differences from playwright.config.ts:
 *  - NO webServer block — uses the already-running Docker container
 *    (docker-compose up -d must be running before executing these tests)
 *  - testMatch limited to scalability-many-clients.spec.ts
 *  - testIgnore fully removed (not relevant here)
 *  - 1 worker — the spec opens many frames in a single browser page;
 *    additional workers would just multiply Docker load
 *  - Larger timeouts to accommodate 40–100 iframe connections
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/scalability-many-clients.spec.ts"],
  // No testIgnore — we're only running the one scalability spec
  timeout: 120_000, // 2 min per test (60 s WS-connect + headroom)
  workers: 1,
  fullyParallel: false,
  retries: 0,

  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  // ── NO webServer block ─────────────────────────────────────────────
  // These tests run against the live Docker stack.
  // Start it with: docker-compose down && docker-compose up -d --build
});
