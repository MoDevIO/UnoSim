/**
 * Token bucket for the messages of one WebSocket connection. Legitimate
 * clients stay far below the limit (an analog slider sends at most a few
 * hundred updates per second); a flooding client loses the excess messages
 * instead of turning each one into a write to the sketch's stdin.
 */
export class InboundMessageLimiter {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.refilledAt = now();
  }

  tryTake(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.refilledAt) * this.perSecond) / 1000);
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
