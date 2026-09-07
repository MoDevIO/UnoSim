import { Logger } from "@shared/logger";
import { config as serverConfig } from "../config";

const logger = new Logger("RateLimiter");

interface RateLimitEntry {
  timestamps: number[];
  blockedUntil: number;
  lastActivity: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  blockDurationMs: number;
}

export type RateLimitResult = { allowed: true } | {
  allowed: false;
  retryAfter: number;
};

class IdentityRateLimiter {
  private readonly identityLimits = new Map<string, RateLimitEntry>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private rejectedTotal = 0;

  constructor(
    private readonly name: string,
    private readonly rateConfig: RateLimitConfig,
  ) {
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      serverConfig.server.simulationRateLimitCleanupIntervalMs,
    );
    this.cleanupInterval.unref?.();
    logger.info(
      `${name} rate limiter initialized: ${rateConfig.maxRequests} request(s) per ${rateConfig.windowMs}ms`,
    );
  }

  checkLimit(identity: string): RateLimitResult {
    const now = Date.now();
    let entry = this.identityLimits.get(identity);

    if (!entry) {
      entry = { timestamps: [now], blockedUntil: 0, lastActivity: now };
      this.identityLimits.set(identity, entry);
      return { allowed: true };
    }

    entry.lastActivity = now;
    if (now < entry.blockedUntil) {
      this.rejectedTotal++;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1_000)),
      };
    }

    if (entry.blockedUntil > 0) {
      entry.blockedUntil = 0;
      entry.timestamps = [];
    }

    const cutoff = now - this.rateConfig.windowMs;
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);
    if (entry.timestamps.length >= this.rateConfig.maxRequests) {
      entry.blockedUntil = now + this.rateConfig.blockDurationMs;
      this.rejectedTotal++;
      logger.warn(
        `${this.name} rate limit exceeded; blocking identity for ${this.rateConfig.blockDurationMs}ms`,
      );
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil(this.rateConfig.blockDurationMs / 1_000),
        ),
      };
    }

    entry.timestamps.push(now);
    return { allowed: true };
  }

  private cleanup(): void {
    const cutoff =
      Date.now() - serverConfig.server.simulationRateLimitInactiveTtlMs;
    for (const [identity, entry] of this.identityLimits) {
      if (entry.lastActivity < cutoff) this.identityLimits.delete(identity);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.identityLimits.clear();
  }

  getStats() {
    const now = Date.now();
    return {
      config: this.rateConfig,
      activeClients: this.identityLimits.size,
      blockedClients: Array.from(this.identityLimits.values()).filter(
        (entry) => entry.blockedUntil > now,
      ).length,
      rejectedTotal: this.rejectedTotal,
    };
  }
}

const SIMULATION_DEFAULTS: RateLimitConfig = {
  maxRequests: serverConfig.server.simulationRateLimitMaxRequests,
  windowMs: serverConfig.server.simulationRateLimitWindowMs,
  blockDurationMs: serverConfig.server.simulationRateLimitBlockDurationMs,
};

const COMPILE_DEFAULTS: RateLimitConfig = {
  maxRequests: serverConfig.server.compileRateLimitMaxRequests,
  windowMs: serverConfig.server.compileRateLimitWindowMs,
  blockDurationMs: serverConfig.server.compileRateLimitBlockDurationMs,
};

export class SimulationRateLimiter extends IdentityRateLimiter {
  private static instance: SimulationRateLimiter | null = null;

  private constructor(config: Partial<RateLimitConfig> = {}) {
    super("Simulation start", { ...SIMULATION_DEFAULTS, ...config });
  }

  static getInstance(config?: Partial<RateLimitConfig>): SimulationRateLimiter {
    SimulationRateLimiter.instance ??= new SimulationRateLimiter(config);
    return SimulationRateLimiter.instance;
  }
}

export class CompileRateLimiter extends IdentityRateLimiter {
  private static instance: CompileRateLimiter | null = null;

  private constructor(config: Partial<RateLimitConfig> = {}) {
    super("Compile", { ...COMPILE_DEFAULTS, ...config });
  }

  static getInstance(config?: Partial<RateLimitConfig>): CompileRateLimiter {
    CompileRateLimiter.instance ??= new CompileRateLimiter(config);
    return CompileRateLimiter.instance;
  }
}

export const getSimulationRateLimiter = (): SimulationRateLimiter =>
  SimulationRateLimiter.getInstance();

export const getCompileRateLimiter = (): CompileRateLimiter =>
  CompileRateLimiter.getInstance();
