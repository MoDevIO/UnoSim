/**
 * Rate Limiter für Simulation Starts
 * 
 * Verhindert, dass einzelne Clients zu viele Simulationen zu schnell starten
 * und dadurch den Server überlasten.
 * 
 * Strategie:
 * - Pro Client (WebSocket): Max. 1 Start pro 2 Sekunden
 * - Sliding Window (nicht Token Bucket für simplere Implementierung)
 * - Zu schnelle Requests werden abgelehnt mit Retry-After Header
 */

import { WebSocket } from "ws";
import { Logger } from "@shared/logger";

const logger = new Logger("RateLimiter");

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil: number;
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
  private clientLimits = new Map<WebSocket, RateLimitEntry>();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  private constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Cleanup alte Einträge alle 5 Minuten
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
    
    logger.info(`Rate Limiter initialized: ${this.config.maxRequests} request(s) per ${this.config.windowMs}ms`);
  }

  static getInstance(config?: Partial<RateLimitConfig>): SimulationRateLimiter {
    if (!SimulationRateLimiter.instance) {
      SimulationRateLimiter.instance = new SimulationRateLimiter(config);
    }
    return SimulationRateLimiter.instance;
  }

  /**
   * Prüfe ob ein Client ein neues Simulation-Start Request machen darf
   * @returns { allowed: boolean, retryAfter?: number }
   */
  public checkLimit(ws: WebSocket): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = this.clientLimits.get(ws);

    // Neuer Client
    if (!entry) {
      entry = { timestamps: [now], blocked: false, blockedUntil: 0 };
      this.clientLimits.set(ws, entry);
      return { allowed: true };
    }

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
   * Client-Verbindung beendet → Cleanup
   */
  public removeClient(ws: WebSocket): void {
    this.clientLimits.delete(ws);
  }

  /**
   * Cleanup alte Einträge
   */
  private cleanup(): void {
    const now = Date.now();
    const entriesToDelete: WebSocket[] = [];

    for (const [ws, entry] of this.clientLimits.entries()) {
      // Lösche wenn:
      // 1. WebSocket ist geschlossen
      // 2. Keine Timestamps in den letzten 10 Minuten
      if (ws.readyState !== WebSocket.OPEN) {
        entriesToDelete.push(ws);
        continue;
      }

      const lastActivity = entry.timestamps[entry.timestamps.length - 1] || 0;
      if (now - lastActivity > 10 * 60 * 1000) {
        entriesToDelete.push(ws);
      }
    }

    entriesToDelete.forEach(ws => {
      this.clientLimits.delete(ws);
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
