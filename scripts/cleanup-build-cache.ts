import { readdir, rm, stat } from "fs/promises";
import { join } from "path";

const BUILD_CACHE_DIR = process.env.BUILD_CACHE_DIR || "/tmp/unowebsim/cache";
const STORAGE_DIR = join(process.cwd(), "storage");
const MAX_BYTES = Number(process.env.BUILD_CACHE_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_CORE_CACHE_BYTES = Number(process.env.CORE_CACHE_MAX_BYTES || 500 * 1024 * 1024);
const MAX_BINARY_STORAGE_BYTES = Number(process.env.BINARY_STORAGE_MAX_BYTES || 1 * 1024 * 1024 * 1024);

async function estimateDirectorySize(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await estimateDirectorySize(fullPath);
      } else {
        total += (await stat(fullPath)).size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function cleanupTarget(
  targetDir: string,
  maxBytes: number,
): Promise<{ removedBytes: number; removedEntries: number }> {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const records: Array<{ fullPath: string; size: number; atimeMs: number }> = [];
    let totalSize = 0;

    for (const entry of entries) {
      try {
        const fullPath = join(targetDir, entry.name);
        const entryStat = await stat(fullPath);
        const atimeMs = entryStat.atimeMs || entryStat.mtimeMs;
        const size = entry.isDirectory()
          ? await estimateDirectorySize(fullPath)
          : entryStat.size;

        totalSize += size;
        records.push({ fullPath, size, atimeMs });
      } catch {
        // ignore races
      }
    }

    if (totalSize <= maxBytes) {
      return { removedBytes: 0, removedEntries: 0 };
    }

    records.sort((a, b) => a.atimeMs - b.atimeMs);

    let removedBytes = 0;
    let removedEntries = 0;
    for (const record of records) {
      if (totalSize <= maxBytes) break;
      await rm(record.fullPath, { recursive: true, force: true });
      totalSize -= record.size;
      removedBytes += record.size;
      removedEntries += 1;
    }

    return { removedBytes, removedEntries };
  } catch (error) {
    console.log(
      `[cleanup-build-cache] ${targetDir}: skipped (${error instanceof Error ? error.message : String(error)})`,
    );
    return { removedBytes: 0, removedEntries: 0 };
  }
}

async function main(): Promise<void> {
  // Cleanup targets with their respective size limits
  const targets = [
    { path: join(BUILD_CACHE_DIR, "hex-cache"), maxBytes: MAX_BYTES },
    { path: join(STORAGE_DIR, "core-cache"), maxBytes: MAX_CORE_CACHE_BYTES },
    { path: join(STORAGE_DIR, "binaries"), maxBytes: MAX_BINARY_STORAGE_BYTES },
  ];

  for (const target of targets) {
    const result = await cleanupTarget(target.path, target.maxBytes);
    if (result.removedEntries > 0) {
      console.log(
        `[cleanup-build-cache] ${target.path}: removed ${result.removedEntries} entries (${(result.removedBytes / 1024 / 1024).toFixed(2)}MB)`,
      );
    } else {
      console.log(`[cleanup-build-cache] ${target.path}: no cleanup required`);
    }
  }
}

main().catch((error) => {
  console.error(
    `[cleanup-build-cache] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
