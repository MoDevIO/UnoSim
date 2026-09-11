import { z } from "zod";
import type { ExamplesRef, FullCommitSha, RepositorySlug } from "@shared/examples";
import { fullCommitShaSchema } from "@shared/examples";
import { config } from "../../config";
import type { RequestContext, RevisionResolver } from "./source-provider";
import { ExamplesError } from "./examples-error";
import type { TextFetcher } from "./http-provider";

const githubCommitResponseSchema = z.object({ sha: fullCommitShaSchema }).passthrough();

export class GitHubRevisionResolver implements RevisionResolver {
  constructor(private readonly fetcher: TextFetcher) {}

  async resolve(
    repository: RepositorySlug,
    ref: ExamplesRef,
    context: RequestContext,
  ): Promise<FullCommitSha> {
    const [owner, name] = repository.split("/");
    const url = new URL(
      `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/commits/${encodeURIComponent(ref)}`,
      "https://api.github.com",
    );
    let text: string;
    try {
      text = await this.fetcher.fetchText(url, config.examples.maxManifestBytes, context.signal);
    } catch {
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
