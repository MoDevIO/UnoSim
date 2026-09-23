/**
 * Central UnoSim Configuration
 *
 * Single source of truth for all server-side tunable parameters.
 * Values are read from environment variables with sensible defaults.
 * Import this module instead of reading process.env directly.
 *
 * One profile controls the complete runtime topology:
 *   • "local":  server and simulations run on the development host
 *   • "docker": server runs in Docker and simulations use Docker sandboxes
 */
import os from "node:os";
import path from "node:path";
import { parseTrustConfig } from "./security/access-control";
import { examplesRefSchema } from "@shared/examples";
import { TEST_RUN_ID_PATTERN } from "@shared/input-limits";
import { normalizeRepositoryInput } from "./services/examples/source-selection";

// ── Mode Types ──────────────────────────────────────────────────────

/** Where the UnoSim server itself runs */
export type ServerMode = "local" | "docker";

export interface RuntimeProfile {
  nodeEnv: string;
  serverMode: ServerMode;
  dockerTestBypassGateway: boolean;
}

const removedRuntimeVariables = [
  "UNOSIM_SIMULATION_MODE",
  "UNOSIM_TRUST_MODE",
  "FORCE_DOCKER",
  "UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL",
  "SANDBOX_POOL_MIN_RUNNERS",
  "SANDBOX_POOL_MAX_RUNNERS",
  "DOCKER_COMPILE_CONCURRENT",
] as const;

function rejectRemovedRuntimeVariables(env: NodeJS.ProcessEnv): void {
  for (const key of removedRuntimeVariables) {
    if (env[key] !== undefined) {
      throw new Error(`${key} is no longer supported`);
    }
  }
}

function parseNodeEnvironment(env: NodeJS.ProcessEnv): string {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!(["development", "production", "test"] as const).includes(nodeEnv as "development" | "production" | "test")) {
    throw new Error(
      `Invalid NODE_ENV: expected development, production, or test, received "${nodeEnv}"`,
    );
  }
  return nodeEnv;
}

function parseServerMode(env: NodeJS.ProcessEnv, nodeEnv: string): ServerMode {
  const fallbackMode: ServerMode = nodeEnv === "production" ? "docker" : "local";
  const rawMode = env.UNOSIM_SERVER_MODE ?? fallbackMode;
  if (rawMode !== "local" && rawMode !== "docker") {
    throw new Error(
      `Invalid UNOSIM_SERVER_MODE: expected one of local, docker, received "${rawMode}"`,
    );
  }
  if (nodeEnv === "production" && rawMode !== "docker") {
    throw new Error("NODE_ENV=production requires UNOSIM_SERVER_MODE=docker");
  }
  if (nodeEnv === "development" && rawMode !== "local") {
    throw new Error("NODE_ENV=development requires UNOSIM_SERVER_MODE=local");
  }
  return rawMode;
}

function parseDockerTestBypass(
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
  serverMode: ServerMode,
): boolean {
  const rawBypass = env.UNOSIM_DOCKER_TEST_BYPASS_GATEWAY;
  if (rawBypass !== undefined && rawBypass !== "1") {
    throw new Error("UNOSIM_DOCKER_TEST_BYPASS_GATEWAY must be 1 when enabled");
  }
  const dockerTestBypassGateway = rawBypass === "1";
  if (dockerTestBypassGateway && nodeEnv !== "test") {
    throw new Error("UNOSIM_DOCKER_TEST_BYPASS_GATEWAY is allowed only with NODE_ENV=test");
  }
  if (dockerTestBypassGateway && serverMode !== "docker") {
    throw new Error("UNOSIM_DOCKER_TEST_BYPASS_GATEWAY is allowed only in docker mode");
  }
  return dockerTestBypassGateway;
}

export function parseRuntimeProfile(env: NodeJS.ProcessEnv): RuntimeProfile {
  rejectRemovedRuntimeVariables(env);
  const nodeEnv = parseNodeEnvironment(env);
  const serverMode = parseServerMode(env, nodeEnv);
  return {
    nodeEnv,
    serverMode,
    dockerTestBypassGateway: parseDockerTestBypass(env, nodeEnv, serverMode),
  };
}

export function parseCapacityTestRunId(
  value: string | undefined,
  nodeEnv: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (nodeEnv !== "test") {
    throw new Error("CAPACITY_TEST_RUN_ID is allowed only with NODE_ENV=test");
  }
  if (!TEST_RUN_ID_PATTERN.test(value)) {
    throw new Error("CAPACITY_TEST_RUN_ID must be a URL-safe test run identifier");
  }
  return value;
}

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

function stripTrailingSlashes(value: string): string {
  let result = value;
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}

export function parseListenHost(
  trustMode: "local" | "gateway",
  configuredHost: string | undefined,
): string {
  const defaultHost = trustMode === "local" ? "127.0.0.1" : "0.0.0.0";
  const host = configuredHost?.trim();
  return host || defaultHost;
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

// ── Central capacity values ─────────────────────────────────────────

const runtimeProfile = parseRuntimeProfile(process.env);
const capacityTestRunId = parseCapacityTestRunId(
  process.env.CAPACITY_TEST_RUN_ID,
  runtimeProfile.nodeEnv,
);

/** Operator-facing capacity values. A runner is a logical execution object;
 * only the sandbox-start semaphore controls Docker startup pressure. */
const simulationMaxConcurrent = envInt("SIMULATION_MAX_CONCURRENT", 5, { min: 1, max: 1000 });
const sandboxStartMaxConcurrent = envInt("SANDBOX_START_MAX_CONCURRENT", 8, { min: 1, max: 256 });
const simulationAdmissionMax = envInt("SIMULATION_ADMISSION_MAX", 25, { min: 1, max: 500 });
const simulationQueueTimeoutMs = envInt("SIMULATION_QUEUE_TIMEOUT_MS", 60_000, { min: 1_000, max: 900_000 });
const sandboxStartSlotTimeoutMs = envInt("SANDBOX_START_SLOT_TIMEOUT_MS", 30_000, { min: 1_000, max: 900_000 });

/** Logical warm-object floor. It never pre-creates Docker containers. */
const logicalWarmRunnerFloor = Math.min(5, simulationMaxConcurrent);

export function validateSimulationCapacity(
  minRunners: number,
  maxRunners: number,
  serverMode: ServerMode,
): void {
  if (minRunners > maxRunners) {
    throw new Error("Invalid simulation capacity: warm runner floor (" + minRunners + ") must not exceed simulation max (" + maxRunners + ")");
  }
  if (serverMode === "docker" && maxRunners < 1) {
    throw new Error("Docker mode requires SIMULATION_MAX_CONCURRENT to be at least 1");
  }
}
validateSimulationCapacity(logicalWarmRunnerFloor, simulationMaxConcurrent, runtimeProfile.serverMode);
const cwd = process.cwd();
const cpuCount = os.cpus().length;
const defaultWorkers = Math.min(8, Math.max(2, Math.floor(cpuCount * 0.5)));
const defaultCompileMaxConcurrent = Math.max(1, cpuCount - 1);
const trust = parseTrustConfig(process.env, runtimeProfile);
const localWebSocketOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export interface ParsedExamplesConfig {
  mode: "builtin" | "repository-ref";
  source: string;
  ref: string;
  repository: string | null;
  refreshMs: number;
  refreshRetryMs: number;
  timeoutMs: number;
  maxManifestBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  allowedHosts: string[];
  validateRateLimitMaxRequests: number;
  overrideRateLimitMaxRequests: number;
  globalLoadStartsPerMinute: number;
  maxConcurrentLoads: number;
  maxLoadQueue: number;
  maxFileFetchConcurrency: number;
  maxOutboundFetches: number;
  maxSources: number;
  snapshotCacheMaxEntries: number;
  snapshotCacheMaxBytes: number;
}

function resolveExamplesSourceConfig(env: NodeJS.ProcessEnv, nodeEnv: string): Pick<ParsedExamplesConfig, "mode" | "source" | "ref" | "repository" | "allowedHosts"> {
  const sourceInput = (env.UNOSIM_EXAMPLES_SOURCE ?? "ttbombadil/unosim-examples").trim();
  const configuredRef = (env.UNOSIM_EXAMPLES_REF ?? "").trim();
  const defaultAllowedHosts = nodeEnv === "production" ? "" : "api.github.com,raw.githubusercontent.com";
  const allowedHosts = (env.UNOSIM_EXAMPLES_ALLOWED_HOSTS ?? defaultAllowedHosts).split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (env.UNOSIM_EXAMPLES_CHANNEL !== undefined) throw new Error("UNOSIM_EXAMPLES_CHANNEL is no longer supported; configure UNOSIM_EXAMPLES_REF instead");
  if (!sourceInput && configuredRef) throw new Error("UNOSIM_EXAMPLES_SOURCE is required when UNOSIM_EXAMPLES_REF is configured");
  const repository = sourceInput ? normalizeRepositoryInput(sourceInput, { allowRawGithub: true }) : null;
  if (sourceInput && !repository) throw new Error("UNOSIM_EXAMPLES_SOURCE must be a public GitHub repository slug or repository URL");
  const ref = repository ? configuredRef || "main" : "";
  if (ref && !examplesRefSchema.safeParse(ref).success) throw new Error("UNOSIM_EXAMPLES_REF has an invalid ref syntax");
  if (repository && nodeEnv === "production" && allowedHosts.length === 0) throw new Error("UNOSIM_EXAMPLES_ALLOWED_HOSTS is required for external examples in production");
  return { mode: repository ? "repository-ref" : "builtin", source: repository ?? "", ref, repository, allowedHosts };
}

export function parseExamplesConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv = env.NODE_ENV ?? "development",
): ParsedExamplesConfig {
  const source = resolveExamplesSourceConfig(env, nodeEnv);

  const int = (key: string, fallback: number, min: number, max: number) =>
    parseEnvInt(key, env[key], fallback, { min, max });
  const refreshMs = int("UNOSIM_EXAMPLES_REFRESH_MS", 300_000, 1_000, 86_400_000);
  const maxTotalBytes = int("UNOSIM_EXAMPLES_MAX_TOTAL_BYTES", 1_048_576, 1, 100 * 1_048_576);
  const maxConcurrentLoads = int("UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS", 4, 1, 16);
  const maxFileFetchConcurrency = int("UNOSIM_EXAMPLES_MAX_FILE_FETCH_CONCURRENCY", 8, 1, 16);
  const maxOutboundFetches = int("UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES", 16, 1, 64);
  const snapshotCacheMaxBytes = int("UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES", 64 * 1_048_576, 1_048_576, 512 * 1_048_576);
  if (maxConcurrentLoads > maxOutboundFetches) {
    throw new Error("UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS must not exceed UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES");
  }
  if (maxFileFetchConcurrency > maxOutboundFetches) {
    throw new Error("UNOSIM_EXAMPLES_MAX_FILE_FETCH_CONCURRENCY must not exceed UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES");
  }
  if (snapshotCacheMaxBytes < maxTotalBytes) {
    throw new Error("UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES must cover UNOSIM_EXAMPLES_MAX_TOTAL_BYTES");
  }

  return {
    ...source,
    refreshMs,
    refreshRetryMs: int("UNOSIM_EXAMPLES_REFRESH_RETRY_MS", 30_000, 1_000, refreshMs),
    timeoutMs: int("UNOSIM_EXAMPLES_TIMEOUT_MS", 5_000, 100, 120_000),
    maxManifestBytes: int("UNOSIM_EXAMPLES_MAX_MANIFEST_BYTES", 256 * 1024, 1, 10 * 1_048_576),
    maxFileBytes: int("UNOSIM_EXAMPLES_MAX_FILE_BYTES", 128 * 1024, 1, 10 * 1_048_576),
    maxTotalBytes,
    maxFiles: int("UNOSIM_EXAMPLES_MAX_FILES", 100, 1, 10_000),
    allowedHosts: source.allowedHosts,
    validateRateLimitMaxRequests: int("UNOSIM_EXAMPLES_VALIDATE_RATE_LIMIT_MAX_REQUESTS", 5, 1, 30),
    overrideRateLimitMaxRequests: int("UNOSIM_EXAMPLES_OVERRIDE_RATE_LIMIT_MAX_REQUESTS", 60, 10, 600),
    globalLoadStartsPerMinute: int("UNOSIM_EXAMPLES_GLOBAL_LOAD_STARTS_PER_MINUTE", 20, 1, 120),
    maxConcurrentLoads,
    maxLoadQueue: int("UNOSIM_EXAMPLES_MAX_LOAD_QUEUE", 32, 0, 128),
    maxFileFetchConcurrency,
    maxOutboundFetches,
    maxSources: int("UNOSIM_EXAMPLES_MAX_SOURCES", 32, 1, 256),
    snapshotCacheMaxEntries: int("UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_ENTRIES", 64, 1, 512),
    snapshotCacheMaxBytes,
  };
}

const examplesConfig = parseExamplesConfig(process.env);

const curriculumSource = envStr("UNOSIM_TUTOR_CURRICULUM_SOURCE", "").trim();
const curriculumCommit = envStr("UNOSIM_TUTOR_CURRICULUM_COMMIT", "").trim();
const curriculumAllowedHosts = envList("UNOSIM_TUTOR_CURRICULUM_ALLOWED_HOSTS", []).map((host) => host.toLowerCase());
if (curriculumSource && !curriculumCommit) {
  throw new Error("UNOSIM_TUTOR_CURRICULUM_COMMIT is required when tutor curriculum is configured");
}
if (!curriculumSource && curriculumCommit) {
  throw new Error("UNOSIM_TUTOR_CURRICULUM_SOURCE is required when tutor curriculum commit is configured");
}
if (curriculumSource && !/^[a-f0-9]{40}$/i.test(curriculumCommit)) {
  throw new Error("UNOSIM_TUTOR_CURRICULUM_COMMIT must be a full 40-character commit SHA");
}
if (curriculumSource && process.env.NODE_ENV === "production" && curriculumAllowedHosts.length === 0) {
  throw new Error("UNOSIM_TUTOR_CURRICULUM_ALLOWED_HOSTS is required for tutor curriculum in production");
}

// ── Config ──────────────────────────────────────────────────────────

export const config = {
  /** Runtime environment name, captured once at startup. */
  nodeEnv: runtimeProfile.nodeEnv,
  /**
   * Server mode: "local" (dev) or "docker" (docker-compose).
   * Set via UNOSIM_SERVER_MODE env var; falls back to NODE_ENV detection.
   */
  serverMode: runtimeProfile.serverMode,

  /** Test-only gateway bypass for Docker integration tests. */
  dockerTestBypassGateway: runtimeProfile.dockerTestBypassGateway,

  /** Test-only identifier for capacity-run API and Docker resource attribution. */
  capacityTestRunId,

  /** True when running under a test framework */
  isTest: process.env.NODE_ENV === "test",

  /** HTTP and WebSocket authentication boundary. */
  trust,

  // ── Server ──────────────────────────────────────────────────────

  server: {
    /** HTTP and WebSocket listener port. */
    port: envInt("PORT", 3000, { min: 1, max: 65535 }),
    /** Listener host; local mode defaults to loopback, gateway mode to all interfaces. */
    listenHost: parseListenHost(trust.mode, process.env.UNOSIM_LISTEN_HOST),
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
    /** API route rate limit window */
    apiRateLimitWindowMs: 15 * 60 * 1000,
    /** API route rate limit in normal operation */
    apiRateLimitMax: 300,
    /** API route rate limit used when tests disable production throttling */
    apiRateLimitTestMax: 10_000,
    /** Dedicated compile request rate-limit window */
    compileRateLimitWindowMs: envInt("COMPILE_RATE_LIMIT_WINDOW_MS", 60_000, {
      min: 1,
      max: 86_400_000,
    }),
    /** Compile requests allowed per trusted identity and window */
    compileRateLimitMaxRequests: envInt("COMPILE_RATE_LIMIT_MAX_REQUESTS", 10, {
      min: 1,
      max: 10_000,
    }),
    /** Block duration after a trusted identity exceeds the compile limit */
    compileRateLimitBlockDurationMs: envInt(
      "COMPILE_RATE_LIMIT_BLOCK_DURATION_MS",
      10_000,
      { min: 1, max: 86_400_000 },
    ),
    /** Simulation start rate limit window */
    simulationRateLimitWindowMs: envInt(
      "SIMULATION_START_RATE_LIMIT_WINDOW_MS",
      2_000,
      { min: 1, max: 86_400_000 },
    ),
    /** Simulation starts allowed per window */
    simulationRateLimitMaxRequests: envInt(
      "SIMULATION_START_RATE_LIMIT_MAX_REQUESTS",
      1,
      { min: 1, max: 10_000 },
    ),
    /** Simulation start block duration after exceeding the limit */
    simulationRateLimitBlockDurationMs: envInt(
      "SIMULATION_START_RATE_LIMIT_BLOCK_DURATION_MS",
      5_000,
      { min: 1, max: 86_400_000 },
    ),
    /** Running plus queued simulation demands admitted by this process */
    simulationAdmissionMax,
    /** Maximum time an admitted demand may wait for a logical simulation slot */
    simulationQueueTimeoutMs,
    /** Cleanup interval for inactive simulation rate-limit entries */
    simulationRateLimitCleanupIntervalMs: 5 * 60 * 1000,
    /** Inactive simulation rate-limit entries are removed after this duration */
    simulationRateLimitInactiveTtlMs: 10 * 60 * 1000,
  },

  // ── Capacity ───────────────────────────────────────────────────

  capacity: {
    simulationMaxConcurrent,
    sandboxStartMaxConcurrent,
    admissionMax: simulationAdmissionMax,
    queueTimeoutMs: simulationQueueTimeoutMs,
    /** Maximum time an admitted simulation may wait for a sandbox-start slot */
    sandboxStartSlotTimeoutMs,
  },

  // ── Sandbox Pool ────────────────────────────────────────────────

  sandbox: {
    pool: {
      /** Logical runner objects kept ready; this does not create Docker containers. */
      minRunners: logicalWarmRunnerFloor,
      /** Maximum simultaneously active logical simulation sessions. */
      maxRunners: simulationMaxConcurrent,
      /** Idle logical runners are removed after this duration */
      idleTimeoutMs: envInt("SANDBOX_POOL_IDLE_TIMEOUT_MS", 120_000, { min: 1, max: 86_400_000 }),
      /** Queue policy for admitted demands waiting for simulation capacity */
      acquireTimeoutMs: simulationQueueTimeoutMs,
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
    /** Timeout for Docker CLI availability/control probes (not simulation runtime). */
    dockerControlTimeoutMs: envInt("DOCKER_CONTROL_TIMEOUT_MS", 2_000, { min: 100, max: 30_000 }),
  },

  // ── Compilation ─────────────────────────────────────────────────

  compilation: {
    /** Number of parallel compilation worker threads */
    workerCount: envInt("WORKER_COUNT", defaultWorkers, { min: 1, max: 256 }),

    /** Max simultaneous source-code compile operations (gatekeeper) */
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

  // ── Examples ─────────────────────────────────────────────────────

  examples: {
    ...examplesConfig,
  },

  // ── Tutor / LLM ────────────────────────────────────────────────

  tutor: {
    /** The Tutor always uses the user's personal KI:connect credential. */
    provider: "kiconnect" as const,
    /** Server-controlled OpenAI-compatible provider base URL. */
    baseUrl: stripTrailingSlashes(envStr("UNOSIM_LLM_BASE_URL", "https://chat.kiconnect.nrw/api/v1")),
    /** Provider request timeout; no provider call may outlive this window. */
    timeoutMs: envInt("UNOSIM_LLM_TIMEOUT_MS", 30_000, { min: 1_000, max: 120_000 }),
    /** Dedicated request-scoped tutor rate limit. */
    rateLimitWindowMs: envInt("TUTOR_RATE_LIMIT_WINDOW_MS", 60_000, { min: 1_000, max: 86_400_000 }),
    rateLimitMaxRequests: envInt("TUTOR_RATE_LIMIT_MAX_REQUESTS", 20, { min: 1, max: 100 }),
    rateLimitBlockDurationMs: envInt("TUTOR_RATE_LIMIT_BLOCK_DURATION_MS", 30_000, { min: 1_000, max: 86_400_000 }),
    curriculum: {
      /** Server-side HTTPS base URL for the pinned curriculum repository. */
      source: curriculumSource,
      /** Full immutable commit SHA; floating refs are not accepted. */
      commit: curriculumCommit,
      refreshMs: envInt("UNOSIM_TUTOR_CURRICULUM_REFRESH_MS", 5 * 60 * 1000, { min: 1_000, max: 86_400_000 }),
      timeoutMs: envInt("UNOSIM_TUTOR_CURRICULUM_TIMEOUT_MS", 5_000, { min: 100, max: 120_000 }),
      maxManifestBytes: envInt("UNOSIM_TUTOR_CURRICULUM_MAX_MANIFEST_BYTES", 64 * 1024, { min: 1, max: 1024 * 1024 }),
      maxTopicBytes: envInt("UNOSIM_TUTOR_CURRICULUM_MAX_TOPIC_BYTES", 256 * 1024, { min: 1, max: 4 * 1024 * 1024 }),
      maxTotalBytes: envInt("UNOSIM_TUTOR_CURRICULUM_MAX_TOTAL_BYTES", 512 * 1024, { min: 1, max: 8 * 1024 * 1024 }),
      allowedHosts: curriculumAllowedHosts,
    },
  },

  // ── Scattered Timeouts (centralized) ────────────────────────────

  timeouts: {
    /** Max time to wait for normal source compilation capacity */
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
    tutor: {
      provider: config.tutor.provider,
    },
  };
}

export type UnoSimConfig = typeof config;

/** Read the compile limit for components that support runtime test overrides. */
export function getCompileMaxConcurrent(): number {
  return parseEnvInt("COMPILE_MAX_CONCURRENT", process.env.COMPILE_MAX_CONCURRENT, config.compilation.maxConcurrent, { min: 1, max: 256 });
}
