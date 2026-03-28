import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  normalizeLibraries,
  buildSketchHash,
  checkFileExists,
  checkBinaryExists,
  acquireCoreCacheLock,
  collectDirectoryRecords,
  evictLruEntries,
  cleanupCacheLru,
  ensureDirectories,
} from "../../../server/services/workers/compile-worker-utils";

// Use a unique temp dir per test run to avoid collisions
const TEST_BASE = join(process.cwd(), "temp", `worker-utils-test-${randomUUID().slice(0, 8)}`);

beforeEach(async () => {
  await mkdir(TEST_BASE, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_BASE, { recursive: true, force: true });
});

describe("normalizeLibraries", () => {
  it("returns empty array for undefined input", () => {
    expect(normalizeLibraries(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeLibraries([])).toEqual([]);
  });

  it("trims whitespace from entries", () => {
    expect(normalizeLibraries(["  Servo  ", " WiFi"])).toEqual(["Servo", "WiFi"]);
  });

  it("filters out empty strings", () => {
    expect(normalizeLibraries(["Servo", "", "  ", "WiFi"])).toEqual(["Servo", "WiFi"]);
  });

  it("sorts entries alphabetically", () => {
    expect(normalizeLibraries(["WiFi", "Servo", "Adafruit"])).toEqual([
      "Adafruit",
      "Servo",
      "WiFi",
    ]);
  });

  it("handles single entry", () => {
    expect(normalizeLibraries(["Servo"])).toEqual(["Servo"]);
  });
});

describe("buildSketchHash", () => {
  it("returns a 64-char hex string", () => {
    const hash = buildSketchHash({ code: "void setup(){}" }, "arduino:avr:uno");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns same hash for same input", () => {
    const a = buildSketchHash({ code: "test" }, "arduino:avr:uno");
    const b = buildSketchHash({ code: "test" }, "arduino:avr:uno");
    expect(a).toBe(b);
  });

  it("returns different hash for different code", () => {
    const a = buildSketchHash({ code: "void setup(){}" }, "arduino:avr:uno");
    const b = buildSketchHash({ code: "void loop(){}" }, "arduino:avr:uno");
    expect(a).not.toBe(b);
  });

  it("returns different hash for different fqbn", () => {
    const a = buildSketchHash({ code: "test" }, "arduino:avr:uno");
    const b = buildSketchHash({ code: "test" }, "arduino:avr:mega");
    expect(a).not.toBe(b);
  });
});

describe("checkFileExists", () => {
  it("returns true for existing file", async () => {
    const file = join(TEST_BASE, "exists.txt");
    await writeFile(file, "data");
    expect(await checkFileExists(file)).toBe(true);
  });

  it("returns false for non-existing file", async () => {
    expect(await checkFileExists(join(TEST_BASE, "nope.txt"))).toBe(false);
  });

  it("returns true for existing directory", async () => {
    const dir = join(TEST_BASE, "subdir");
    await mkdir(dir, { recursive: true });
    expect(await checkFileExists(dir)).toBe(true);
  });
});

describe("checkBinaryExists", () => {
  it("returns true when .hex file exists", async () => {
    const dir = join(TEST_BASE, "binaries");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "abc123.hex"), "fake-hex");
    expect(await checkBinaryExists(dir, "abc123")).toBe(true);
  });

  it("returns true when .elf file exists", async () => {
    const dir = join(TEST_BASE, "binaries");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "abc123.elf"), "fake-elf");
    expect(await checkBinaryExists(dir, "abc123")).toBe(true);
  });

  it("returns false when neither exists", async () => {
    const dir = join(TEST_BASE, "binaries");
    await mkdir(dir, { recursive: true });
    expect(await checkBinaryExists(dir, "missing")).toBe(false);
  });

  it("returns false for non-existent directory", async () => {
    expect(await checkBinaryExists(join(TEST_BASE, "no-dir"), "hash")).toBe(false);
  });
});

describe("acquireCoreCacheLock", () => {
  it("acquires lock on first attempt", async () => {
    const lockPath = join(TEST_BASE, "test.lock");
    const result = await acquireCoreCacheLock(lockPath, 5000);
    expect(result.acquired).toBe(true);
    expect(result.waitedMs).toBeLessThan(1000);
    // Lock file should exist
    expect(await checkFileExists(lockPath)).toBe(true);
  });

  it("waits and times out when lock is held", async () => {
    const lockPath = join(TEST_BASE, "held.lock");
    // Create existing lock file
    await writeFile(lockPath, "other-process");
    const result = await acquireCoreCacheLock(lockPath, 200);
    expect(result.acquired).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(150);
  });

  it("acquires lock after it is released", async () => {
    const lockPath = join(TEST_BASE, "released.lock");
    await writeFile(lockPath, "other-process");

    // Release the lock after 100ms
    setTimeout(async () => {
      await rm(lockPath, { force: true });
    }, 100);

    const result = await acquireCoreCacheLock(lockPath, 5000);
    expect(result.acquired).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(80);
  });
});

describe("collectDirectoryRecords", () => {
  it("returns empty for empty directory", async () => {
    const dir = join(TEST_BASE, "empty-dir");
    await mkdir(dir, { recursive: true });
    const { records, totalSize } = await collectDirectoryRecords(dir);
    expect(records).toHaveLength(0);
    expect(totalSize).toBe(0);
  });

  it("creates directory if it does not exist", async () => {
    const dir = join(TEST_BASE, "auto-created");
    const { records } = await collectDirectoryRecords(dir);
    expect(records).toHaveLength(0);
    expect(await checkFileExists(dir)).toBe(true);
  });

  it("collects files with correct sizes", async () => {
    const dir = join(TEST_BASE, "files");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.txt"), "hello"); // 5 bytes
    await writeFile(join(dir, "b.txt"), "world!"); // 6 bytes

    const { records, totalSize } = await collectDirectoryRecords(dir);
    expect(records).toHaveLength(2);
    expect(totalSize).toBe(11);
  });

  it("collects nested directory sizes", async () => {
    const dir = join(TEST_BASE, "nested");
    const subdir = join(dir, "sub");
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, "inner.txt"), "data123"); // 7 bytes

    const { records, totalSize } = await collectDirectoryRecords(dir);
    expect(records).toHaveLength(1); // the subdir
    expect(totalSize).toBe(7);
  });

  it("records have atimeMs", async () => {
    const dir = join(TEST_BASE, "atime");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "file.txt"), "x");

    const { records } = await collectDirectoryRecords(dir);
    expect(records[0].atimeMs).toBeGreaterThan(0);
  });
});

describe("evictLruEntries", () => {
  it("does nothing when total size is within budget", async () => {
    const dir = join(TEST_BASE, "evict-ok");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "keep.txt"), "data");

    const records = [{ fullPath: join(dir, "keep.txt"), size: 4, atimeMs: Date.now() }];
    await evictLruEntries(records, 4, 100);

    expect(await checkFileExists(join(dir, "keep.txt"))).toBe(true);
  });

  it("evicts oldest entries when over budget", async () => {
    const dir = join(TEST_BASE, "evict-over");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "old.txt"), "old-data");
    await writeFile(join(dir, "new.txt"), "new-data");

    const records = [
      { fullPath: join(dir, "old.txt"), size: 8, atimeMs: 1000 },
      { fullPath: join(dir, "new.txt"), size: 8, atimeMs: 2000 },
    ];
    await evictLruEntries(records, 16, 10);

    expect(await checkFileExists(join(dir, "old.txt"))).toBe(false);
    expect(await checkFileExists(join(dir, "new.txt"))).toBe(true);
  });

  it("evicts multiple entries until budget is met", async () => {
    const dir = join(TEST_BASE, "evict-multi");
    await mkdir(dir, { recursive: true });

    const files = ["a.txt", "b.txt", "c.txt"];
    for (const f of files) {
      await writeFile(join(dir, f), "12345"); // 5 bytes each
    }

    const records = files.map((f, i) => ({
      fullPath: join(dir, f),
      size: 5,
      atimeMs: 1000 + i * 100,
    }));
    // Total 15, budget 6 → must evict a and b (oldest)
    await evictLruEntries(records, 15, 6);

    expect(await checkFileExists(join(dir, "a.txt"))).toBe(false);
    expect(await checkFileExists(join(dir, "b.txt"))).toBe(false);
    expect(await checkFileExists(join(dir, "c.txt"))).toBe(true);
  });
});

describe("cleanupCacheLru", () => {
  it("creates marker file after cleanup", async () => {
    const cacheDir = join(TEST_BASE, "cache-lru");
    const target = join(cacheDir, "target");
    await mkdir(target, { recursive: true });

    await cleanupCacheLru(cacheDir, [target]);

    const markerPath = join(cacheDir, ".cleanup-marker");
    expect(await checkFileExists(markerPath)).toBe(true);
  });

  it("skips cleanup when marker is recent", async () => {
    const cacheDir = join(TEST_BASE, "cache-skip");
    const target = join(cacheDir, "target");
    await mkdir(target, { recursive: true });
    // Create recent marker
    const markerPath = join(cacheDir, ".cleanup-marker");
    await writeFile(markerPath, String(Date.now()));

    // Write a file that exceeds budget
    await writeFile(join(target, "big.txt"), "x".repeat(100));

    await cleanupCacheLru(cacheDir, [target], 10);

    // File should NOT be evicted because marker is recent
    expect(await checkFileExists(join(target, "big.txt"))).toBe(true);
  });

  it("evicts files exceeding max size", async () => {
    const cacheDir = join(TEST_BASE, "cache-evict");
    const target = join(cacheDir, "target");
    await mkdir(target, { recursive: true });
    // Create old marker
    const markerPath = join(cacheDir, ".cleanup-marker");
    await writeFile(markerPath, "1000");
    // Set mtime to old
    const oldDate = new Date(Date.now() - 120_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(markerPath, oldDate, oldDate);

    await writeFile(join(target, "old.bin"), "x".repeat(200));

    await cleanupCacheLru(cacheDir, [target], 50);

    expect(await checkFileExists(join(target, "old.bin"))).toBe(false);
  });
});

describe("ensureDirectories", () => {
  it("creates multiple directories", async () => {
    const dirs = [
      join(TEST_BASE, "dir-a"),
      join(TEST_BASE, "dir-b", "nested"),
      join(TEST_BASE, "dir-c"),
    ];
    await ensureDirectories(dirs);

    for (const dir of dirs) {
      const s = await stat(dir);
      expect(s.isDirectory()).toBe(true);
    }
  });

  it("is idempotent", async () => {
    const dir = join(TEST_BASE, "idem");
    await ensureDirectories([dir]);
    await ensureDirectories([dir]); // should not throw
    expect(await checkFileExists(dir)).toBe(true);
  });
});
