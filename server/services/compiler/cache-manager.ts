import { readFile, writeFile, rename, mkdir, readdir, stat, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@shared/logger";

const logger = new Logger("CacheManager");

export interface CacheHitResult {
  cached: boolean;
  binary: Buffer | null;
  cacheType: "instant" | "hex" | "none";
  cachedOutput: string | null;
}

export interface CachePaths {
  binaryStorageDir: string;
  hexCacheDir: string;
}

/**
 * Reads binary from storage (tries .hex and .elf extensions).
 * Updates access time on hit.
 */
export async function readBinaryFromStorage(
  sketchHash: string,
  storageDir: string,
): Promise<Buffer | null> {
  const hexPath = join(storageDir, `${sketchHash}.hex`);
  const elfPath = join(storageDir, `${sketchHash}.elf`);
  for (const path of [hexPath, elfPath]) {
    try {
      const binary = await readFile(path);
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      return binary;
    } catch {
      // continue probing next extension
    }
  }
  return null;
}

/**
 * Writes binary to storage using atomic rename pattern.
 */
export async function writeBinaryToStorage(
  sketchHash: string,
  binary: Buffer,
  storageDir: string,
): Promise<void> {
  const targetPath = join(storageDir, `${sketchHash}.hex`);
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(storageDir, { recursive: true });
  await writeFile(tmpPath, binary);
  await rename(tmpPath, targetPath);
}

/**
 * Writes output text to cache.
 */
export async function writeOutputToCache(
  storageDir: string,
  sketchHash: string,
  output: string,
): Promise<void> {
  const outputPath = join(storageDir, `${sketchHash}.output.txt`);
  await writeFile(outputPath, output, "utf8");
}

/**
 * Reads output text from cache.
 */
export async function readOutputFromCache(
  storageDir: string,
  sketchHash: string,
): Promise<string | null> {
  const outputPath = join(storageDir, `${sketchHash}.output.txt`);
  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Reads HEX binary from cache.
 * Updates access time on hit.
 */
export async function readHexFromCache(
  sketchHash: string,
  hexCacheDir: string,
): Promise<Buffer | null> {
  const cachePath = join(hexCacheDir, `${sketchHash}.hex`);
  try {
    const binary = await readFile(cachePath);
    const now = new Date();
    await utimes(cachePath, now, now).catch(() => undefined);
    return binary;
  } catch {
    return null;
  }
}

/**
 * Writes HEX binary to cache using atomic rename pattern.
 */
export async function writeHexToCache(
  sketchHash: string,
  hexCacheDir: string,
  binary: Buffer,
): Promise<void> {
  const cachePath = join(hexCacheDir, `${sketchHash}.hex`);
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(hexCacheDir, { recursive: true });
  await writeFile(tmpPath, binary);
  await rename(tmpPath, cachePath);
}

/**
 * LRU-style cleanup of hex cache to stay under maxBytes.
 */
export async function runHexCacheCleanup(
  hexCacheDir: string,
  maxBytes: number = 512 * 1024 * 1024,
): Promise<void> {
  try {
    const entries = await readdir(hexCacheDir);
    const files: Array<{ path: string; size: number; atimeMs: number }> = [];
    let totalSize = 0;

    for (const entry of entries) {
      if (!entry.endsWith(".hex")) continue;
      const fullPath = join(hexCacheDir, entry);
      try {
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) continue;
        totalSize += fileStat.size;
        files.push({
          path: fullPath,
          size: fileStat.size,
          atimeMs: fileStat.atimeMs || fileStat.mtimeMs,
        });
      } catch {
        // ignore disappearing files
      }
    }

    if (totalSize <= maxBytes) return;

    files.sort((a, b) => a.atimeMs - b.atimeMs);
    for (const file of files) {
      if (totalSize <= maxBytes) break;
      await rm(file.path, { force: true });
      totalSize -= file.size;
    }
  } catch (error) {
    logger.debug(`[CacheCleanup] skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Checks both instant binary cache and hex cache for a compiled sketch.
 * Returns cache hit info including output sidecar.
 */
export async function checkCacheHits(
  sketchHash: string,
  paths: CachePaths,
  compileStartedAt: bigint,
): Promise<CacheHitResult> {
  // Check instant binary cache first (most recent)
  const instantBinary = await readBinaryFromStorage(sketchHash, paths.binaryStorageDir);
  if (instantBinary) {
    const elapsedMs = Number((process.hrtime.bigint() - compileStartedAt) / BigInt(1_000_000));
    logger.info(`[Cache] Hit for hash ${sketchHash} (${elapsedMs}ms)`);
    const cachedOutput = await readOutputFromCache(paths.binaryStorageDir, sketchHash);
    return { cached: true, binary: instantBinary, cacheType: "instant", cachedOutput };
  }

  // Check hex cache (persistent, shared across sessions)
  const cachedBinary = await readHexFromCache(sketchHash, paths.hexCacheDir);
  if (cachedBinary) {
    const elapsedMs = Number((process.hrtime.bigint() - compileStartedAt) / BigInt(1_000_000));
    logger.info(`[Cache] Hit for hash ${sketchHash} (${elapsedMs}ms)`);
    const cachedOutput = await readOutputFromCache(paths.hexCacheDir, sketchHash);
    return { cached: true, binary: cachedBinary, cacheType: "hex", cachedOutput };
  }

  return { cached: false, binary: null, cacheType: "none", cachedOutput: null };
}
