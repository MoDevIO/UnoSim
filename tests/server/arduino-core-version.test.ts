import { readFileSync } from "node:fs";
import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CHECKER = resolve("scripts/check-arduino-avr-core-version.sh");
const VERSION_FILE = resolve("scripts/arduino-avr-core-version");
const EXPECTED_CORE_VERSION = readFileSync(VERSION_FILE, "utf8")
  .match(/^ARDUINO_AVR_CORE_VERSION=(\S+)$/m)?.[1];
if (!EXPECTED_CORE_VERSION) throw new Error("Pinned AVR core version is missing");
let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function runChecker(installedVersion: string): Promise<void> {
  tempDir = await mkdtemp(join(tmpdir(), "unosim-core-version-"));
  const fakeCli = join(tempDir, "arduino-cli");
  await writeFile(
    fakeCli,
    `#!/bin/sh\nprintf 'ID Installed Latest Name\\narduino:avr ${installedVersion} ${installedVersion} Arduino AVR Boards\\n'\n`,
  );
  await chmod(fakeCli, 0o755);
  await execFileAsync("sh", [CHECKER], {
    env: { ...process.env, PATH: `${tempDir}:/usr/bin:/bin` },
  });
}

describe("Arduino AVR core version canary", () => {
  it("accepts the tested pinned core version", async () => {
    await expect(runChecker(EXPECTED_CORE_VERSION)).resolves.toBeUndefined();
  });

  it("rejects a different installed core version", async () => {
    const mismatchVersion = EXPECTED_CORE_VERSION === "1.8.7" ? "1.8.6" : "1.8.7";
    await expect(runChecker(mismatchVersion)).rejects.toThrow(
      new RegExp(`expected.*${EXPECTED_CORE_VERSION}.*found.*${mismatchVersion}`, "i"),
    );
  });
});
