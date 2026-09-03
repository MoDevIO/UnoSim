/**
 * Extracted utility functions from compile-worker.ts
 *
 * These pure and I/O-only helpers are separated for testability.
 * The main compile-worker.ts thread imports them at runtime.
 */

import { createHash } from "node:crypto";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Normalize and sort library names for deterministic hashing.
 */
export function normalizeLibraries(libraries?: string[]): string[] {
  return (libraries || [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Compute a SHA-256 hash of code + FQBN for sketch identity.
 */
export function buildSketchHash(task: { code: string }, fqbn: string): string {
  const payload = JSON.stringify({
    code: task.code,
    fqbn,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Check whether a file exists on disk.
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a compiled binary (.hex or .elf) exists in the given directory.
 */
export async function checkBinaryExists(
  binaryDir: string,
  sketchHash: string,
): Promise<boolean> {
  try {
    await stat(join(binaryDir, `${sketchHash}.hex`));
    return true;
  } catch {
    try {
      await stat(join(binaryDir, `${sketchHash}.elf`));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Acquire a file-based lock with polling and timeout.
 */
export async function acquireCoreCacheLock(
  lockPath: string,
  timeoutMs: number = 120000,
  pollIntervalMs: number = 50,
): Promise<{ acquired: boolean; waitedMs: number }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const fd = await open(lockPath, "wx");
      await fd.writeFile(`${process.pid}:${new Date().toISOString()}`);
      await fd.close();
      return { acquired: true, waitedMs: Date.now() - start };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { acquired: false, waitedMs: Date.now() - start };
}

/**
 * Scan a directory and collect records with size and access time.
 */
export async function collectDirectoryRecords(
  targetDir: string,
): Promise<{
  records: Array<{ fullPath: string; size: number; atimeMs: number }>;
  totalSize: number;
}> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(targetDir);
  const records: Array<{ fullPath: string; size: number; atimeMs: number }> =
    [];
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

  return { records, totalSize };
}

/**
 * Evict LRU entries from a sorted records list until total size is within budget.
 */
export async function evictLruEntries(
  records: Array<{ fullPath: string; size: number; atimeMs: number }>,
  totalSize: number,
  maxBytes: number,
): Promise<void> {
  records.sort((a, b) => a.atimeMs - b.atimeMs);
  let remaining = totalSize;
  for (const record of records) {
    if (remaining <= maxBytes) break;
    await rm(record.fullPath, { recursive: true, force: true });
    remaining -= record.size;
  }
}

/**
 * LRU cleanup of build cache directories, debounced via marker file.
 */
export async function cleanupCacheLru(
  buildCacheDir: string,
  targets: string[],
  maxBytes?: number,
): Promise<void> {
  const markerPath = join(buildCacheDir, ".cleanup-marker");
  const now = Date.now();
  try {
    const markerStat = await stat(markerPath);
    if (now - markerStat.mtimeMs < 60_000) {
      return;
    }
  } catch {
    // continue cleanup if marker doesn't exist
  }

  const effectiveMax = maxBytes ?? 2 * 1024 * 1024 * 1024;

  for (const targetDir of targets) {
    try {
      const { records, totalSize } = await collectDirectoryRecords(targetDir);
      if (totalSize > effectiveMax) {
        await evictLruEntries(records, totalSize, effectiveMax);
      }
    } catch {
      // skip directories that cannot be read
    }
  }

  await writeFile(markerPath, String(now));
}

/**
 * Create multiple directories in parallel.
 */
export async function ensureDirectories(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
}

/**
 * Spawn arduino-cli with JSON output and return parsed result.
 */
export async function execArduinoCliJson(args: string[]): Promise<any> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const proc = spawn("arduino-cli", args);
    let stdout = "";
    let _stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      _stderr += data.toString();
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
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
