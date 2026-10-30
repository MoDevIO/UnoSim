import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";
import { type BoardId, getBoard } from "@shared/boards";
import {
  compileCompatibility,
  describeResolutionProblem,
  type LibraryCatalogResponse,
  libraryKey,
  type LibraryRequirement,
  type ResolvedLibrary,
  resolveLibraryGraph,
} from "@shared/libraries";
import { libraryPackageSchema } from "@shared/library-catalog-schema";
import catalogJson from "@shared/library-catalog.json";

/**
 * The curated library catalog of this server (SSOT Libraries §3) and the
 * resolution of a project's requirements against what the deployment
 * actually provides (§10). The catalog file is the one definition behind the
 * client listing, this resolution and `scripts/provision-libraries.mjs`.
 */

const catalogPackageSchema = libraryPackageSchema.extend({
  /** The immutable archive the provisioning step downloads and checks against `sha256`. */
  archive: z.object({ url: z.url(), size: z.number().int().positive(), root: z.string().min(1) }).strict(),
}).strict();
export type CatalogPackage = z.infer<typeof catalogPackageSchema>;

const catalogFileSchema = z.object({ schemaVersion: z.literal(1), packages: z.array(catalogPackageSchema) }).strict();

export const LIBRARY_CATALOG: readonly CatalogPackage[] = catalogFileSchema.parse(catalogJson).packages;

/** A package as the provisioning step installed it: identity and the directory the toolchain sees. */
export type ProvidedLibrary = ResolvedLibrary;

const providedFileSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.array(z.object({
    name: z.string(),
    version: z.string(),
    sha256: z.string(),
    dir: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/).refine((dir) => !dir.split("/").includes("..")),
  }).strict()),
}).strict();

/** The packages of a `provided.json`, with their directories under `root`; none when it is malformed. */
export function parseProvidedLibraries(json: unknown, root: string): ProvidedLibrary[] {
  const parsed = providedFileSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.packages.map((entry) => ({ ...entry, dir: posix.join(root, entry.dir) }));
}

/** `provided.json` of a local root; none when it is missing. */
export async function readProvidedLibraries(root: string): Promise<ProvidedLibrary[]> {
  try {
    return parseProvidedLibraries(JSON.parse(await readFile(posix.join(root, "provided.json"), "utf8")), root);
  } catch {
    return [];
  }
}

/** `<name>-<version>/<name>` with characters outside the process argument allowlist replaced. */
export function providedLibraryDir(entry: LibraryRequirement): string {
  const safe = (value: string) => value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return `${safe(entry.name)}-${safe(entry.version)}/${safe(entry.name)}`;
}

function provisioningProblem(entry: CatalogPackage, provided: readonly ProvidedLibrary[]): string | undefined {
  const installed = provided.find((candidate) => libraryKey(candidate) === libraryKey(entry));
  if (!installed) return `${entry.name} ${entry.version} is not installed on this server`;
  if (installed.sha256 !== entry.sha256) return `${entry.name} ${entry.version} failed its integrity check on this server`;
  return undefined;
}

export type CompileLibraries =
  | { readonly ok: true; readonly libraries: readonly ResolvedLibrary[] }
  | { readonly ok: false; readonly messages: readonly string[] };

/**
 * The packages a build of `requirements` for `board` uses: the complete fixed
 * graph, each one provided with the catalog checksum. Never another version.
 */
export function resolveCompileLibraries(
  requirements: readonly LibraryRequirement[],
  board: BoardId,
  provided: readonly ProvidedLibrary[],
  catalog: readonly CatalogPackage[] = LIBRARY_CATALOG,
): CompileLibraries {
  const resolution = resolveLibraryGraph(requirements, catalog);
  if (resolution.problems.length > 0) return { ok: false, messages: resolution.problems.map(describeResolutionProblem) };

  const messages: string[] = [];
  const libraries: ResolvedLibrary[] = [];
  for (const entry of resolution.packages) {
    const compile = compileCompatibility(entry, board);
    if (compile.status === "unsupported") {
      const reason = compile.reason ? `: ${compile.reason}` : "";
      messages.push(`${entry.name} ${entry.version} does not support ${getBoard(board).displayName}${reason}`);
      continue;
    }
    const problem = provisioningProblem(entry, provided);
    if (problem) {
      messages.push(problem);
      continue;
    }
    const installed = provided.find((candidate) => libraryKey(candidate) === libraryKey(entry));
    if (installed) libraries.push({ name: entry.name, version: entry.version, sha256: entry.sha256, dir: installed.dir });
  }
  return messages.length > 0 ? { ok: false, messages } : { ok: true, libraries };
}

/**
 * Built-in examples get the package the catalog maps them to as direct requirement (SSOT Libraries
 * §8.2); the directory scan alone has no such metadata. A mapping to no example or to one example
 * from two packages is an error, never an empty selection.
 */
export function attachCatalogLibraries<T extends { files: ReadonlyArray<{ path: string }>; libraries?: LibraryRequirement[] }>(
  examples: readonly T[],
  catalog: readonly CatalogPackage[] = LIBRARY_CATALOG,
): T[] {
  const byPath = new Map<string, LibraryRequirement>();
  for (const entry of catalog) {
    for (const example of entry.examples) {
      if (byPath.has(example.path)) throw new Error(`Library example ${example.path} is mapped to more than one package`);
      if (!examples.some((candidate) => candidate.files[0]?.path === example.path)) {
        throw new Error(`Library example ${example.path} of ${entry.name} ${entry.version} is not a built-in example`);
      }
      byPath.set(example.path, { name: entry.name, version: entry.version });
    }
  }
  return examples.map((example) => {
    const requirement = byPath.get(example.files[0]?.path ?? "");
    return requirement ? { ...example, libraries: [requirement] } : example;
  });
}

/** `GET /api/libraries`: the catalog without archive details, with this deployment's availability. */
export function libraryCatalogResponse(
  provided: readonly ProvidedLibrary[],
  catalog: readonly CatalogPackage[] = LIBRARY_CATALOG,
): LibraryCatalogResponse {
  return {
    schemaVersion: 1,
    packages: catalog.map(({ archive: _archive, ...entry }) => {
      const problem = provisioningProblem({ ...entry, archive: _archive }, provided);
      return problem ? { ...entry, available: false, unavailableReason: problem } : { ...entry, available: true };
    }),
  };
}
