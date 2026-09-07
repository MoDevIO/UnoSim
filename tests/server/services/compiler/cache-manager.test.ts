import { mkdtemp, mkdir, readdir, rm, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkCacheHits,
  readOutputFromCache,
  runHexCacheCleanup,
  writeBinaryToStorage,
  writeHexToCache,
  writeOutputToCache,
} from "../../../../server/services/compiler/cache-manager";

const compileStartedAt = () => process.hrtime.bigint();

describe("cache-manager cache lookup", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    temporaryDirectories.length = 0;
  });

  async function createCacheDirectories(): Promise<{
    binaryStorageDir: string;
    hexCacheDir: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "unosim-cache-manager-"));
    temporaryDirectories.push(root);
    const binaryStorageDir = join(root, "binary");
    const hexCacheDir = join(root, "hex");
    await mkdir(binaryStorageDir);
    await mkdir(hexCacheDir);
    return { binaryStorageDir, hexCacheDir };
  }

  it("returns an instant binary hit and its cached output sidecar", async () => {
    const paths = await createCacheDirectories();
    const binary = Buffer.from("instant-binary");
    await writeFile(join(paths.binaryStorageDir, "sketch.hex"), binary);
    await writeFile(
      join(paths.binaryStorageDir, "sketch.output.txt"),
      "compiled output",
      "utf8",
    );

    await expect(
      checkCacheHits("sketch", paths, compileStartedAt()),
    ).resolves.toEqual({
      cached: true,
      binary,
      cacheType: "instant",
      cachedOutput: "compiled output",
    });
  });

  it("falls back to the ELF extension for an instant binary hit", async () => {
    const paths = await createCacheDirectories();
    const binary = Buffer.from("elf-binary");
    await writeFile(join(paths.binaryStorageDir, "sketch.elf"), binary);

    await expect(
      checkCacheHits("sketch", paths, compileStartedAt()),
    ).resolves.toEqual({
      cached: true,
      binary,
      cacheType: "instant",
      cachedOutput: null,
    });
  });

  it("returns a persistent HEX hit when instant storage misses", async () => {
    const paths = await createCacheDirectories();
    const binary = Buffer.from("persistent-hex");
    await writeFile(join(paths.hexCacheDir, "sketch.hex"), binary);
    await writeFile(
      join(paths.hexCacheDir, "sketch.output.txt"),
      "persistent output",
      "utf8",
    );

    await expect(
      checkCacheHits("sketch", paths, compileStartedAt()),
    ).resolves.toEqual({
      cached: true,
      binary,
      cacheType: "hex",
      cachedOutput: "persistent output",
    });
  });

  it("reports a miss when neither cache contains the sketch", async () => {
    const paths = await createCacheDirectories();

    await expect(
      checkCacheHits("missing", paths, compileStartedAt()),
    ).resolves.toEqual({
      cached: false,
      binary: null,
      cacheType: "none",
      cachedOutput: null,
    });
  });

  it("keeps a cache hit valid when its output sidecar is absent", async () => {
    const paths = await createCacheDirectories();
    const binary = Buffer.from("binary-without-sidecar");
    await writeFile(join(paths.hexCacheDir, "sketch.hex"), binary);

    await expect(
      checkCacheHits("sketch", paths, compileStartedAt()),
    ).resolves.toEqual({
      cached: true,
      binary,
      cacheType: "hex",
      cachedOutput: null,
    });
  });
});

describe("cache-manager cache writes", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    temporaryDirectories.length = 0;
  });

  async function createTemporaryDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "unosim-cache-manager-write-"));
    temporaryDirectories.push(root);
    return root;
  }

  it("writes binary storage atomically, creates the directory, and leaves no temporary file", async () => {
    const root = await createTemporaryDirectory();
    const storageDir = join(root, "binary");
    const binary = Buffer.from([0, 1, 2, 255]);

    await writeBinaryToStorage("sketch", binary, storageDir);

    await expect(readFile(join(storageDir, "sketch.hex"))).resolves.toEqual(binary);
    await expect(readdir(storageDir)).resolves.toEqual(["sketch.hex"]);
  });

  it("overwrites binary storage on repeated writes without exposing a temporary artifact", async () => {
    const root = await createTemporaryDirectory();
    const storageDir = join(root, "binary");

    await writeBinaryToStorage("sketch", Buffer.from("first"), storageDir);
    await writeBinaryToStorage("sketch", Buffer.from("second"), storageDir);

    await expect(readFile(join(storageDir, "sketch.hex"), "utf8")).resolves.toBe("second");
    await expect(readdir(storageDir)).resolves.toEqual(["sketch.hex"]);
  });

  it("writes HEX cache entries atomically and overwrites them on repeated writes", async () => {
    const root = await createTemporaryDirectory();
    const hexCacheDir = join(root, "hex");

    await writeHexToCache("sketch", hexCacheDir, Buffer.from("first-hex"));
    await writeHexToCache("sketch", hexCacheDir, Buffer.from("second-hex"));

    await expect(readFile(join(hexCacheDir, "sketch.hex"), "utf8")).resolves.toBe("second-hex");
    await expect(readdir(hexCacheDir)).resolves.toEqual(["sketch.hex"]);
  });

  it("writes and reads output sidecar metadata for both cache locations", async () => {
    const root = await createTemporaryDirectory();
    const binaryDir = join(root, "binary");
    const hexDir = join(root, "hex");
    await mkdir(binaryDir);
    await mkdir(hexDir);

    await writeOutputToCache(binaryDir, "sketch", "binary compiler output");
    await writeOutputToCache(hexDir, "sketch", "hex compiler output");

    await expect(readOutputFromCache(binaryDir, "sketch")).resolves.toBe("binary compiler output");
    await expect(readOutputFromCache(hexDir, "sketch")).resolves.toBe("hex compiler output");
    await expect(readdir(binaryDir)).resolves.toEqual(["sketch.output.txt"]);
  });

  it("overwrites output sidecar metadata and rejects writes when its directory is absent", async () => {
    const root = await createTemporaryDirectory();
    const outputDir = join(root, "output");
    await mkdir(outputDir);

    await writeOutputToCache(outputDir, "sketch", "old output");
    await writeOutputToCache(outputDir, "sketch", "new output");

    await expect(readOutputFromCache(outputDir, "sketch")).resolves.toBe("new output");
    await expect(
      writeOutputToCache(join(root, "missing"), "sketch", "should fail"),
    ).rejects.toThrow();
  });
});

describe("cache-manager cache cleanup", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    temporaryDirectories.length = 0;
  });

  async function createHexCacheDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "unosim-cache-manager-cleanup-"));
    temporaryDirectories.push(root);
    const hexCacheDir = join(root, "hex");
    await mkdir(hexCacheDir);
    return hexCacheDir;
  }

  it("evicts least-recently-used HEX entries until the byte limit is met", async () => {
    const hexCacheDir = await createHexCacheDirectory();
    const oldPath = join(hexCacheDir, "old.hex");
    const recentPath = join(hexCacheDir, "recent.hex");
    await writeFile(oldPath, Buffer.alloc(4, 1));
    await writeFile(recentPath, Buffer.alloc(4, 2));
    await utimes(oldPath, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    await utimes(recentPath, new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:00:00Z"));

    await runHexCacheCleanup(hexCacheDir, 4);

    await expect(readdir(hexCacheDir)).resolves.toEqual(["recent.hex"]);
    await expect(readFile(recentPath)).resolves.toEqual(Buffer.alloc(4, 2));
  });

  it("removes multiple oldest entries when required and keeps newer entries", async () => {
    const hexCacheDir = await createHexCacheDirectory();
    const paths = await Promise.all(["oldest", "middle", "newest"].map(async (name, index) => {
      const path = join(hexCacheDir, `${name}.hex`);
      await writeFile(path, Buffer.alloc(3, index + 1));
      const date = new Date(`202${index}-01-01T00:00:00Z`);
      await utimes(path, date, date);
      return path;
    }));

    await runHexCacheCleanup(hexCacheDir, 3);

    await expect(readdir(hexCacheDir)).resolves.toEqual(["newest.hex"]);
    await expect(readFile(paths[2])).resolves.toEqual(Buffer.alloc(3, 3));
  });

  it("does not remove HEX entries or sidecars when the cache is within the limit", async () => {
    const hexCacheDir = await createHexCacheDirectory();
    await writeFile(join(hexCacheDir, "sketch.hex"), Buffer.alloc(4, 1));
    await writeFile(join(hexCacheDir, "sketch.output.txt"), "compiler output", "utf8");
    await writeFile(join(hexCacheDir, "sketch.hex.tmp-test"), "temporary", "utf8");

    await runHexCacheCleanup(hexCacheDir, 4);

    await expect(readdir(hexCacheDir)).resolves.toEqual([
      "sketch.hex",
      "sketch.hex.tmp-test",
      "sketch.output.txt",
    ]);
  });

  it("ignores non-HEX artifacts while evicting only the required HEX bytes", async () => {
    const hexCacheDir = await createHexCacheDirectory();
    await writeFile(join(hexCacheDir, "old.hex"), Buffer.alloc(4, 1));
    await writeFile(join(hexCacheDir, "new.hex"), Buffer.alloc(4, 2));
    await writeFile(join(hexCacheDir, "new.output.txt"), "metadata", "utf8");
    await writeFile(join(hexCacheDir, "notes.txt"), "not a cache entry", "utf8");
    const oldDate = new Date("2020-01-01T00:00:00Z");
    const newDate = new Date("2024-01-01T00:00:00Z");
    await utimes(join(hexCacheDir, "old.hex"), oldDate, oldDate);
    await utimes(join(hexCacheDir, "new.hex"), newDate, newDate);

    await runHexCacheCleanup(hexCacheDir, 4);

    await expect(readdir(hexCacheDir)).resolves.toEqual([
      "new.hex",
      "new.output.txt",
      "notes.txt",
    ]);
  });

  it("keeps directory artifacts with a HEX suffix out of eviction accounting", async () => {
    const hexCacheDir = await createHexCacheDirectory();
    await writeFile(join(hexCacheDir, "old.hex"), Buffer.alloc(4, 1));
    await mkdir(join(hexCacheDir, "directory.hex"));
    const oldDate = new Date("2020-01-01T00:00:00Z");
    await utimes(join(hexCacheDir, "old.hex"), oldDate, oldDate);

    await runHexCacheCleanup(hexCacheDir, 0);

    await expect(readdir(hexCacheDir)).resolves.toEqual(["directory.hex"]);
  });

  it("treats an absent cache directory as an already-clean cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "unosim-cache-manager-cleanup-missing-"));
    temporaryDirectories.push(root);

    await expect(runHexCacheCleanup(join(root, "missing"), 0)).resolves.toBeUndefined();
  });
});
