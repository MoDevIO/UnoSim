import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@shared/logger";
import { buildSimulationImage } from "@unosim/avr-emulator/image";
import type { BoardId } from "@shared/boards";
import { type SimulationArtifact, parseSimulationArtifact } from "@shared/simulation-artifact";
import { type BuildIdentity, buildIdOf, sameBuildIdentity } from "./build-identity";

const logger = new Logger("ArtifactBuilder");

/** What is stored next to a cached HEX: the artifact and the identity it was built under (plan P2.5). */
export interface ArtifactRecord {
  readonly identity: BuildIdentity;
  readonly artifact: SimulationArtifact;
}

/**
 * Builds the artifact of a successful compile from the HEX and, for the
 * symbols, the ELF of the same build. Returns undefined when the image cannot
 * be built (unparsable HEX, a flash that does not fit the board): the compile
 * still succeeded, the response just has no artifact.
 */
export function buildArtifact(input: { board: BoardId; hex: Buffer; elf?: Buffer; identity: BuildIdentity }): ArtifactRecord | undefined {
  try {
    const image = buildSimulationImage({
      board: input.board,
      hex: input.hex.toString("utf8"),
      ...(input.elf ? { elf: new Uint8Array(input.elf.buffer, input.elf.byteOffset, input.elf.byteLength) } : {}),
    });
    const artifact = parseSimulationArtifact({ ...image, buildId: buildIdOf(input.identity) });
    return artifact ? { identity: input.identity, artifact } : undefined;
  } catch (error) {
    logger.warn(`artifact not built: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

const sidecarPath = (dir: string, sketchHash: string): string => join(dir, `${sketchHash}.artifact.json`);

/** Writes the sidecar atomically, next to the cached HEX. */
export async function writeArtifactSidecar(dir: string, sketchHash: string, record: ArtifactRecord): Promise<void> {
  const target = sidecarPath(dir, sketchHash);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dir, { recursive: true });
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, target);
}

/**
 * The artifact of a cache entry, or null when there is none to trust: no
 * sidecar, unreadable or invalid content, or an identity other than the
 * current one (another toolchain, library set or build option). Null means
 * "build again".
 */
export async function readArtifactSidecar(dir: string, sketchHash: string, current: BuildIdentity): Promise<SimulationArtifact | null> {
  try {
    const stored = JSON.parse(await readFile(sidecarPath(dir, sketchHash), "utf8")) as { identity?: unknown; artifact?: unknown };
    if (!sameBuildIdentity(stored.identity, current)) return null;
    const artifact = parseSimulationArtifact(stored.artifact);
    return artifact && artifact.buildId === buildIdOf(current) ? artifact : null;
  } catch {
    return null;
  }
}

/** Removes the sidecar of an evicted cache entry. */
export async function removeArtifactSidecar(dir: string, sketchHash: string): Promise<void> {
  await rm(sidecarPath(dir, sketchHash), { force: true });
}
