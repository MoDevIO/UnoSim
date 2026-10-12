import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = join(__dirname, "../..");
const script = join(repoRoot, "scripts/prepare-runtime-dirs.sh");
const runtimeDirectories = ["server/arduino-cache", "temp", "storage"];
const temporaryDirectories: string[] = [];

function projectDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "unosim-runtime-dirs-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Runs the script as the current user, targeting that same account (no root needed). */
function prepareForCurrentUser(directory: string, extraArguments: string[] = []) {
  return spawnSync("bash", [
    script, "--project-dir", directory, "--uid", String(process.getuid?.()), "--gid", String(process.getgid?.()), ...extraArguments,
  ], { encoding: "utf8" });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("prepare-runtime-dirs.sh", () => {
  it("creates the runtime directories writable for the target account and closed to everyone else", () => {
    const directory = projectDir();

    const result = prepareForCurrentUser(directory);

    expect(result.status, result.stderr).toBe(0);
    for (const relative of runtimeDirectories) {
      const target = join(directory, relative);
      const stats = statSync(target);
      expect(stats.isDirectory(), relative).toBe(true);
      // The target is the current account, which is not UID 1000 on every host (1001 in the field).
      expect(stats.uid, relative).toBe(process.getuid?.());
      expect(stats.mode & 0o777, relative).toBe(0o750);
      accessSync(target, constants.W_OK);
      writeFileSync(join(target, "probe"), "x");
    }
  });

  it("is idempotent and keeps existing content", () => {
    const directory = projectDir();
    mkdirSync(join(directory, "storage/core-cache"), { recursive: true });
    writeFileSync(join(directory, "storage/core-cache/index"), "cached");

    expect(prepareForCurrentUser(directory).status).toBe(0);
    expect(prepareForCurrentUser(directory).status).toBe(0);

    expect(readFileSync(join(directory, "storage/core-cache/index"), "utf8")).toBe("cached");
  });

  it.skipIf(process.getuid?.() === 0)("asks for sudo instead of failing halfway when it cannot hand the directories over", () => {
    const directory = projectDir();
    const foreignUid = String((process.getuid?.() ?? 0) + 1);

    const result = spawnSync("bash", [script, "--project-dir", directory, "--uid", foreignUid, "--gid", foreignUid], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sudo/);
    for (const relative of runtimeDirectories) expect(() => statSync(join(directory, relative))).toThrow();
  });

  it("refuses a symbolic link and changes nothing", () => {
    const directory = projectDir();
    const elsewhere = projectDir();
    mkdirSync(join(directory, "server"), { recursive: true });
    symlinkSync(elsewhere, join(directory, "server/arduino-cache"));

    const result = prepareForCurrentUser(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symbolischer Link/);
    expect(() => statSync(join(directory, "temp"))).toThrow();
    expect(statSync(elsewhere).mode & 0o777).not.toBe(0o750);
  });

  it("refuses a regular file in place of a directory", () => {
    const directory = projectDir();
    writeFileSync(join(directory, "temp"), "");

    const result = prepareForCurrentUser(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/kein Verzeichnis/);
  });

  it("rejects non-numeric IDs", () => {
    const result = spawnSync("bash", [script, "--project-dir", projectDir(), "--uid", "node"], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/numerische/);
  });
});

describe("runtime directory deployment contract", () => {
  it("prepares exactly the directories docker-compose.yml bind-mounts, relative to the checkout", () => {
    const compose = parse(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8")) as {
      services: { "unosim-backend": { volumes: string[] } };
    };
    const mounted = compose.services["unosim-backend"].volumes
      .filter((volume) => !volume.startsWith("/var/run/docker.sock"))
      .map((volume) => volume.split(":")[0].replace(/^\$\{PWD\}\//, "").replace(/^\.\//, ""))
      .sort();
    const listed = readFileSync(script, "utf8").match(/^RUNTIME_DIRECTORIES=\(([^)]*)\)/m)?.[1].trim().split(/\s+/).sort();

    expect(listed).toEqual(mounted);
    expect(mounted).toEqual([...runtimeDirectories].sort());
  });

  it("defaults to the UID/GID of the unprivileged user the image runs as", () => {
    const source = readFileSync(script, "utf8");
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");

    expect(source).toMatch(/^RUNTIME_UID='1000'$/m);
    expect(source).toMatch(/^RUNTIME_GID='1000'$/m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/^USER (root|0)\b/m);
    expect(source).not.toMatch(/chmod\s+(-R\s+)?0?777|a\+w|o\+w/);
  });

  it("is what the installer uses instead of creating the directories as the installing user", () => {
    const installer = readFileSync(join(repoRoot, "scripts/install-ubuntu-vbox.sh"), "utf8");

    expect(installer).toMatch(/^sudo bash "\$PREPARE_RUNTIME_DIRS" --project-dir "\$PROJECT_DIR"$/m);
    expect(installer).not.toMatch(/^mkdir -p .*arduino-cache/m);
    execFileSync("bash", ["-n", script]);
    expect(statSync(script).mode & 0o111).not.toBe(0);
  });
});
