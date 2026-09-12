import { z } from "zod";
import { INPUT_LIMITS } from "./input-limits";

const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const REPOSITORY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export const repositorySlugSchema = z.string()
  .min(3)
  .max(INPUT_LIMITS.examples.maxRepositorySlugChars)
  .refine((value) => {
    const segments = value.split("/");
    if (segments.length !== 2) return false;
    const [owner, repository] = segments;
    return Boolean(
      owner
      && repository
      && owner.length <= INPUT_LIMITS.examples.maxRepositoryOwnerChars
      && repository.length <= INPUT_LIMITS.examples.maxRepositoryNameChars
      && OWNER_PATTERN.test(owner)
      && !owner.includes("--")
      && REPOSITORY_PATTERN.test(repository)
      && repository !== "."
      && repository !== ".."
      && !repository.endsWith(".git"),
    );
  }, "Invalid canonical repository slug");

export const examplesRefSchema = z.string()
  .min(1)
  .max(INPUT_LIMITS.examples.maxRefChars)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const fullCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export type RepositorySlug = z.infer<typeof repositorySlugSchema>;
export type ExamplesRef = z.infer<typeof examplesRefSchema>;
export type FullCommitSha = z.infer<typeof fullCommitShaSchema>;

export const browserOverrideSelectionSchema = z.object({
  repository: repositorySlugSchema,
  ref: examplesRefSchema,
}).strict();

export const validateExamplesRequestSchema = z.object({
  schemaVersion: z.literal(1),
  selection: browserOverrideSelectionSchema,
}).strict();

export type BrowserOverrideSelection = z.infer<typeof browserOverrideSelectionSchema>;
export type ValidateExamplesRequest = z.infer<typeof validateExamplesRequestSchema>;

export type ExamplesRequestSelection =
  | { kind: "default" }
  | ({ kind: "browser-override" } & BrowserOverrideSelection);

export type ExamplesSourceMetadata =
  | {
      selection: "default";
      mode: "builtin";
      repository: null;
      ref: null;
      revision: null;
      status: "builtin";
      stale: false;
    }
  | {
      selection: "default" | "browser-override";
      mode: "repository-ref";
      repository: RepositorySlug;
      ref: ExamplesRef;
      revision: FullCommitSha;
      status: "remote" | "cache";
      stale: boolean;
    };

export interface ExampleFile {
  name: string;
  path: string;
  content: string;
}

export interface ExampleCatalogItem {
  id: string;
  title: string;
  category: string;
  description?: string;
  main: string;
  source: "builtin" | "external";
  files: Array<Omit<ExampleFile, "content">>;
}

export interface ExamplesCatalogResponse {
  schemaVersion: 1;
  source: ExamplesSourceMetadata;
  examples: ExampleCatalogItem[];
}

export interface ExampleDetailResponse {
  schemaVersion: 1;
  id: string;
  title: string;
  category: string;
  description?: string;
  main: string;
  source: "builtin" | "external";
  revision: FullCommitSha | null;
  files: ExampleFile[];
}

export interface ValidateExamplesResponse {
  schemaVersion: 1;
  valid: true;
  source: Extract<ExamplesSourceMetadata, { mode: "repository-ref" }>;
}

export type ExamplesErrorCode =
  | "INVALID_SELECTION"
  | "INVALID_REF"
  | "INVALID_REVISION"
  | "INVALID_SNAPSHOT"
  | "SOURCE_UNAVAILABLE"
  | "EXAMPLE_NOT_FOUND"
  | "RATE_LIMITED"
  | "LOAD_CAPACITY_EXCEEDED";

export interface ExamplesErrorResponse {
  schemaVersion: 1;
  error: {
    code: ExamplesErrorCode;
    message: string;
    retryAfterSeconds?: number;
  };
}
