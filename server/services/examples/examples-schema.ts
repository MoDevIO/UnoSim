import { z } from "zod";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_FILE_NAME = /^[A-Z0-9][A-Z0-9_.-]{0,127}\.(?:ino|h)$/i;

export const manifestFileSchema = z.object({
  name: z.string().min(1).max(128).regex(SAFE_FILE_NAME),
  path: z.string().min(1).max(512),
});

export const manifestExampleSchema = z.object({
  id: z.string().regex(SAFE_ID),
  title: z.string().min(1).max(160),
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  files: z.array(manifestFileSchema).min(1).max(100),
  main: z.string().regex(SAFE_FILE_NAME),
});

export const examplesManifestSchema = z.object({
  schemaVersion: z.literal(1),
  repository: z.string().max(256).optional(),
  ref: z.string().max(128).optional(),
  examples: z.array(manifestExampleSchema).max(1000),
});

export type ManifestFile = z.infer<typeof manifestFileSchema>;
export type ManifestExample = z.infer<typeof manifestExampleSchema>;
export type ExamplesManifest = z.infer<typeof examplesManifestSchema>;

export type ExampleFile = ManifestFile & {
  content: string;
};

export type ExampleRecord = Omit<ManifestExample, "files"> & {
  files: ExampleFile[];
  source: "builtin" | "external";
};

export type ExamplesSourceStatus = "builtin" | "remote" | "cache";

export type ExamplesSnapshot = {
  status: ExamplesSourceStatus;
  stale: boolean;
  examples: ExampleRecord[];
};

export function validateManifestReferences(manifest: ExamplesManifest): void {
  const ids = new Set<string>();

  for (const example of manifest.examples) {
    if (ids.has(example.id)) {
      throw new Error(`Duplicate example id: ${example.id}`);
    }
    ids.add(example.id);
    validateExampleReferences(example);
  }
}

function validateExampleReferences(example: ManifestExample): void {
  const names = new Set<string>();
  const paths = new Set<string>();
  let mainCount = 0;

  for (const file of example.files) {
    validateExampleFile(file, names, paths);
    if (file.path.toLowerCase().endsWith(".ino") && file.name === example.main) {
      mainCount++;
    }
  }

  if (mainCount !== 1 || !names.has(example.main)) {
    throw new Error(`Invalid main file for example: ${example.id}`);
  }
}

function validateExampleFile(
  file: ManifestFile,
  names: Set<string>,
  paths: Set<string>,
): void {
  if (names.has(file.name)) throw new Error(`Duplicate file name: ${file.name}`);
  if (paths.has(file.path)) throw new Error(`Duplicate file path: ${file.path}`);
  names.add(file.name);
  paths.add(file.path);

  if (!isSafeRelativePath(file.path)) {
    throw new Error(`Invalid example path: ${file.path}`);
  }
  if (file.path.toLowerCase().endsWith(".ino") !== file.name.toLowerCase().endsWith(".ino")) {
    throw new Error(`File name/path extension mismatch: ${file.name}`);
  }
}

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("//")) return false;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return /\.(?:ino|h)$/i.test(value);
}

export function manifestToCatalog(snapshot: ExamplesSnapshot) {
  return {
    schemaVersion: 1 as const,
    source: {
      status: snapshot.status,
      stale: snapshot.stale,
    },
    examples: snapshot.examples.map(({ files, ...example }) => ({
      ...example,
      files: files.map(({ content: _content, ...file }) => file),
    })),
  };
}
