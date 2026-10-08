import { z } from "zod";
import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import { fullCommitShaSchema } from "@shared/examples";
import { config } from "../../config";
import type { RequestContext, RevisionResolver } from "./source-provider";
import { ExamplesError } from "./examples-error";
import type { TextFetcher } from "./http-provider";
import { githubApiBudget, type GitHubApiBudget } from "./github-api-budget";

const githubCommitResponseSchema = z.object({ sha: fullCommitShaSchema }).passthrough();

export class GitHubRevisionResolver implements RevisionResolver {
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
      text = await this.fetcher.fetchText(url, config.examples.maxManifestBytes, context.signal);
    } catch {
      const blockedForMs = this.budget.blockedForMs();
      if (blockedForMs > 0) {
        throw new ExamplesError("RATE_LIMITED", "GitHub API rate limit reached for external examples", Math.ceil(blockedForMs / 1000));
      }
      throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref is unavailable");
    }
    let decoded: unknown;
    try { decoded = JSON.parse(text) as unknown; }
    catch { throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref response is invalid"); }
    const parsed = githubCommitResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new ExamplesError("SOURCE_UNAVAILABLE", "External examples ref response is invalid");
    }
    return parsed.data.sha;
  }
}
