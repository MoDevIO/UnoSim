// Synchronous on purpose: it runs once per process, and tests that replace node:fs/promises keep a real isolation.
import { existsSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * An arduino-cli configuration that sees no library of the host (SSOT
 * Libraries §10): `directories.user` points to a directory that only links
 * the third-party cores of the real sketchbook (ATTinyCore) and has no
 * `libraries`, and the built-in library directory is empty. Packages of a
 * build are added with `--library`. The compile sandbox image installs no
 * library, so it needs none of this.
 */
export interface CliIsolationEnv {
  readonly ARDUINO_DIRECTORIES_USER: string;
  readonly ARDUINO_DIRECTORIES_BUILTIN_LIBRARIES: string;
}

/** The sketchbook arduino-cli uses without a config file: ARDUINO_DIRECTORIES_USER, else its platform default. */
export function defaultArduinoUserDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (env.ARDUINO_DIRECTORIES_USER) return env.ARDUINO_DIRECTORIES_USER;
  return platform === "linux" ? join(home, "Arduino") : join(home, "Documents", "Arduino");
}

function linkOnce(target: string, link: string): void {
  try {
    symlinkSync(target, link, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Another worker thread created it first; it must point to the same place.
    if (code !== "EEXIST" || readlinkSync(link) !== target) throw error;
  }
}

export async function createCliIsolation(root: string, realUserDir: string): Promise<CliIsolationEnv> {
  const user = join(root, "user");
  const builtin = join(root, "builtin-libraries");
  mkdirSync(user, { recursive: true });
  mkdirSync(builtin, { recursive: true });
  const hardware = join(realUserDir, "hardware");
  if (existsSync(hardware)) linkOnce(hardware, join(user, "hardware"));
  return { ARDUINO_DIRECTORIES_USER: user, ARDUINO_DIRECTORIES_BUILTIN_LIBRARIES: builtin };
}

let shared: Promise<CliIsolationEnv> | undefined;

/** The isolation of this process, created once. */
export function cliIsolation(): Promise<CliIsolationEnv> {
  const owner = typeof process.getuid === "function" ? process.getuid() : "user";
  shared ??= createCliIsolation(join(tmpdir(), `unosim-arduino-isolation-${owner}`), defaultArduinoUserDir());
  return shared;
}
