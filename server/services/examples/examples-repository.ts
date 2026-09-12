import type {
  BrowserOverrideSelection,
  ExampleDetailResponse,
  ExamplesCatalogResponse,
  ExamplesRequestSelection,
  ExamplesSourceMetadata,
  FullCommitSha,
  RepositorySlug,
} from "@shared/examples";
import { config, type ParsedExamplesConfig } from "../../config";
import { BuiltInProvider } from "./built-in-provider";
import { ExamplesCache } from "./examples-cache";
import { ExamplesError } from "./examples-error";
import { GitHubRevisionResolver } from "./github-revision-resolver";
import { ExamplesLoadController } from "./examples-load-controller";
import { RevisionProvider, SecureExamplesFetcher } from "./http-provider";
import type { ExampleRecord } from "./examples-schema";
import { SourceProvider, type RequestContext } from "./source-provider";
import { resolveExamplesSelection } from "./source-selection";

export interface ExamplesRepositoryOptions {
  examplesConfig?: ParsedExamplesConfig;
  builtInProvider?: Pick<BuiltInProvider, "getExamples">;
  sourceProvider?: Pick<SourceProvider, "resolve" | "getRevision">;
  cache?: ExamplesCache;
  loadController?: ExamplesLoadController;
}

export class ExamplesRepository {
  private readonly examplesConfig: ParsedExamplesConfig;
  private readonly builtInProvider: Pick<BuiltInProvider, "getExamples">;
  private readonly sourceProvider: Pick<SourceProvider, "resolve" | "getRevision">;

  constructor(options: ExamplesRepositoryOptions = {}) {
    this.examplesConfig = options.examplesConfig ?? config.examples;
    this.builtInProvider = options.builtInProvider ?? new BuiltInProvider();
    const loads = options.loadController ?? new ExamplesLoadController({
      maxConcurrentLoads: this.examplesConfig.maxConcurrentLoads,
      maxLoadQueue: this.examplesConfig.maxLoadQueue,
      maxOutboundFetches: this.examplesConfig.maxOutboundFetches,
      globalLoadStartsPerMinute: this.examplesConfig.globalLoadStartsPerMinute,
    });
    const fetcher = new SecureExamplesFetcher(loads);
    const cache = options.cache ?? new ExamplesCache({
      maxSources: this.examplesConfig.maxSources,
      maxSnapshots: this.examplesConfig.snapshotCacheMaxEntries,
      maxSnapshotBytes: this.examplesConfig.snapshotCacheMaxBytes,
    });
    this.sourceProvider = options.sourceProvider ?? new SourceProvider(
      new GitHubRevisionResolver(fetcher),
      new RevisionProvider(fetcher, this.examplesConfig.maxFileFetchConcurrency),
      cache,
      loads,
      { refreshMs: this.examplesConfig.refreshMs, refreshRetryMs: this.examplesConfig.refreshRetryMs },
    );
  }

  async validate(selection: BrowserOverrideSelection, context: RequestContext): Promise<ExamplesSourceMetadata> {
    const resolved = resolveExamplesSelection({ kind: "browser-override", ...selection }, this.examplesConfig);
    if (resolved.mode !== "repository-ref") {
      throw new ExamplesError("INVALID_SELECTION", "Invalid external examples selection");
    }
    const result = await this.sourceProvider.resolve(resolved.repository, resolved.ref, context, true);
    return {
      selection: "browser-override",
      mode: "repository-ref",
      repository: resolved.repository,
      ref: resolved.ref,
      revision: result.revision,
      status: result.status,
      stale: false,
    };
  }

  async getCatalog(selection: ExamplesRequestSelection, context: RequestContext): Promise<ExamplesCatalogResponse> {
    const resolved = resolveExamplesSelection(selection, this.examplesConfig);
    const builtins = await this.builtInProvider.getExamples();
    if (resolved.mode === "builtin") {
      return this.catalog({
        selection: "default", mode: "builtin", repository: null, ref: null,
        revision: null, status: "builtin", stale: false,
      }, builtins);
    }
    const remote = await this.sourceProvider.resolve(resolved.repository, resolved.ref, context, false);
    return this.catalog({
      selection: resolved.selection,
      mode: "repository-ref",
      repository: resolved.repository,
      ref: resolved.ref,
      revision: remote.revision,
      status: remote.status,
      stale: remote.stale,
    }, deduplicateExamples([...builtins, ...remote.snapshot.examples]));
  }

  async getExample(
    repository: RepositorySlug | undefined,
    revision: FullCommitSha | undefined,
    id: string,
    context: RequestContext,
  ): Promise<ExampleDetailResponse | null> {
    const builtins = await this.builtInProvider.getExamples();
    const builtin = builtins.find((candidate) => candidate.id === id);
    if (builtin) return toDetail(builtin, null);
    if (!repository && !revision) return null;
    if (!repository || !revision) {
      throw new ExamplesError("INVALID_REVISION", "External example details require repository and revision");
    }
    const snapshot = await this.sourceProvider.getRevision(repository, revision, context);
    const example = snapshot.examples.find((candidate) => candidate.id === id);
    return example ? toDetail(example, revision) : null;
  }

  private catalog(source: ExamplesSourceMetadata, examples: ExampleRecord[]): ExamplesCatalogResponse {
    return {
      schemaVersion: 1,
      source,
      examples: examples.map(({ files, ...example }) => ({
        ...example,
        files: files.map(({ content: _content, ...file }) => file),
      })),
    };
  }
}

function toDetail(example: ExampleRecord, revision: FullCommitSha | null): ExampleDetailResponse {
  const main = example.files.find((file) => file.name === example.main);
  const remaining = example.files.filter((file) => file !== main);
  return {
    schemaVersion: 1,
    ...example,
    revision,
    files: main ? [main, ...remaining] : example.files,
  };
}

function deduplicateExamples(examples: ExampleRecord[]): ExampleRecord[] {
  const ids = new Set<string>();
  return examples.filter((example) => {
    if (ids.has(example.id)) return false;
    ids.add(example.id);
    return true;
  });
}
