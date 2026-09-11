import type {
  BrowserOverrideSelection,
  ExamplesRef,
  ExamplesRequestSelection,
  RepositorySlug,
} from "@shared/examples";
import { examplesRefSchema, repositorySlugSchema } from "@shared/examples";
import { ExamplesError } from "./examples-error";

export type ResolvedExamplesSelection =
  | { selection: "default"; mode: "builtin"; repository: null; ref: null }
  | {
      selection: "default" | "browser-override";
      mode: "repository-ref";
      repository: RepositorySlug;
      ref: ExamplesRef;
    };

export interface ExamplesDefaultConfig {
  mode: "builtin" | "repository-ref";
  ref: string;
  repository: string | null;
}

export function normalizeRepositoryInput(
  value: string,
  options: { allowRawGithub?: boolean } = {},
): RepositorySlug | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("://")) return parseCanonicalCandidate(trimmed.replace(/\.git\/?$/i, ""));

  let url: URL;
  try { url = new URL(trimmed); }
  catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && !(options.allowRawGithub && host === "raw.githubusercontent.com")) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  return parseCanonicalCandidate(`${segments[0]}/${segments[1]!.replace(/\.git$/i, "")}`);
}

export function toGithubRawRepositoryBase(repository: RepositorySlug): URL {
  return new URL(`https://raw.githubusercontent.com/${repository}/`);
}

export function resolveExamplesSelection(
  selection: ExamplesRequestSelection,
  defaults: ExamplesDefaultConfig,
): ResolvedExamplesSelection {
  if (selection.kind === "browser-override") {
    const parsed = parseBrowserOverride(selection);
    return { selection: "browser-override", mode: "repository-ref", ...parsed };
  }
  if (defaults.mode === "builtin") {
    return { selection: "default", mode: "builtin", repository: null, ref: null };
  }
  const repository = repositorySlugSchema.safeParse(defaults.repository);
  const ref = examplesRefSchema.safeParse(defaults.ref);
  if (!repository.success || !ref.success) {
    throw new ExamplesError("INVALID_SELECTION", "Invalid server examples selection");
  }
  return { selection: "default", mode: "repository-ref", repository: repository.data, ref: ref.data };
}

function parseCanonicalCandidate(value: string): RepositorySlug | null {
  const parsed = repositorySlugSchema.safeParse(value.toLowerCase());
  return parsed.success ? parsed.data : null;
}

function parseBrowserOverride(selection: BrowserOverrideSelection): BrowserOverrideSelection {
  const repository = repositorySlugSchema.safeParse(selection.repository);
  const ref = examplesRefSchema.safeParse(selection.ref);
  if (!repository.success || !ref.success) {
    throw new ExamplesError("INVALID_SELECTION", "Invalid external examples selection");
  }
  return { repository: repository.data, ref: ref.data };
}
