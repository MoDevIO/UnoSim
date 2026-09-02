import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// Force NODE_ENV to 'test' regardless of shell environment.
// Vitest uses `process.env.NODE_ENV ??= "test"` which cannot override a
// pre-existing shell value (e.g. NODE_ENV=production from .env Scenario 2).
// React reads process.env.NODE_ENV at require() time; production builds lack
// act() support, which breaks all client-side tests.
process.env.NODE_ENV = "test";

const __dirname = path.resolve();

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client", "src"),
      "monaco-editor": path.resolve(
        __dirname,
        "tests",
        "mocks",
        "monaco-editor.ts",
      ),
    },
  },
  test: {
    globals: true,
    environmentOptions: {
      jsdom: {
        // Use in-memory storage instead of file-based to avoid --localstorage-file warning
        // This ensures localStorage is not persisted to disk during tests
        url: "http://localhost",
        storageQuota: 10000000, // 10MB quota
        pretendToBeVisual: true,
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc}.config.*",
      "e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      exclude: ["tests/**", "e2e/**", "**/node_modules/**", "**/dist/**"],
    },
    // Policy-Konformität: Flush-on-Failure Mechanismus
    // Bei Test-Fehlschlag wird Debug-Buffer auf Konsole geflushert
    silent: false,
    testTimeout: 30000,
    hookTimeout: 10000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit-client",
          include: ["tests/client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-node",
          include: [
            "tests/server/**/*.test.ts",
            "tests/shared/**/*.test.ts",
            "tests/core/**/*.test.ts",
            "tests/utils/**/*.test.ts",
            "tests/integration/**/*.test.ts",
          ],
          exclude: [
            "tests/integration/serial-flooding.test.ts",
            "tests/integration/serial-flow.test.ts",
            "tests/integration/compiler-canaries.test.ts",
            "tests/integration/worker-pool.*.test.ts",
            "tests/integration/concurrent-50-clients.test.ts",
            "tests/server/core-cache-locking.test.ts",
            "tests/server/services/scalability-stress.test.ts",
            "tests/server/load-suite.test.ts",
            "tests/server/pause-resume-digitalread.test.ts",
            "tests/server/pause-resume-timing.test.ts",
            "tests/server/timing-delay.test.ts",
            "tests/server/services/sandbox-lifecycle.integration.test.ts",
            "tests/server/services/serial-backpressure.test.ts",
            "tests/server/telemetry-heartbeat-integration.test.ts",
            "tests/core/sandbox-stress.test.ts",
          ],
          environment: "node",
          setupFiles: ["./tests/setup.node.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration-toolchain",
          include: [
            "tests/integration/compiler-canaries.test.ts",
            "tests/server/core-cache-locking.test.ts",
            "tests/server/telemetry-heartbeat-integration.test.ts",
            "tests/core/sandbox-stress.test.ts",
          ],
          environment: "node",
          setupFiles: ["./tests/setup.node.ts"],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: "integration-docker",
          include: [
            "tests/integration/serial-flooding.test.ts",
            "tests/integration/serial-flow.test.ts",
            "tests/server/pause-resume-digitalread.test.ts",
            "tests/server/pause-resume-timing.test.ts",
            "tests/server/timing-delay.test.ts",
            "tests/server/services/sandbox-lifecycle.integration.test.ts",
            "tests/server/services/serial-backpressure.test.ts",
          ],
          environment: "node",
          setupFiles: ["./tests/setup.node.ts"],
          globalSetup: ["./tests/global-setup.docker.ts"],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: "load",
          include: [
            "tests/server/load-suite.test.ts",
            "tests/server/services/scalability-stress.test.ts",
            "tests/integration/concurrent-50-clients.test.ts",
          ],
          environment: "node",
          setupFiles: ["./tests/setup.node.ts"],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
});
