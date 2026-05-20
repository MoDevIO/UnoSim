/**
 * Compilation Worker Thread
 * 
 * This worker thread receives Arduino sketch code and compiles it
 * synchronously without blocking the main thread.
 * 
 * Communication:
 * - Receives: { type: "compile", task: { code, headers?, tempRoot? } }
 * - Sends: { type: "ready" } (startup) or { result: CompilationResult | error: string } (completion)
 * 
 * IMPORTANT: This worker runs in a separate thread. The worker pool controls
 * concurrency, so we disable the per-compiler gatekeeper here.
 */

import { parentPort, workerData } from "node:worker_threads";
import { Logger } from "../../../shared/logger.ts";
import { getFastTmpBaseDir } from "../../../shared/utils/temp-paths.ts";
import {
  type CompileRequestPayload,
  type AnyWorkerMessage,
  createCompileResponse,
  createReadyMessage,
  createWorkerError,
  isCompileRequest,
} from "../../../shared/worker-protocol.ts";
import { mkdir, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  acquireCoreCacheLock,
  buildSketchHash,
  checkBinaryExists,
  checkFileExists,
  cleanupCacheLru,
  ensureDirectories,
  execArduinoCliJson,
  normalizeLibraries,
} from "./compile-worker-utils.ts";

// Disable the compile gatekeeper in worker threads since the pool controls concurrency
process.env.COMPILE_GATEKEEPER_DISABLED = "true";

const logger = new Logger("compile-worker");
const BUILD_CACHE_DIR = process.env.BUILD_CACHE_DIR || join(process.cwd(), "storage", "cache");
const HEX_CACHE_DIR = join(BUILD_CACHE_DIR, "hex-cache");
const CORE_CACHE_DIR = join(process.cwd(), "storage", "core-cache");
const CORE_CACHE_BUILD_PATH = join(CORE_CACHE_DIR, "build-cache");
const CORE_CACHE_LOCK_DIR = join(CORE_CACHE_DIR, "locks");
const CORE_CACHE_META_DIR = join(CORE_CACHE_DIR, "meta");
const CORE_METADATA_TTL_MS = 5 * 60 * 1000;
const resolvedWorkerId = Number(workerData?.workerId || 1);
// Safe usage of writable temp directory: worker-specific isolation by concurrent worker_${workerId},
// and all files are temporary build artifacts with automatic cleanup after compilation.
const WORKER_BUILD_DIR = join(getFastTmpBaseDir(), "unosim-worker-build", `worker_${resolvedWorkerId}`);
const BINARY_STORAGE_DIR = join(process.cwd(), "storage", "binaries");

let cachedLibFingerprint: { value: string; expiresAt: number } | null = null;
let cachedCompilerVersion: { value: string; expiresAt: number } | null = null;

// Dynamic import of ArduinoCompiler (ESM-aware)
let ArduinoCompiler: any = null;
let compilerSingleton: any = null;
let workerDirsReady = false;

async function initializeCompiler() {
  try {
    // Try .js first (production build), fallback to .ts (development with tsx)
    let module;
    try {
      module = await import("../arduino-compiler.js");
    } catch {
      // In development mode with tsx, import the .ts file directly
      module = await import("../arduino-compiler.ts");
    }
    ArduinoCompiler = module.ArduinoCompiler;
    if (!compilerSingleton) {
      compilerSingleton = new ArduinoCompiler();
    }
    logger.debug("[Worker] ArduinoCompiler loaded");
  } catch (err) {
    logger.error(`[Worker] Failed to load ArduinoCompiler: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function ensureWorkerDirs(): Promise<void> {
  if (workerDirsReady) return;
  await ensureDirectories([
    WORKER_BUILD_DIR,
    join(WORKER_BUILD_DIR, "build-output"),
    HEX_CACHE_DIR,
    CORE_CACHE_DIR,
    CORE_CACHE_BUILD_PATH,
    CORE_CACHE_LOCK_DIR,
    CORE_CACHE_META_DIR,
  ]);
  workerDirsReady = true;
}

async function getInstalledLibrariesFingerprint(): Promise<string> {
  const now = Date.now();
  if (cachedLibFingerprint && cachedLibFingerprint.expiresAt > now) {
    return cachedLibFingerprint.value;
  }

  if (process.env.NODE_ENV === "test") {
    return "test-libraries";
  }

  const libList = await execArduinoCliJson(["lib", "list", "--format", "json"]);
  if (!Array.isArray(libList)) {
    const fallback = "unknown-libraries";
    cachedLibFingerprint = { value: fallback, expiresAt: now + CORE_METADATA_TTL_MS };
    return fallback;
  }

  const normalized = libList
    .map((lib: any) => `${lib.name || "unknown"}@${lib.version || "unknown"}`)
    .sort((a: string, b: string) => a.localeCompare(b))
    .join("|");

  const value = createHash("sha256").update(normalized).digest("hex");
  cachedLibFingerprint = { value, expiresAt: now + CORE_METADATA_TTL_MS };
  return value;
}

async function getCompilerVersion(): Promise<string> {
  const now = Date.now();
  if (cachedCompilerVersion && cachedCompilerVersion.expiresAt > now) {
    return cachedCompilerVersion.value;
  }

  if (process.env.NODE_ENV === "test") {
    return "test-compiler";
  }

  const versionJson = await execArduinoCliJson(["version", "--format", "json"]);
  const value =
    versionJson?.version_string ||
    versionJson?.versionString ||
    versionJson?.VersionString ||
    versionJson?.version ||
    "unknown-compiler";

  cachedCompilerVersion = { value, expiresAt: now + CORE_METADATA_TTL_MS };
  return value;
}

async function buildCoreFingerprint(task: CompileRequestPayload, fqbn: string): Promise<string> {
  const [compilerVersion, installedLibFingerprint] = await Promise.all([
    getCompilerVersion(),
    getInstalledLibrariesFingerprint(),
  ]);

  const explicitLibraries = normalizeLibraries(task.libraries).join("|");
  const payload = `${fqbn}|${compilerVersion}|${installedLibFingerprint}|${explicitLibraries}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function cleanupCacheLruLocal(): Promise<void> {
  await cleanupCacheLru(BUILD_CACHE_DIR, [HEX_CACHE_DIR, CORE_CACHE_BUILD_PATH]);
}

async function acquireCoreCache(coreReadyMarker: string, coreLockPath: string, coreFingerprint: string): Promise<{ coreCacheWarm: boolean; acquiredCoreLock: boolean; activeBuildCachePath: string }> {
  let coreCacheWarm = await checkFileExists(coreReadyMarker);
  let acquiredCoreLock = false;
  let activeBuildCachePath = CORE_CACHE_BUILD_PATH;

  if (await checkFileExists(coreLockPath)) {
    logger.info(`[Worker ${resolvedWorkerId}] Core cache lock exists for ${coreFingerprint.slice(0, 12)}. Waiting...`);
  }

  if (!coreCacheWarm) {
    const lockResult = await acquireCoreCacheLock(coreLockPath, 120000);
    acquiredCoreLock = lockResult.acquired;

    if (!acquiredCoreLock) {
      activeBuildCachePath = join(WORKER_BUILD_DIR, "ephemeral-core-cache", coreFingerprint, String(Date.now()));
      await mkdir(activeBuildCachePath, { recursive: true });
      logger.warn(`[Worker ${resolvedWorkerId}] Core cache lock timeout. Compiling without shared cache write.`);
    }

    coreCacheWarm = await checkFileExists(coreReadyMarker);
  }

  return { coreCacheWarm, acquiredCoreLock, activeBuildCachePath };
}

/**
 * Process incoming compilation requests with strict typing
 */
async function processCompileRequest(task: CompileRequestPayload) {
  try {
    if (!ArduinoCompiler || !compilerSingleton) {
      await initializeCompiler();
    }

    const compiler = compilerSingleton;
    await ensureWorkerDirs();

    const requestStartedAt = process.hrtime.bigint();
    const fqbn = task.fqbn || process.env.ARDUINO_FQBN || "arduino:avr:uno";
    const sketchHash = task.sketchHash || buildSketchHash(task, fqbn);
    const coreFingerprint = task.coreFingerprint || (await buildCoreFingerprint(task, fqbn));
    const coreReadyMarker = join(CORE_CACHE_META_DIR, `${coreFingerprint}.ready`);
    const coreLockPath = join(CORE_CACHE_LOCK_DIR, `${coreFingerprint}.lock`);
    const sketchBuildPath = join(WORKER_BUILD_DIR, "build-output", sketchHash);

    const hasInstantBinary = await checkBinaryExists(BINARY_STORAGE_DIR, sketchHash);
    const { coreCacheWarm, acquiredCoreLock, activeBuildCachePath } = await acquireCoreCache(coreReadyMarker, coreLockPath, coreFingerprint);

    if (hasInstantBinary) {
      logger.info(`[Cache] Hit for hash ${sketchHash}`);
    } else {
      logger.info(`[Worker ${resolvedWorkerId}] Starting fresh compile`);
    }

    await mkdir(sketchBuildPath, { recursive: true });
    const compileStartedAt = process.hrtime.bigint();

    try {
      const compileResult = await compiler.compile(task.code, task.headers, WORKER_BUILD_DIR, {
        fqbn,
        libraries: normalizeLibraries(task.libraries),
        sketchHash,
        coreFingerprint,
        buildPath: sketchBuildPath,
        buildCachePath: activeBuildCachePath,
        hexCacheDir: HEX_CACHE_DIR,
      });

      if (compileResult.success && acquiredCoreLock) {
        const markerExists = await checkFileExists(coreReadyMarker);
        if (!markerExists) {
          await writeFile(coreReadyMarker, new Date().toISOString());
        }
      }

      if (compileResult.success && compileResult.binary) {
        const now = new Date();
        const hexPath = join(HEX_CACHE_DIR, `${sketchHash}.hex`);
        await utimes(hexPath, now, now).catch(() => undefined);
      }

      const elapsedMs = Number((process.hrtime.bigint() - requestStartedAt) / BigInt(1_000_000));
      const linkElapsedMs = Number((process.hrtime.bigint() - compileStartedAt) / BigInt(1_000_000));
      if (coreCacheWarm) {
        logger.info(`[Worker ${resolvedWorkerId}] Core-Cache Hit. Linking sketch in ${linkElapsedMs}ms.`);
      } else {
        logger.info(`[Worker ${resolvedWorkerId}] Core-Cache Miss. Full compile in ${elapsedMs}ms.`);
      }

      await cleanupCacheLruLocal();
      return compileResult;
    } finally {
      if (acquiredCoreLock) {
        await unlink(coreLockPath).catch(() => undefined);
      }
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Worker] Compilation failed: ${errorMsg}`);
    throw err;
  }
}

/**
 * Main message handler with strict type safety
 */
if (parentPort) {
  parentPort.on("message", async (msg: AnyWorkerMessage) => {
    try {
      if (isCompileRequest(msg)) {
        const result = await processCompileRequest(msg.payload);
        parentPort!.postMessage(
          createCompileResponse({
            result,
          })
        );
      }
    } catch (err) {
      parentPort!.postMessage(
        createCompileResponse({
          error: createWorkerError(err),
        })
      );
    }
  });

  // Signal that worker is ready
  parentPort.postMessage(createReadyMessage());
  logger.debug("[Worker] Startup complete, waiting for tasks");
} else {
  logger.error("[Worker] Not running in worker_threads context");
  process.exit(1);
}
