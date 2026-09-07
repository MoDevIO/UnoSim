import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCacheHits } from "../../../../server/services/compiler/cache-manager";

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
