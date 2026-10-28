import { createHash } from "node:crypto";
import { arduinoToolchain } from "./toolchain";

/** What the toolchain contributes to a build besides the sketch (plan E15). */
export interface ToolchainInfo {
  readonly arduinoCli: string;
  /** Installed cores, sorted by id. */
  readonly cores: ReadonlyArray<{ readonly id: string; readonly version: string }>;
  /** SHA-256 over the sorted `name@version` list of the installed libraries. */
  readonly librariesFingerprint: string;
}

type JsonRunner = (args: string[]) => Promise<unknown>;

const TTL_MS = 5 * 60 * 1000;
const UNKNOWN = "unknown";
/** Fixed value in unit tests: they must neither spawn `arduino-cli` nor depend on the machine. */
const TEST_INFO: ToolchainInfo = { arduinoCli: "test-cli", cores: [{ id: "arduino:avr", version: "test-core" }], librariesFingerprint: "test-libraries" };

let cached: { info: ToolchainInfo; expiresAt: number } | undefined;
/** The query in flight: concurrent callers share it (a class compiling at once after the cache expired). */
let pending: Promise<ToolchainInfo> | undefined;

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === "string" && value.length > 0 ? value : UNKNOWN);

/** The array of a CLI answer: the answer itself (older releases) or its member `key`; undefined when there is none. */
function listOf(json: unknown, key: string): unknown[] | undefined {
  if (Array.isArray(json)) return json;
  const member = asRecord(json)[key];
  return Array.isArray(member) ? member : undefined;
}

/** `arduino-cli version --format json`: `VersionString` (1.x), older releases used `version_string`. */
export function parseCliVersion(json: unknown): string {
  const record = asRecord(json);
  return text(record.VersionString ?? record.version_string ?? record.versionString ?? record.version);
}

/** `arduino-cli core list --format json`: `{ platforms: [{ id, installed_version }] }`. */
export function parseCores(json: unknown): ToolchainInfo["cores"] {
  return (listOf(json, "platforms") ?? [])
    .map((entry) => asRecord(entry))
    .map((platform) => ({ id: text(platform.id), version: text(platform.installed_version ?? platform.installed) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** `arduino-cli lib list --format json`: `{ installed_libraries: [{ library: { name, version } }] }`. */
export function librariesFingerprint(json: unknown): string {
  const entries = listOf(json, "installed_libraries");
  if (!entries) return UNKNOWN;
  const names = entries
    .map((entry) => asRecord(asRecord(entry).library ?? entry))
    .map((library) => `${text(library.name)}@${text(library.version)}`)
    .sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(names.join("|")).digest("hex");
}

/**
 * Versions of `arduino-cli`, the installed cores and the installed libraries,
 * cached for five minutes. A value the CLI does not report is "unknown": a
 * build identity with unknown parts never equals one with known parts, so a
 * missing CLI cannot serve a stale build as current.
 */
export async function readToolchainInfo(run?: JsonRunner, now: () => number = Date.now): Promise<ToolchainInfo> {
  if (!run && process.env.NODE_ENV === "test") return TEST_INFO;
  if (cached && cached.expiresAt > now()) return cached.info;
  pending ??= queryToolchainInfo(run ?? arduinoToolchain().queryJson, now).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function queryToolchainInfo(runner: JsonRunner, now: () => number): Promise<ToolchainInfo> {
  const [version, cores, libraries] = await Promise.all([
    runner(["version", "--format", "json"]),
    runner(["core", "list", "--format", "json"]),
    runner(["lib", "list", "--format", "json"]),
  ]);
  const info: ToolchainInfo = { arduinoCli: parseCliVersion(version), cores: parseCores(cores), librariesFingerprint: librariesFingerprint(libraries) };
  cached = { info, expiresAt: now() + TTL_MS };
  return info;
}

export function resetToolchainInfoCache(): void {
  cached = undefined;
  pending = undefined;
}
