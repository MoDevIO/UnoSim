import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = join(__dirname, "../..");
const dockerignorePath = join(repoRoot, ".dockerignore");
// The CLI image the production Dockerfile already depends on (first build stage).
const CLI_IMAGE = "docker:27-cli";
// A host account that is not the container user (1000), like the field case UID 1001.
const HOST_USER = "1001:0";

/** Host paths docker-compose.yml bind-mounts into the backend, relative to the checkout. */
function runtimeMountDirectories(): string[] {
  const compose = parse(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8")) as {
    services: { "unosim-backend": { volumes: string[] } };
  };
  return compose.services["unosim-backend"].volumes
    .filter((volume) => !volume.startsWith("/var/run/docker.sock"))
    .map((volume) => volume.split(":")[0].replace(/^\$\{PWD\}\//, "").replace(/^\.\//, ""));
}

function dockerignoreLines(content: string): string[] {
  return content.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}

const dockerAvailable = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 20_000 }).status === 0;

function docker(args: string[], timeout = 120_000) {
  return spawnSync("docker", args, { encoding: "utf8", timeout });
}

function cliImageAvailable(): boolean {
  if (docker(["image", "inspect", CLI_IMAGE], 20_000).status === 0) return true;
  return docker(["pull", "-q", CLI_IMAGE], 180_000).status === 0;
}

/**
 * Builds `COPY . /all` the way a host account other than the container user
 * would: the Docker CLI runs as UID 1001 inside a Linux container and the
 * runtime directories belong to UID/GID 1000 with mode 0750, exactly what
 * prepare-runtime-dirs.sh leaves. Running in a container makes the permission
 * semantics identical on Linux CI and on Docker Desktop.
 */
function buildWholeContextAsOtherUser(dockerignore: string): { status: number | null; output: string } {
  const volume = `unosim-build-context-${process.pid}-${Date.now()}`;
  const directories = runtimeMountDirectories();
  expect(docker(["volume", "create", volume], 30_000).status).toBe(0);
  try {
    const prepare = docker([
      "run", "--rm", "--user", "0", "-v", `${volume}:/ctx`, "-e", `IGNORE=${dockerignore}`, "-e", `DIRS=${directories.join(" ")}`,
      "--entrypoint", "sh", CLI_IMAGE, "-c",
      [
        "set -e",
        String.raw`printf 'FROM scratch\nCOPY . /all\n' > /ctx/Dockerfile`,
        "echo ok > /ctx/marker",
        String.raw`printf '%s\n' "$IGNORE" > /ctx/.dockerignore`,
        'for d in $DIRS; do mkdir -p "/ctx/$d/nested"; echo state > "/ctx/$d/nested/file"; chown -R 1000:1000 "/ctx/$d"; chmod 0750 "/ctx/$d"; done',
        "chmod 755 /ctx /ctx/server; chmod 644 /ctx/Dockerfile /ctx/marker /ctx/.dockerignore",
      ].join("\n"),
    ]);
    expect(prepare.status, prepare.stderr).toBe(0);

    // The build container needs the daemon socket's group as seen inside containers.
    const socketGroup = docker([
      "run", "--rm", "-v", "/var/run/docker.sock:/s", "--entrypoint", "stat", CLI_IMAGE, "-c", "%g", "/s",
    ], 60_000).stdout.trim();
    const result = docker([
      "run", "--rm", "--user", HOST_USER, "--group-add", socketGroup, "-e", "HOME=/tmp", "-e", "DOCKER_CONFIG=/tmp/dc",
      "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", `${volume}:/ctx`,
      CLI_IMAGE, "build", "-q", "/ctx",
    ], 150_000);
    const imageId = /^sha256:[0-9a-f]+$/m.exec(result.stdout)?.[0];
    if (imageId) docker(["rmi", "-f", imageId], 30_000);
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    docker(["volume", "rm", "-f", volume], 30_000);
  }
}

describe("docker build context", () => {
  it("lists the mounted runtime directories this suite checks", () => {
    expect(runtimeMountDirectories().sort()).toEqual(["server/arduino-cache", "storage", "temp"]);
  });

  it("excludes every bind-mounted runtime directory, as a whole and relative to the context root", () => {
    const patterns = dockerignoreLines(readFileSync(dockerignorePath, "utf8"));

    for (const directory of runtimeMountDirectories()) {
      expect(patterns, `${directory} must be ignored`).toContain(directory);
    }
    // A negation could re-include part of a runtime directory.
    expect(patterns.filter((pattern) => pattern.startsWith("!"))).toEqual([]);
  });

  it("does not copy any runtime directory into an image", () => {
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
    const copied = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+)\s+\S+$/gm)].flatMap((match) => match[1].split(/\s+/));

    for (const directory of runtimeMountDirectories()) {
      expect(copied.some((source) => source === directory || source.startsWith(`${directory}/`)), directory).toBe(false);
    }
  });

  it.skipIf(!dockerAvailable)(
    "keeps runtime state owned by another UID out of a whole-context COPY with the real .dockerignore",
    (context) => {
      if (!cliImageAvailable()) context.skip();

      const result = buildWholeContextAsOtherUser(readFileSync(dockerignorePath, "utf8"));

      expect(result.status, result.output).toBe(0);
    },
    300_000,
  );

  it.skipIf(!dockerAvailable)(
    "control: the same build fails with 'permission denied' once a runtime directory is not ignored",
    (context) => {
      if (!cliImageAvailable()) context.skip();
      const runtime = new Set(runtimeMountDirectories());
      const withoutRuntime = dockerignoreLines(readFileSync(dockerignorePath, "utf8")).filter((pattern) => !runtime.has(pattern));

      const result = buildWholeContextAsOtherUser(withoutRuntime.join("\n"));

      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/permission denied/i);
    },
    300_000,
  );
});
