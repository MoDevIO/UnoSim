import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesystemHelper } from "../../../server/services/sandbox/filesystem-helper";
import {
  sandboxTempDir,
  sweepTempArtifacts,
  TEMP_ARTIFACT_MAX_AGE_MS,
  workerBuildRoot,
} from "../../../server/services/temp-artifact-sweep";

let base: string;
const ageAll = async (path: string, ageMs: number) => {
  const time = new Date(Date.now() - ageMs);
  await utimes(path, time, time);
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "unosim-sweep-"));
  vi.stubEnv("UNOSIM_SHARED_TEMP_DIR", base);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

describe("temp artifact sweep", () => {
  it("uses the shared temp directory that sandbox runs and compile workers write to", () => {
    expect(sandboxTempDir()).toBe(join(base, "unosim-temp"));
    expect(workerBuildRoot()).toBe(join(base, "unosim-worker-build"));
  });

  it("removes the sketch directories of many finished runs once they are old enough", async () => {
    const helper = new FilesystemHelper({ clearCreatedSketchDir: vi.fn() } as never, {} as never);
    for (let run = 0; run < 25; run++) {
      const sketchDir = join(sandboxTempDir(), `run-${run}`);
      await mkdir(sketchDir, { recursive: true });
      await writeFile(join(sketchDir, "sketch.cpp"), "int main(){}");
      // What a finished run leaves behind: the directory renamed for deferred removal.
      expect(helper.attemptCleanupDir(sketchDir)).toBe(true);
      await ageAll(`${sketchDir}.cleanup`, TEMP_ARTIFACT_MAX_AGE_MS + 1_000);
    }
    const fresh = join(sandboxTempDir(), "fresh.cleanup");
    const active = join(sandboxTempDir(), "active-run");
    await mkdir(fresh);
    await mkdir(active);
    await ageAll(active, TEMP_ARTIFACT_MAX_AGE_MS + 1_000);

    const removed = await sweepTempArtifacts({ legacyTempDir: join(base, "legacy") });

    expect(removed).toBe(25);
    expect((await readdir(sandboxTempDir())).sort()).toEqual(["active-run", "fresh.cleanup"]);
  });

  it("removes stale per-sketch compile build directories but keeps recent ones and the caches", async () => {
    const buildOutput = join(workerBuildRoot(), "worker_1", "build-output");
    for (let index = 0; index < 10; index++) {
      const dir = join(buildOutput, `hash-${index}`);
      await mkdir(dir, { recursive: true });
      await ageAll(dir, TEMP_ARTIFACT_MAX_AGE_MS + 1_000);
    }
    await mkdir(join(buildOutput, "in-progress"));
    const sketchDir = join(workerBuildRoot(), "worker_1", "some-sketch");
    await mkdir(sketchDir);
    await ageAll(sketchDir, TEMP_ARTIFACT_MAX_AGE_MS + 1_000);

    const removed = await sweepTempArtifacts({ legacyTempDir: join(base, "legacy") });

    expect(removed).toBe(10);
    expect(await readdir(buildOutput)).toEqual(["in-progress"]);
    expect((await readdir(join(workerBuildRoot(), "worker_1"))).sort()).toEqual(["build-output", "some-sketch"]);
  });

  it("keeps sweeping the legacy temp directory", async () => {
    const legacy = join(base, "legacy");
    await mkdir(join(legacy, "old.cleanup"), { recursive: true });
    await writeFile(join(legacy, "old.cleanup.json"), "{}");
    await writeFile(join(legacy, "keep.json"), "{}");
    await ageAll(join(legacy, "old.cleanup"), TEMP_ARTIFACT_MAX_AGE_MS + 1_000);
    await ageAll(join(legacy, "old.cleanup.json"), TEMP_ARTIFACT_MAX_AGE_MS + 1_000);
    await ageAll(join(legacy, "keep.json"), TEMP_ARTIFACT_MAX_AGE_MS + 1_000);

    expect(await sweepTempArtifacts({ legacyTempDir: legacy })).toBe(2);
    expect(await readdir(legacy)).toEqual(["keep.json"]);
  });

  it("tolerates missing directories", async () => {
    await expect(sweepTempArtifacts({ legacyTempDir: join(base, "missing") })).resolves.toBe(0);
  });
});
