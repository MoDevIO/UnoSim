import { Logger } from "@shared/logger";

/** Sustained runtime text lines per second that reach the client. */
export const RUNTIME_TEXT_LINES_PER_SECOND = 50;
/** Lines a run may emit at once before the sustained rate applies. */
export const RUNTIME_TEXT_LINE_BURST = 200;
/** A run that keeps dropping lines reports the count at most this often. */
export const RUNTIME_TEXT_DROP_LOG_INTERVAL_MS = 10_000;
/** Sent to the client once per run, when the first line is dropped. */
export const RUNTIME_TEXT_LIMIT_NOTICE =
  `Runtime output rate limit exceeded (${RUNTIME_TEXT_LINES_PER_SECOND} lines/s); further lines are dropped`;

export type RuntimeTextDecision = "forward" | "notice" | "drop";

interface RuntimeTextLimiterOptions {
  linesPerSecond?: number;
  burst?: number;
  logIntervalMs?: number;
  now?: () => number;
  logger?: Pick<Logger, "warn">;
}

/**
 * Budget of one run for runtime text lines: stdout/stderr output that is neither
 * a simulator protocol marker nor serial output. Sketch code controls these
 * lines and can write them far faster than any client reads them, so a token
 * bucket admits a burst and a sustained rate; every further line is dropped and
 * counted. The client is told once, the log only aggregated.
 */
export class RuntimeTextLimiter {
  private readonly linesPerSecond: number;
  private readonly burst: number;
  private readonly logIntervalMs: number;
  private readonly now: () => number;
  private readonly logger: Pick<Logger, "warn">;
  private tokens: number;
  private refilledAt: number;
  private dropped = 0;
  private droppedSinceLog = 0;
  private loggedAt = 0;

  constructor(options: RuntimeTextLimiterOptions = {}) {
    this.linesPerSecond = options.linesPerSecond ?? RUNTIME_TEXT_LINES_PER_SECOND;
    this.burst = options.burst ?? RUNTIME_TEXT_LINE_BURST;
    this.logIntervalMs = options.logIntervalMs ?? RUNTIME_TEXT_DROP_LOG_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? new Logger("RuntimeTextLimiter");
    this.tokens = this.burst;
    this.refilledAt = this.now();
  }

  /** Decides one line: forward it, replace it by the one-time notice, or drop it. */
  admit(): RuntimeTextDecision {
    const now = this.now();
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return "forward";
    }
    this.dropped += 1;
    this.droppedSinceLog += 1;
    if (this.dropped === 1) {
      this.logDrops(now, "Runtime output rate limit exceeded; dropping excess lines of this run");
      return "notice";
    }
    if (now - this.loggedAt >= this.logIntervalMs) {
      this.logDrops(now, "Runtime output still exceeds its rate limit");
    }
    return "drop";
  }

  get droppedLines(): number {
    return this.dropped;
  }

  private refill(now: number): void {
    const elapsedMs = Math.max(0, now - this.refilledAt);
    this.refilledAt = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsedMs * this.linesPerSecond) / 1_000);
  }

  private logDrops(now: number, message: string): void {
    this.logger.warn(`${message} (${this.droppedSinceLog} dropped since last report, ${this.dropped} total)`);
    this.loggedAt = now;
    this.droppedSinceLog = 0;
  }
}
