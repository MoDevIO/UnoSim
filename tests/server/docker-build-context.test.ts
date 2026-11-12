import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dockerignoreLines, dockerignorePath, repoRoot, runtimeMountDirectories } from "../utils/docker-build-context";

// The real builds as another host UID run with Docker in tests/integration/docker-build-context-permissions.test.ts.
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
});
