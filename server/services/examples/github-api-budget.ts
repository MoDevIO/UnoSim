import { ExamplesError } from "./examples-error";

/** Which Course selection a ref resolution serves; the operator default keeps a reserve. */
export type SourcePriority = "default" | "override";

/** GitHub REST calls kept back for the operator's default Course when the quota runs low. */
export const GITHUB_DEFAULT_SOURCE_RESERVE = 10;
/** Upper bound for an announced block, so a bogus reset header cannot stall resolution for long. */
const MAX_BLOCK_MS = 60 * 60 * 1000;
/** Block used when GitHub reports exhaustion without a usable reset time. */
const FALLBACK_BLOCK_MS = 60 * 1000;

/**
 * Process-wide view of the GitHub REST quota (60 requests per hour per server IP
 * without a token). Every api.github.com response updates it; while GitHub reports
 * the quota as exhausted, no further request is sent until the announced reset.
 */
export class GitHubApiBudget {
  private remaining: number | undefined;
  private resetAt = 0;
  private blockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  observe(status: number, headers: Headers): void {
    const now = this.now();
    const remaining = Number.parseInt(headers.get("x-ratelimit-remaining") ?? "", 10);
    const resetSeconds = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
    if (Number.isSafeInteger(remaining)) this.remaining = remaining;
    if (Number.isSafeInteger(resetSeconds)) this.resetAt = clampBlock(resetSeconds * 1000, now);
    if (status !== 403 && status !== 429) return;

    const retryAfterSeconds = Number.parseInt(headers.get("retry-after") ?? "", 10);
    if (Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
      this.blockedUntil = clampBlock(now + retryAfterSeconds * 1000, now);
    } else if (this.remaining === 0) {
      this.blockedUntil = this.resetAt > now ? this.resetAt : now + FALLBACK_BLOCK_MS;
    }
  }

  /** Throws RATE_LIMITED instead of spending a request that GitHub would refuse or the default needs. */
  assertMayCall(priority: SourcePriority): void {
    const now = this.now();
    if (now < this.blockedUntil) throw rateLimited(this.blockedUntil - now);
    if (priority === "override" && this.remaining !== undefined && this.remaining <= GITHUB_DEFAULT_SOURCE_RESERVE && now < this.resetAt) {
      throw rateLimited(this.resetAt - now);
    }
  }

  /** Remaining wait if GitHub currently blocks requests, for mapping a failed call. */
  blockedForMs(): number {
    return Math.max(0, this.blockedUntil - this.now());
  }
}

function clampBlock(until: number, now: number): number {
  return Math.min(until, now + MAX_BLOCK_MS);
}

function rateLimited(waitMs: number): ExamplesError {
  return new ExamplesError("RATE_LIMITED", "GitHub API rate limit reached for external examples", Math.max(1, Math.ceil(waitMs / 1000)));
}

export const githubApiBudget = new GitHubApiBudget();
