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

import { parentPort } from "worker_threads";
import { workerData } from "worker_threads";
import { Logger } from "@shared/logger";
import { getFastTmpBaseDir } from "@shared/utils/temp-paths";
import {
  type CompileRequestPayload,
  type AnyWorkerMessage,
  createCompileResponse,
  createReadyMessage,
  createWorkerError,
  isCompileRequest,
} from "@shared/worker-protocol";
import { createHash } from "crypto";
import { mkdir, open, readdir, rm, stat, unlink, utimes, writeFile } from "fs/promises";
import { join } from "path";

// Disable the CompileGatekeeper in worker threads since the pool controls concurrency
process.env.COMPILE_GATEKEEPER_DISABLED = "true";

const logger = new Logger("compile-worker");
const BUILD_CACHE_DIR = process.env.BUILD_CACHE_DIR || "/tmp/unowebsim/cache";
const HEX_CACHE_DIR = join(BUILD_CACHE_DIR, "hex-cache");
const CORE_CACHE_DIR = join(process.cwd(), "storage", "core-cache");
const CORE_CACHE_BUILD_PATH = join(CORE_CACHE_DIR, "build-cache");
const CORE_CACHE_LOCK_DIR = join(CORE_CACHE_DIR, "locks");
const CORE_CACHE_META_DIR = join(CORE_CACHE_DIR, "meta");
const CORE_METADATA_TTL_MS = 5 * 60 * 1000;
const resolvedWorkerId = Number(workerData?.workerId || 1);
const WORKER_BUILD_DIR = join(getFastTmpBaseDir(), "unowebsim-worker-build", `worker_${resolvedWorkerId}`);
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
    } catch (jsErr) {
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
  await mkdir(WORKER_BUILD_DIR, { recursive: true });
  await mkdir(HEX_CACHE_DIR, { recursive: true });
  await mkdir(CORE_CACHE_DIR, { recursive: true });
  await mkdir(CORE_CACHE_BUILD_PATH, { recursive: true });
  await mkdir(CORE_CACHE_LOCK_DIR, { recursive: true });
  await mkdir(CORE_CACHE_META_DIR, { recursive: true });
  workerDirsReady = true;
}

async function execArduinoCliJson(args: string[]): Promise<any | null> {
  const { spawn } = await import("child_process");

  return new Promise((resolve) => {
    const proc = spawn("arduino-cli", args);
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        logger.debug(`[Worker] arduino-cli ${args.join(" ")} failed: ${stderr.trim()}`);
        resolve(null);
        return;
      }

      try {
        resolve(stdout ? JSON.parse(stdout) : null);
      } catch {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));
  });
}

function normalizeLibraries(libraries?: string[]): string[] {
  return (libraries || [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
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

function buildSketchHash(task: CompileRequestPayload, fqbn: string): string {
  const payload = JSON.stringify({
    code: task.code,
    fqbn,
  });
  return createHash("sha256").update(payload).digest("hex");
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

async function acquireCoreCacheLock(lockPath: string, timeoutMs: number = 120000): Promise<{ acquired: boolean; waitedMs: number }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const fd = await open(lockPath, "wx");
      await fd.writeFile(`${process.pid}:${resolvedWorkerId}:${new Date().toISOString()}`);
      await fd.close();
      return { acquired: true, waitedMs: Date.now() - start };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return { acquired: false, waitedMs: Date.now() - start };
}

async function cleanupCacheLru(): Promise<void> {
  const markerPath = join(BUILD_CACHE_DIR, ".cleanup-marker");
  const now = Date.now();
  try {
    const markerStat = await stat(markerPath);
    if (now - markerStat.mtimeMs < 60_000) {
      return;
    }
  } catch {
    // continue cleanup if marker doesn't exist
  }

  const maxBytes = Number(process.env.BUILD_CACHE_MAX_BYTES || 2 * 1024 * 1024 * 1024);
  const targets = [HEX_CACHE_DIR, CORE_CACHE_BUILD_PATH];

  for (const targetDir of targets) {
    try {
      await mkdir(targetDir, { recursive: true });
      const entries = await readdir(targetDir);
      const records: Array<{ fullPath: string; size: number; atimeMs: number }> = [];
      let totalSize = 0;

      for (const entry of entries) {
        const fullPath = join(targetDir, entry);
        try {
          const entryStat = await stat(fullPath);
          const atimeMs = entryStat.atimeMs || entryStat.mtimeMs;
          let size = entryStat.size;

          if (entryStat.isDirectory()) {
            const nested = await readdir(fullPath);
            size = 0;
            for (const nestedEntry of nested) {
              const nestedStat = await stat(join(fullPath, nestedEntry));
              size += nestedStat.size;
            }
          }

          totalSize += size;
          records.push({ fullPath, size, atimeMs });
        } catch {
          // ignore races with concurrent delete
        }
      }

      if (totalSize > maxBytes) {
        records.sort((a, b) => a.atimeMs - b.atimeMs);
        for (const record of records) {
          if (totalSize <= maxBytes) break;
          await rm(record.fullPath, { recursive: true, force: true });
          totalSize -= record.size;
        }
      }
    } catch (error) {
      logger.debug(`[Worker] Cache cleanup skipped for ${targetDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await writeFile(markerPath, String(now));
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
    
    // Check for binary existence asynchronously
    let hasInstantBinary = false;
    try {
      await stat(join(BINARY_STORAGE_DIR, `${sketchHash}.hex`));
      hasInstantBinary = true;
    } catch {
      try {
        await stat(join(BINARY_STORAGE_DIR, `${sketchHash}.elf`));
        hasInstantBinary = true;
      } catch {
        hasInstantBinary = false;
      }
    }

    // Check core cache status asynchronously
    let coreCacheWarm = false;
    try {
      await stat(coreReadyMarker);
      coreCacheWarm = true;
    } catch {
      coreCacheWarm = false;
    }
    
    let lockExists = false;
    try {
      await stat(coreLockPath);
      lockExists = true;
    } catch {
      lockExists = false;
    }
    if (lockExists) {
      logger.info(`[Worker ${resolvedWorkerId}] Core cache lock exists for ${coreFingerprint.slice(0, 12)}. Waiting...`);
    }

    let acquiredCoreLock = false;
    let activeBuildCachePath = CORE_CACHE_BUILD_PATH;

    if (!coreCacheWarm) {
      const lockResult = await acquireCoreCacheLock(coreLockPath, 120000);
      acquiredCoreLock = lockResult.acquired;

      if (!acquiredCoreLock) {
        activeBuildCachePath = join(WORKER_BUILD_DIR, "ephemeral-core-cache", coreFingerprint, String(Date.now()));
        await mkdir(activeBuildCachePath, { recursive: true });
        logger.warn(`[Worker ${resolvedWorkerId}] Core cache lock timeout. Compiling without shared cache write.`);
      }

      // Recheck cache warmth after lock attempt
      try {
        await stat(coreReadyMarker);
        coreCacheWarm = true;
      } catch {
        coreCacheWarm = false;
      }
    }

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
        // Mark core cache as ready
        try {
          await stat(coreReadyMarker);
        } catch {
          // File doesn't exist, create it
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

      await cleanupCacheLru();
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
