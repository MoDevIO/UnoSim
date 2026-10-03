import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";

// Synthetic marker only; no real credential is ever read by this test.
const SENTINEL = `UNOSIM_SYNTHETIC_SENTINEL_${randomUUID().replaceAll("-", "")}`;

describe("REST compiler include boundary (real arduino-cli)", () => {
  let root: string;
  let sentinelFile: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "unosim-include-boundary-"));
    sentinelFile = join(root, "sentinel.txt");
    await writeFile(sentinelFile, `${SENTINEL} = not_a_secret;\n`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("does not echo a file named by an absolute include", async () => {
    const result = await new ArduinoCompiler().compile(
      `#include "${sentinelFile}"\nvoid setup(){}\nvoid loop(){}\n`,
      [],
      undefined,
      { entryFile: "sketch.ino", sketchHash: randomUUID(), hexCacheDir: join(root, "hex-cache") },
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  }, 60_000);
});
