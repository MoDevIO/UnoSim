import { createHash } from "node:crypto";
import { SIMULATION_IMAGE_FORMAT_VERSION } from "@unosim/avr-emulator/image";
import type { ToolchainInfo } from "./toolchain-info";

/**
 * Everything that determines a build (plan E15, ADR 0010): the source, the
 * board with its full FQBN, the toolchain, the libraries, the fixed build
 * options and the artifact format. Equal identities give the same artifact; a
 * cache entry may only be served when the stored identity equals the current
 * one, otherwise the sketch is built again.
 */
export interface BuildIdentity {
  readonly artifactFormat: number;
  /** `buildSketchHash`: code, headers, entry file and FQBN. */
  readonly sketchHash: string;
  readonly fqbn: string;
  readonly toolchain: Pick<ToolchainInfo, "arduinoCli" | "cores">;
  readonly librariesFingerprint: string;
  /** Libraries the request names explicitly, sorted. */
  readonly requestedLibraries: readonly string[];
  /** `arduino-cli compile` flags that influence the output. */
  readonly buildOptions: readonly string[];
}

export interface BuildIdentityInput {
  readonly sketchHash: string;
  readonly fqbn: string;
  readonly toolchain: ToolchainInfo;
  readonly requestedLibraries?: readonly string[];
  readonly buildOptions: readonly string[];
}

export function createBuildIdentity(input: BuildIdentityInput): BuildIdentity {
  return {
    artifactFormat: SIMULATION_IMAGE_FORMAT_VERSION,
    sketchHash: input.sketchHash,
    fqbn: input.fqbn,
    toolchain: { arduinoCli: input.toolchain.arduinoCli, cores: input.toolchain.cores.map(({ id, version }) => ({ id, version })) },
    librariesFingerprint: input.toolchain.librariesFingerprint,
    requestedLibraries: [...(input.requestedLibraries ?? [])].sort((a, b) => a.localeCompare(b)),
    buildOptions: [...input.buildOptions],
  };
}

/** JSON with sorted object keys, so equal identities serialize equally whatever the construction order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The id of an identity: SHA-256 of its canonical JSON, lowercase hex. */
export function buildIdOf(identity: BuildIdentity): string {
  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}

/** True when the identity read from a sidecar is the current one. */
export function sameBuildIdentity(stored: unknown, current: BuildIdentity): boolean {
  return typeof stored === "object" && stored !== null && canonicalJson(stored) === canonicalJson(current);
}
