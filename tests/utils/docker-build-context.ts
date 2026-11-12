import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const repoRoot = join(__dirname, "../..");
export const dockerignorePath = join(repoRoot, ".dockerignore");

/** Host paths docker-compose.yml bind-mounts into the backend, relative to the checkout. */
export function runtimeMountDirectories(): string[] {
  const compose = parse(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8")) as {
    services: { "unosim-backend": { volumes: string[] } };
  };
  return compose.services["unosim-backend"].volumes
    .filter((volume) => !volume.startsWith("/var/run/docker.sock"))
    .map((volume) => volume.split(":")[0].replace(/^\$\{PWD\}\//, "").replace(/^\.\//, ""));
}

export function dockerignoreLines(content: string): string[] {
  return content.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}
