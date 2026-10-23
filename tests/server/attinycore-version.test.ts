import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CHECKER = resolve("scripts/check-attinycore-version.sh");
const VERSION_FILE = readFileSync(resolve("scripts/attinycore-version"), "utf8");
const pinned = (name: string) => VERSION_FILE.match(new RegExp(String.raw`^${name}=(\S+)$`, "m"))?.[1];
const EXPECTED_VERSION = pinned("ATTINYCORE_VERSION");
if (!EXPECTED_VERSION) throw new Error("Pinned ATTinyCore version is missing");
let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

/** A fake arduino-cli that lists `installedVersion` and a sketchbook with or without the UnoSim overlay. */
async function runChecker(installedVersion: string, overlay: boolean): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "unosim-attinycore-version-"));
  const platformDir = join(tempDir, "user", "hardware", "ATTinyCore", "avr");
  await mkdir(platformDir, { recursive: true });
  if (overlay) await writeFile(join(platformDir, "platform.local.txt"), "recipe.hooks.savehex.presavehex.5.pattern.linux=\n");
  const fakeCli = join(tempDir, "arduino-cli");
  await writeFile(fakeCli, [
    "#!/bin/sh",
    `if [ "$1" = config ]; then echo '${join(tempDir, "user")}'; exit 0; fi`,
    String.raw`printf 'ID Installed Latest Name\narduino:avr 1.8.8 1.8.8 Arduino AVR Boards\nATTinyCore:avr ${installedVersion} ${installedVersion} ATTinyCore\n'`,
  ].join("\n"));
  await chmod(fakeCli, 0o755);
  const { stdout } = await execFileAsync("sh", [CHECKER], { env: { ...process.env, PATH: `${tempDir}:/usr/bin:/bin` } });
  return stdout;
}

describe("ATTinyCore version canary (plan P2.3)", () => {
  it("pins a version, an HTTPS release archive of that version and its SHA-256", () => {
    expect(pinned("ATTINYCORE_ARCHIVE_URL")).toMatch(new RegExp(String.raw`^https://.+/ATTinyCore-${EXPECTED_VERSION.replaceAll(".", String.raw`\.`)}\.tar\.bz2$`));
    expect(pinned("ATTINYCORE_ARCHIVE_SHA256")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts the pinned version with the UnoSim overlay", async () => {
    await expect(runChecker(EXPECTED_VERSION, true)).resolves.toContain(`Verified ATTinyCore:avr ${EXPECTED_VERSION}`);
  });

  it("rejects another installed version", async () => {
    await expect(runChecker("1.5.1", true)).rejects.toThrow(new RegExp(String.raw`expected.*${EXPECTED_VERSION}.*found 1\.5\.1`, "i"));
  });

  it("rejects an installation without the overlay that turns off the post-build hooks", async () => {
    await expect(runChecker(EXPECTED_VERSION, false)).rejects.toThrow(/lacks the UnoSim platform\.local\.txt/);
  });
});
