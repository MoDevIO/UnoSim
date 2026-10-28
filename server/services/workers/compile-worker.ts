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
import { safeErrorLogMetadata } from "../safe-error-log-metadata.ts";
import { workerBuildRoot } from "../temp-artifact-sweep.ts";
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
  buildCacheEvictionTargets,
  cleanupCacheLru,
  ensureDirectories,
  libraryIdentity,
  normalizeLibraries,
} from "./compile-worker-utils.ts";

// Disable the compile gatekeeper in worker threads since the pool controls concurrency
process.env.COMPILE_GATEKEEPER_DISABLED = "true";

const logger = new Logger("compile-worker");
type WorkerCompilationConfig = {
  buildCacheDir: string;
  buildCacheMaxBytes: number;
  fqbn: string;
};

const compilationConfig = workerData?.compilation as WorkerCompilationConfig | undefined;
if (!compilationConfig) {
  throw new Error("Compilation worker requires central compilation configuration");
}
const { buildCacheDir, buildCacheMaxBytes, fqbn: defaultFqbn } = compilationConfig;
const BUILD_CACHE_DIR = buildCacheDir;
const HEX_CACHE_DIR = join(BUILD_CACHE_DIR, "hex-cache");
const CORE_CACHE_DIR = join(process.cwd(), "storage", "core-cache");
const CORE_CACHE_BUILD_PATH = join(CORE_CACHE_DIR, "build-cache");
const CORE_CACHE_LOCK_DIR = join(CORE_CACHE_DIR, "locks");
const CORE_CACHE_META_DIR = join(CORE_CACHE_DIR, "meta");
const resolvedWorkerId = Number(workerData?.workerId || 1);
// Safe usage of writable temp directory: worker-specific isolation by concurrent worker_${workerId},
// and all files are temporary build artifacts with automatic cleanup after compilation.
const WORKER_BUILD_DIR = join(workerBuildRoot(), `worker_${resolvedWorkerId}`);
const BINARY_STORAGE_DIR = join(process.cwd(), "storage", "binaries");

// Dynamic import of ArduinoCompiler (ESM-aware)
let ArduinoCompiler: any = null;
let compilerSingleton: any = null;
let readToolchainInfo: (() => Promise<{ arduinoCli: string; librariesFingerprint: string }>) | null = null;
let workerDirsReady = false;

async function initializeCompiler() {
  try {
    // Try .js first (production build), fallback to .ts (development with tsx)
    let module;
    let toolchainInfo;
    try {
      module = await import("../arduino-compiler.js");
      toolchainInfo = await import("../compiler/toolchain-info.js");
    } catch {
      // In development mode with tsx, import the .ts file directly
      module = await import("../arduino-compiler.ts");
      toolchainInfo = await import("../compiler/toolchain-info.ts");
    }
    ArduinoCompiler = module.ArduinoCompiler;
    readToolchainInfo = toolchainInfo.readToolchainInfo;
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

/** Same toolchain (backend or compile sandbox) and versions as the build identity (plan E15). */
async function buildCoreFingerprint(task: CompileRequestPayload, fqbn: string): Promise<string> {
  if (!readToolchainInfo) throw new Error("Toolchain information is not loaded");
  const toolchain = await readToolchainInfo();
  const explicitLibraries = normalizeLibraries(task.libraries?.map(libraryIdentity)).join("|");
  const payload = `${fqbn}|${toolchain.arduinoCli}|${toolchain.librariesFingerprint}|${explicitLibraries}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function cleanupCacheLruLocal(): Promise<void> {
  await cleanupCacheLru(BUILD_CACHE_DIR, buildCacheEvictionTargets(BUILD_CACHE_DIR, HEX_CACHE_DIR, CORE_CACHE_BUILD_PATH), buildCacheMaxBytes);
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
    const fqbn = task.fqbn || defaultFqbn;
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
        entryFile: task.entryFile,
        ...(task.board ? { board: task.board } : {}),
        fqbn,
        ...(task.libraries && task.libraries.length > 0 ? { libraries: task.libraries } : {}),
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
    logger.error(`[Worker] Compilation failed (${safeErrorLogMetadata(err)})`);
    throw err;
  }
}

/**
 * Main message handler with strict type safety
 */
if (parentPort) {
  const port = parentPort;
  port.on("message", async (msg: AnyWorkerMessage) => {
    try {
      if (isCompileRequest(msg)) {
        const result = await processCompileRequest(msg.payload);
        port.postMessage(
          createCompileResponse({
            result,
          })
        );
      }
    } catch (err) {
      port.postMessage(
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
