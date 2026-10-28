import { Logger } from "@shared/logger";
import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import { fullCommitShaSchema } from "@shared/examples";
import { safeErrorLogMetadata } from "../safe-error-log-metadata";
import type { RequestContext, RevisionResolver } from "./source-provider";
import { ExamplesError } from "./examples-error";
import type { TextFetcher } from "./http-provider";
import { githubApiBudget, type GitHubApiBudget } from "./github-api-budget";

const SHA_RESPONSE_MAX_BYTES = 256;

export class GitHubRevisionResolver implements RevisionResolver {
  private readonly logger = new Logger("GitHubRevisionResolver");
  constructor(
    private readonly fetcher: TextFetcher,
    private readonly budget: Pick<GitHubApiBudget, "assertMayCall" | "blockedForMs"> = githubApiBudget,
  ) {}

  async resolve(
    repository: RepositorySlug,
    ref: ExamplesRef,
    context: RequestContext,
  ): Promise<FullCommitSha> {
    const [owner, name] = repository.split("/");
    const url = new URL(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(ref)}`,
      "https://api.github.com",
    );
    this.budget.assertMayCall(context.sourcePriority ?? "default");
    let text: string;
    try {
      text = await this.fetcher.fetchText(url, SHA_RESPONSE_MAX_BYTES, context.signal, { representation: "github-commit-sha" });
    } catch (error) {
      this.logger.warn(`resolve-ref request=${JSON.stringify(context.requestId)}: ${safeErrorLogMetadata(error)}`);
      const blockedForMs = this.budget.blockedForMs();
      if (blockedForMs > 0) {
        throw new ExamplesError("RATE_LIMITED", "GitHub API rate limit reached for external examples", Math.ceil(blockedForMs / 1000));
      }
      throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref is unavailable");
    }
    const parsed = fullCommitShaSchema.safeParse(text.trim());
    if (!parsed.success) {
      this.logger.warn(`resolve-ref request=${JSON.stringify(context.requestId)}: invalid-sha`);
      throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref response is invalid");
    }
    return parsed.data;
  }
}
