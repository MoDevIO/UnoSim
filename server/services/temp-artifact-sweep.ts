import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { getFastTmpBaseDir } from "../../shared/utils/temp-paths.ts";

/** Abandoned temp artifacts are removed once they are older than this. */
export const TEMP_ARTIFACT_MAX_AGE_MS = 5 * 60 * 1000;

/** Sketch directories of simulation runs; finished ones are renamed to `<id>.cleanup`. */
export function sandboxTempDir(): string {
  return join(getFastTmpBaseDir(), "unosim-temp");
}

/** Per-worker directories of the compile workers. */
export function workerBuildRoot(): string {
  return join(getFastTmpBaseDir(), "unosim-worker-build");
}

interface SweepOptions {
  /** The process-relative temp directory swept since before the shared temp directory existed. */
  legacyTempDir: string;
  now?: number;
  maxAgeMs?: number;
}

/**
 * Removes temp artifacts that no run or compile uses any more, in the
 * directories that sandbox runs and compile workers actually write to:
 * `.cleanup` directories and `.cleanup.json` files of finished runs, and
 * per-sketch build directories that a compile left in `build-output`.
 * Returns the number of removed entries; never throws.
 */
export async function sweepTempArtifacts(options: SweepOptions): Promise<number> {
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeMs ?? TEMP_ARTIFACT_MAX_AGE_MS);
  const isCleanupItem = (name: string) => name.endsWith(".cleanup") || name.endsWith(".cleanup.json");
  let removed = await removeStaleEntries(options.legacyTempDir, cutoff, isCleanupItem);
  removed += await removeStaleEntries(sandboxTempDir(), cutoff, isCleanupItem);
  for (const worker of await listEntries(workerBuildRoot())) {
    if (!worker.startsWith("worker_")) continue;
    removed += await removeStaleEntries(join(workerBuildRoot(), worker, "build-output"), cutoff, () => true);
  }
  return removed;
}

async function listEntries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function removeStaleEntries(dir: string, cutoff: number, matches: (name: string) => boolean): Promise<number> {
  let removed = 0;
  for (const name of await listEntries(dir)) {
    if (!matches(name)) continue;
    const path = join(dir, name);
    try {
      if ((await stat(path)).mtimeMs >= cutoff) continue;
      await rm(path, { recursive: true, force: true });
      removed++;
    } catch {
      // Removed concurrently or not accessible; the next sweep retries.
    }
  }
  return removed;
}
