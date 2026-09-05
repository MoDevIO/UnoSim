/**
 * Central UnoSim Configuration
 *
 * Single source of truth for all server-side tunable parameters.
 * Values are read from environment variables with sensible defaults.
 * Import this module instead of reading process.env directly.
 *
 * Two axes control the runtime topology:
 *   • Server Mode:     "local" (dev machine) | "docker" (docker-compose)
 *   • Simulation Mode: "local" (native g++ child process) | "docker-sandbox" (isolated container)
 */
import os from "node:os";
import path from "node:path";
import { parseTrustConfig } from "./security/access-control";

// ── Mode Types ──────────────────────────────────────────────────────

/** Where the UnoSim server itself runs */
export type ServerMode = "local" | "docker";

/** Where Arduino sketch simulations are executed */
export type SimulationMode = "local" | "docker-sandbox";

// ── Env-var helpers ─────────────────────────────────────────────────

export function parseEnvInt(key: string, value: string | undefined, fallback: number, options: { min?: number; max?: number } = {}): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[+-]?\d+$/.test(value.trim())) {
    throw new Error(`Invalid ${key}: expected an integer, received "${value}"`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (options.min !== undefined && parsed < options.min) || (options.max !== undefined && parsed > options.max)) {
    throw new Error(`Invalid ${key}: value must be between ${options.min ?? "-∞"} and ${options.max ?? "∞"}`);
  }
  return parsed;
}

function envInt(key: string, fallback: number, options?: { min?: number; max?: number }): number {
  return parseEnvInt(key, process.env[key], fallback, options);
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envEnum<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const value = envStr(key, fallback);
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid ${key}: expected one of ${allowed.join(", ")}, received "${value}"`);
  }
  return value as T;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  if (v === "1" || v.toLowerCase() === "true") return true;
  if (v === "0" || v.toLowerCase() === "false") return false;
  throw new Error(`Invalid ${key}: expected true/false, received "${v}"`);
}

function envFloat(key: string, fallback: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: expected a positive number, received "${value}"`);
  }
  return value.trim();
}

function envList(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Derived pool values ─────────────────────────────────────────────

const poolMinRunners = envInt("SANDBOX_POOL_MIN_RUNNERS", 5, { min: 0, max: 1000 });
// In dev (no docker-compose) maxRunners defaults to minRunners for safety.
// Production sets SANDBOX_POOL_MAX_RUNNERS=100 via docker-compose.yml.
const poolMaxRunners = envInt("SANDBOX_POOL_MAX_RUNNERS", poolMinRunners, { min: 0, max: 1000 });
export function validatePoolBounds(minRunners: number, maxRunners: number): void {
  if (minRunners > maxRunners) {
    throw new Error(`Invalid sandbox pool configuration: SANDBOX_POOL_MIN_RUNNERS (${minRunners}) must not exceed SANDBOX_POOL_MAX_RUNNERS (${maxRunners})`);
  }
}
validatePoolBounds(poolMinRunners, poolMaxRunners);

const cwd = process.cwd();
const cpuCount = os.cpus().length;
const defaultWorkers = Math.min(8, Math.max(2, Math.floor(cpuCount * 0.5)));
const defaultCompileMaxConcurrent = Math.max(1, cpuCount - 1);
const trust = parseTrustConfig(process.env);
const localWebSocketOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

// ── Config ──────────────────────────────────────────────────────────

export const config = {
  /** Runtime environment name, captured once at startup. */
  nodeEnv: process.env.NODE_ENV ?? "development",
  /**
   * Server mode: "local" (dev) or "docker" (docker-compose).
   * Set via UNOSIM_SERVER_MODE env var; falls back to NODE_ENV detection.
   */
  serverMode: envEnum(
    "UNOSIM_SERVER_MODE",
    process.env.NODE_ENV === "production" ? "docker" : "local",
    ["local", "docker"] as const,
  ),

  /**
   * Simulation execution mode.
   * "docker-sandbox" uses isolated Docker containers per sketch.
   * "local" compiles and runs sketches as native child processes.
   * Set via UNOSIM_SIMULATION_MODE or legacy FORCE_DOCKER env var.
   */
  simulationMode: envEnum(
    "UNOSIM_SIMULATION_MODE",
    envBool("FORCE_DOCKER", false) ? "docker-sandbox" : "local",
    ["local", "docker-sandbox"] as const,
  ),

  /** True when running under a test framework */
  isTest: process.env.NODE_ENV === "test",

  /** HTTP and WebSocket authentication boundary. */
  trust,

  // ── Server ──────────────────────────────────────────────────────

  server: {
    /** HTTP and WebSocket listener port. */
    port: envInt("PORT", 3000, { min: 1, max: 65535 }),
    /**
     * Register destructive endpoints used for test isolation.
     * NODE_ENV=test is checked separately at the registration site so this
     * flag cannot expose them in production by itself.
     */
    enableTestEndpoints: envBool("ENABLE_TEST_ENDPOINTS", false),
    /** CSP frame-ancestors: origins allowed to embed UnoSim in an iframe */
    allowedFrameAncestors: envList(
      "SIMULATOR_ALLOWED_PARENT_ORIGINS",
      envList("ALLOW_EMBED_ORIGINS", [
        "'self'",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]),
    ),
    /** Exact browser origins allowed to open the simulation WebSocket. */
    allowedWebSocketOrigins: envList(
      "UNOSIM_ALLOWED_WS_ORIGINS",
      trust.mode === "local" ? localWebSocketOrigins : [],
    ),
    /** Completely bypass rate limiting (for E2E tests) */
    disableRateLimit: envBool("DISABLE_RATE_LIMIT", false),
  },

  // ── Sandbox Pool ────────────────────────────────────────────────

  sandbox: {
    pool: {
      /** Warm containers kept ready for instant allocation */
      minRunners: poolMinRunners,
      /** Hard upper bound on concurrent sandbox containers.
       *  Defaults to minRunners when SANDBOX_POOL_MAX_RUNNERS is not set (dev).
       *  docker-compose.yml sets this to 100 for production. */
      maxRunners: poolMaxRunners,
      /** Idle containers are destroyed after this duration */
      idleTimeoutMs: envInt("SANDBOX_POOL_IDLE_TIMEOUT_MS", 120_000, { min: 1, max: 86_400_000 }),
      /** Max time to wait for a runner before rejecting */
      acquireTimeoutMs: 60_000,
      /** Max time to wait while resetting a released runner */
      resetTimeoutMs: 10_000,
      /** Max queued acquire requests before rejecting immediately */
      maxQueueSize: 500,
    },

    // ── Per-Container Resource Limits ───────────────────────────

    resources: {
      /**
       * Docker --memory (and --memory-swap) limit in MB applied to every sandbox
       * container.  Two very different phases share this budget:
       *
       *   • Compile phase  g++/cc1plus needs 150–300 MB per invocation.
       *     Linux cgroup v2 (GitHub Actions / production) hard-kills the process
       *     the moment it exceeds the limit → must be ≥ 256 MB.
       *
       *   • Runtime phase  The pre-compiled AVR sketch typically uses < 30 MB.
       *     A tighter limit (e.g. 64 MB) would be safe here, but since compile
       *     and run happen in the same container, the compile-phase floor wins.
       *
       * Override with SANDBOX_MEMORY_MB.  docker-compose.yml mirrors this value
       * explicitly so all environments stay in sync.
       */
      memoryMB: envInt("SANDBOX_MEMORY_MB", 256, { min: 64, max: 65_536 }),
      /** Docker --cpus flag. 0.25 = 25% of one core. */
      cpuLimit: envFloat("SANDBOX_CPU_LIMIT", "0.25"),
      /** Max PIDs per container (prevents fork bombs) */
      pidsLimit: 50,
      /** Kill container after this many seconds */
      maxExecutionTimeSec: 60,
      /** Kill container if stdout/stderr exceeds this (bytes) */
      maxOutputBytes: 100 * 1024 * 1024,
    },

    /** Docker image used for sandbox containers */
    dockerImage: envStr("DOCKER_SANDBOX_IMAGE", "unosim-sandbox:latest"),
    /** Docker daemon socket */
    dockerHost: envStr("DOCKER_HOST", "unix:///var/run/docker.sock"),
  },

  // ── Compilation ─────────────────────────────────────────────────

  compilation: {
    /** Number of parallel compilation worker threads */
    workerCount: envInt("WORKER_COUNT", defaultWorkers, { min: 1, max: 256 }),
    /** Max simultaneous g++ processes inside Docker containers */
    dockerCompileConcurrent: envInt("DOCKER_COMPILE_CONCURRENT", 8, { min: 1, max: 256 }),
    /** Max simultaneous compile operations (gatekeeper) */
    maxConcurrent: envInt(
      "COMPILE_MAX_CONCURRENT",
      defaultCompileMaxConcurrent,
      { min: 1, max: 256 },
    ),
    /** Compilation timeout (ms) */
    timeoutMs: 60_000,
    /** Arduino Fully Qualified Board Name */
    fqbn: envStr("ARDUINO_FQBN", "arduino:avr:uno"),
    /** Arduino CLI core/library cache directory */
    cacheDir: envStr(
      "ARDUINO_CACHE_DIR",
      path.join(cwd, "server/arduino-cache"),
    ),
    /** Build artifact cache directory */
    buildCacheDir: envStr("BUILD_CACHE_DIR", path.join(cwd, "storage/cache")),
    /** LRU eviction trigger for build cache (bytes) */
    buildCacheMaxBytes: envInt("BUILD_CACHE_MAX_BYTES", 2 * 1024 * 1024 * 1024, { min: 1, max: Number.MAX_SAFE_INTEGER }),
    /** Max entries kept in the compile result cache */
    resultCacheMaxEntries: 100,
    /** Time-to-live for compile result cache entries */
    resultCacheTtlMs: 5 * 60 * 1000,
    /** Max queued compile requests in the unified gatekeeper */
    gatekeeperMaxQueueSize: 500,
    /** Bypass gatekeeper in E2E tests */
    disableGatekeeper: envBool("DISABLE_COMPILE_GATEKEEPER", false),
  },

  // ── Scattered Timeouts (centralized) ────────────────────────────

  timeouts: {
    /** Max time to wait for a compile slot from the gatekeeper */
    compileGatekeeperAcquireMs: 30_000,
    /** Unified gatekeeper distributed-lock TTL */
    gatekeeperLockTTLMs: 60_000,
    /** Interval for the gatekeeper to scan for expired locks */
    gatekeeperLockCheckIntervalMs: 5_000,
    /** Default timeout for generic process execution */
    processExecutionDefaultMs: 20_000,
    /** Default registry collection wait-mode duration */
    registryWaitModeDefaultMs: 1_500,
    /** Registry wait-mode duration applied after sketch start */
    registryWaitModeAfterStartMs: 5_000,
    /** Default tick interval for stream batchers (pin/serial) */
    batcherTickIntervalMs: 50,
  },

  // ── Client Polling (served via GET /api/config) ─────────────────

  client: {
    /** /api/health ping interval */
    healthPollIntervalMs: 15_000,
    /** /api/status fetch interval */
    statusPollIntervalMs: 60_000,
    /** Suppress error toasts during startup */
    startupGraceMs: 5_000,
    /** Abort health/status fetch after this */
    fetchTimeoutMs: 2_000,
  },
};

/** Subset of config safe to expose to the browser via GET /api/config */
export function getClientConfig() {
  return {
    ...config.client,
    serverMode: config.serverMode,
    simulationMode: config.simulationMode,
  };
}

export type UnoSimConfig = typeof config;

/** Read the compile limit for components that support runtime test overrides. */
export function getCompileMaxConcurrent(): number {
  return parseEnvInt("COMPILE_MAX_CONCURRENT", process.env.COMPILE_MAX_CONCURRENT, config.compilation.maxConcurrent, { min: 1, max: 256 });
}
