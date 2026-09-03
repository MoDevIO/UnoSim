/**
 * Rate Limiter für Simulation Starts
 * 
 * Verhindert, dass einzelne Clients zu viele Simulationen zu schnell starten
 * und dadurch den Server überlasten.
 * 
 * Strategie:
 * - Pro authentifizierter Identität: Max. 1 Start pro 2 Sekunden
 * - Sliding Window (nicht Token Bucket für simplere Implementierung)
 * - Zu schnelle Requests werden abgelehnt mit Retry-After Header
 */

import { Logger } from "@shared/logger";

const logger = new Logger("RateLimiter");

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil: number;
  lastActivity: number;
}

interface RateLimitConfig {
  maxRequests: number;      // Max. Anzahl Requests
  windowMs: number;         // Zeitfenster in ms
  blockDurationMs: number;  // Wie lange blockieren, wenn Limit überschritten
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 1,            // 1 Start
  windowMs: 2 * 1000,        // pro 2 Sekunden
  blockDurationMs: 5 * 1000  // Dann 5s blockieren
};

export class SimulationRateLimiter {
  private static instance: SimulationRateLimiter | null = null;
  private readonly clientLimits = new Map<string, RateLimitEntry>();
  private readonly config: RateLimitConfig;
  private readonly cleanupInterval: NodeJS.Timeout;

  private constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Cleanup alte Einträge alle 5 Minuten
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
    
    logger.info(`Rate Limiter initialized: ${this.config.maxRequests} request(s) per ${this.config.windowMs}ms`);
  }

  static getInstance(config?: Partial<RateLimitConfig>): SimulationRateLimiter {
    SimulationRateLimiter.instance ??= new SimulationRateLimiter(config);
    return SimulationRateLimiter.instance;
  }

  /**
   * Prüfe, ob eine Identität eine neue Simulation starten darf.
   * @returns { allowed: boolean, retryAfter?: number }
   */
  public checkLimit(identity: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = this.clientLimits.get(identity);

    // Neuer Client
    if (!entry) {
      entry = {
        timestamps: [now],
        blocked: false,
        blockedUntil: 0,
        lastActivity: now,
      };
      this.clientLimits.set(identity, entry);
      return { allowed: true };
    }

    entry.lastActivity = now;

    // Prüfe ob Client aktuell blockiert ist
    if (entry.blocked && now < entry.blockedUntil) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      logger.warn(`Client blocked for ${retryAfter}s (too many simulation starts)`);
      return { 
        allowed: false, 
        retryAfter 
      };
    }

    // Block-Status abgelaufen, zurücksetzen
    if (entry.blocked && now >= entry.blockedUntil) {
      entry.blocked = false;
      entry.blockedUntil = 0;
      entry.timestamps = [];
    }

    // Entferne alte Timestamps außerhalb des Fensters
    const cutoff = now - this.config.windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);

    // Prüfe ob Limit überschritten
    if (entry.timestamps.length >= this.config.maxRequests) {
      entry.blocked = true;
      entry.blockedUntil = now + this.config.blockDurationMs;
      
      logger.warn(
        `Rate limit exceeded for client. Blocking for ${this.config.blockDurationMs}ms`
      );
      
      const retryAfter = Math.ceil(this.config.blockDurationMs / 1000);
      return { 
        allowed: false, 
        retryAfter 
      };
    }

    // Request erlaubt
    entry.timestamps.push(now);
    return { allowed: true };
  }

  /**
   * Cleanup alte Einträge
   */
  private cleanup(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    for (const [identity, entry] of this.clientLimits.entries()) {
      if (now - entry.lastActivity > 10 * 60 * 1000) {
        entriesToDelete.push(identity);
      }
    }

    entriesToDelete.forEach((identity) => {
      this.clientLimits.delete(identity);
    });

    if (entriesToDelete.length > 0) {
      logger.debug(`Cleaned up ${entriesToDelete.length} inactive rate limit entries`);
    }
  }

  /**
   * Shutdown Cleanup
   */
  public destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clientLimits.clear();
  }

  /**
   * Debug: Aktuelle Limiter-Stats
   */
  public getStats() {
    return {
      config: this.config,
      activeClients: this.clientLimits.size,
      blockedClients: Array.from(this.clientLimits.values()).filter(e => e.blocked).length,
    };
  }
}

export const getSimulationRateLimiter = (): SimulationRateLimiter => {
  return SimulationRateLimiter.getInstance();
};
