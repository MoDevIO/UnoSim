/**
 * Unified Gatekeeper - Concurrency & Cache Management
 * 
 * Centralized system for:
 * 1. Compile slot allocation (semaphore-based)
 * 2. Cache Read-Write locking (multiple readers, single writer)
 * 3. TTL-based deadlock prevention (auto-release after timeout)
 * 4. Priority queuing (system checks prioritized over regular tasks)
 * 
 * Replaces the previous dual-gatekeeper pattern with atomic, deadlock-safe operations.
 */

import { Logger } from "@shared/logger";

// Priority levels for task queuing
export enum TaskPriority {
  HIGH = 0,    // System health checks, cleanup
  NORMAL = 1,  // Regular compilations
  LOW = 2,     // Background work
}

interface CacheLockEntry {
  key: string;
  lockType: "read" | "write";
  acquiredAt: number;
  expiresAt: number;
  owner: string;
}

interface CompileSlotEntry {
  priority: TaskPriority;
  acquiredAt: number;
  expiresAt: number;
  owner: string;
}

interface QueuedTask {
  priority: TaskPriority;
  resolver: (release: () => void) => void;
  owner: string;
  createdAt: number;
}

export class UnifiedGatekeeper {
  private readonly maxCompileConcurrent: number;
  private availableSlots: number;
  private activeSlots: Map<string, CompileSlotEntry> = new Map();
  private compileQueue: QueuedTask[] = [];
  
  // Cache locks: key -> [lock entries]
  private cacheLocks: Map<string, CacheLockEntry[]> = new Map();
  
  // Lock monitoring
  private lockCheckInterval: NodeJS.Timeout | null = null;
  private readonly lockTTL = 60000; // 60 seconds default TTL
  private readonly checkIntervalMs = 5000; // Check for expired locks every 5 seconds
  
  private logger = new Logger("UnifiedGatekeeper");
  
  // Statistics
  private stats = {
    totalCompileSlotRequests: 0,
    totalCacheLockRequests: 0,
    expiredLocks: 0,
    deadlocksAvoided: 0,
  };

  constructor(maxConcurrent?: number) {
    // In worker threads, disable gatekeeper since the worker pool controls concurrency
    const isWorkerThread = process.env.COMPILE_GATEKEEPER_DISABLED === "true";
    
    if (isWorkerThread) {
      this.maxCompileConcurrent = Infinity;
      this.availableSlots = Infinity;
      this.logger.info("UnifiedGatekeeper in worker thread (pool-controlled)");
    } else {
      this.maxCompileConcurrent = maxConcurrent || parseInt(process.env.COMPILE_MAX_CONCURRENT || "4", 10);
      this.availableSlots = this.maxCompileConcurrent;
      this.logger.info(`UnifiedGatekeeper initialized: max ${this.maxCompileConcurrent} concurrent compiles`);
    }
    
    // Start periodic lock expiration check
    this.startLockMonitoring();
  }

  /**
   * Acquire a compile slot with timeout and priority support
   * Returns a release function to be called when done
   */
  async acquireCompileSlot(
    priority: TaskPriority = TaskPriority.NORMAL,
    timeoutMs: number = 30000,
    owner: string = "unknown",
  ): Promise<() => void> {
    this.stats.totalCompileSlotRequests++;
    const ownerId = `${owner}-${Date.now()}-${Math.random()}`;

    return new Promise((resolve, reject) => {
      const grant = () => {
        const expiresAt = Date.now() + this.lockTTL;
        const entry: CompileSlotEntry = {
          priority,
          acquiredAt: Date.now(),
          expiresAt,
          owner: ownerId,
        };
        
        this.activeSlots.set(ownerId, entry);
        this.availableSlots--;
        
        this.logger.debug(
          `✓ Compile slot acquired by ${owner} (available: ${this.availableSlots}, active: ${this.activeSlots.size})`,
        );

        // Return release function bound to this owner
        resolve(this.createReleaseFunction(ownerId, "compile"));
      };

      if (this.availableSlots > 0) {
        // Fast path: slot available
        grant();
      } else {
        // Slow path: queue the request with timeout
        const queuedTask: QueuedTask = {
          priority,
          resolver: (release) => {
            const expiresAt = Date.now() + this.lockTTL;
            const entry: CompileSlotEntry = {
              priority,
              acquiredAt: Date.now(),
              expiresAt,
              owner: ownerId,
            };
            this.activeSlots.set(ownerId, entry);
            this.availableSlots--;
            resolve(release);
          },
          owner,
          createdAt: Date.now(),
        };

        this.compileQueue.push(queuedTask);
        this.compileQueue.sort((a, b) => a.priority - b.priority); // Sort by priority
        
        this.logger.debug(
          `⏳ Compile slot queued for ${owner} (queue: ${this.compileQueue.length}, active: ${this.activeSlots.size})`,
        );

        // Timeout handling
        const timeoutHandle = setTimeout(() => {
          const idx = this.compileQueue.indexOf(queuedTask);
          if (idx >= 0) {
            this.compileQueue.splice(idx, 1);
            reject(new Error(`Compile slot timeout after ${timeoutMs}ms for ${owner}`));
          }
        }, timeoutMs);

        // Wrap resolver to clear timeout on success
        const originalResolver = queuedTask.resolver;
        queuedTask.resolver = (release) => {
          clearTimeout(timeoutHandle);
          originalResolver(release);
        };
      }
    });
  }

  /**
   * Acquire a cache lock (read or write)
   * Read locks: multiple readers allowed
   * Write locks: exclusive, no other locks allowed
   */
  async acquireCacheLock(
    key: string,
    lockType: "read" | "write" = "read",
    timeoutMs: number = 30000,
    owner: string = "unknown",
  ): Promise<() => Promise<void>> {
    this.stats.totalCacheLockRequests++;
    const ownerId = `${owner}-${Date.now()}-${Math.random()}`;

    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        const locks = this.cacheLocks.get(key) || [];
        const now = Date.now();

        // Filter out expired locks
        const activeLocks = locks.filter(l => l.expiresAt > now);
        
        if (lockType === "read") {
          // Read lock: allowed if no write locks exist
          const hasWriteLock = activeLocks.some(l => l.lockType === "write");
          if (!hasWriteLock) {
            const entry: CacheLockEntry = {
              key,
              lockType: "read",
              acquiredAt: now,
              expiresAt: now + this.lockTTL,
              owner: ownerId,
            };
            activeLocks.push(entry);
            this.cacheLocks.set(key, activeLocks);
            this.logger.debug(`✓ Read lock acquired for ${key} by ${owner}`);
            
            resolve(this.createCacheLockReleaser(key, ownerId));
            return;
          }
        } else {
          // Write lock: exclusive, no other locks allowed
          if (activeLocks.length === 0) {
            const entry: CacheLockEntry = {
              key,
              lockType: "write",
              acquiredAt: now,
              expiresAt: now + this.lockTTL,
              owner: ownerId,
            };
            this.cacheLocks.set(key, [entry]);
            this.logger.debug(`✓ Write lock acquired for ${key} by ${owner}`);
            
            resolve(this.createCacheLockReleaser(key, ownerId));
            return;
          }
        }

        // Could not acquire, retry after short delay
        setTimeout(tryAcquire, 25);
      };

      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Cache lock timeout (${lockType}) for ${key} after ${timeoutMs}ms`));
      }, timeoutMs);

      // Wrapper to clear timeout on success
      const originalResolve = resolve;
      resolve = (releaser: any) => {
        clearTimeout(timeoutHandle);
        originalResolve(releaser);
      };

      tryAcquire();
    });
  }

  /**
   * Release a compile slot
   */
  private createReleaseFunction(ownerId: string, type: "compile" | "cache"): () => void {
    return () => {
      if (type === "compile") {
        const entry = this.activeSlots.get(ownerId);
        if (entry) {
          this.activeSlots.delete(ownerId);
          this.availableSlots++;
          this.logger.debug(
            `✓ Compile slot released (available: ${this.availableSlots}, active: ${this.activeSlots.size})`,
          );

          // Grant next queued task if any
          if (this.compileQueue.length > 0) {
            const task = this.compileQueue.shift()!;
            task.resolver(this.createReleaseFunction(`${task.owner}-queued-${Date.now()}`, "compile"));
          }
        }
      }
    };
  }

  /**
   * Create a cache lock releaser function
   */
  private createCacheLockReleaser(key: string, ownerId: string): () => Promise<void> {
    return async () => {
      const locks = this.cacheLocks.get(key);
      if (locks) {
        const filteredLocks = locks.filter(l => l.owner !== ownerId);
        if (filteredLocks.length === 0) {
          this.cacheLocks.delete(key);
        } else {
          this.cacheLocks.set(key, filteredLocks);
        }
        this.logger.debug(`✓ Lock released for ${key}`);
      }
    };
  }

  /**
   * Monitor for expired locks and clean them up automatically
   * Prevents deadlocks caused by crashed processes
   */
  private startLockMonitoring(): void {
    if (this.lockCheckInterval) {
      return;
    }

    this.lockCheckInterval = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      // Check compile slots
      for (const [ownerId, slot] of this.activeSlots.entries()) {
        if (slot.expiresAt < now) {
          this.activeSlots.delete(ownerId);
          this.availableSlots++;
          expiredCount++;
          this.logger.warn(`⚠ Compile slot TTL expired for ${slot.owner}, auto-releasing`);
        }
      }

      // Check cache locks
      for (const [key, locks] of this.cacheLocks.entries()) {
        const activeLocks = locks.filter(l => l.expiresAt > now);
        const expiredInKey = locks.length - activeLocks.length;
        expiredCount += expiredInKey;

        if (activeLocks.length === 0) {
          this.cacheLocks.delete(key);
        } else {
          this.cacheLocks.set(key, activeLocks);
        }

        if (expiredInKey > 0) {
          this.logger.warn(`⚠ ${expiredInKey} cache lock(s) TTL expired for ${key}, auto-releasing`);
        }
      }

      if (expiredCount > 0) {
        this.stats.expiredLocks += expiredCount;
        this.stats.deadlocksAvoided++;
      }
    }, this.checkIntervalMs);
  }

  /**
   * Gracefully stop lock monitoring
   */
  stopLockMonitoring(): void {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
      this.lockCheckInterval = null;
    }
  }

  /**
   * Get current gatekeeper statistics for monitoring
   */
  getStats() {
    return {
      maxConcurrentCompiles: this.maxCompileConcurrent,
      availableSlots: this.availableSlots,
      activeCompiles: this.activeSlots.size,
      queuedCompiles: this.compileQueue.length,
      activeCacheLocks: this.cacheLocks.size,
      totalCompileRequests: this.stats.totalCompileSlotRequests,
      totalCacheLockRequests: this.stats.totalCacheLockRequests,
      expiredLocks: this.stats.expiredLocks,
      deadlocksAvoided: this.stats.deadlocksAvoided,
    };
  }

  /**
   * Gracefully drain all queues and wait for completion
   */
  async drain(): Promise<void> {
    return new Promise((resolve) => {
      const checkEmpty = () => {
        if (
          this.activeSlots.size === 0 &&
          this.compileQueue.length === 0 &&
          this.cacheLocks.size === 0
        ) {
          resolve();
        } else {
          setTimeout(checkEmpty, 100);
        }
      };
      checkEmpty();
    });
  }

  /**
   * Reset gatekeeper state (for testing)
   */
  reset(): void {
    this.activeSlots.clear();
    this.compileQueue = [];
    this.cacheLocks.clear();
    this.availableSlots = this.maxCompileConcurrent;
    this.stats = {
      totalCompileSlotRequests: 0,
      totalCacheLockRequests: 0,
      expiredLocks: 0,
      deadlocksAvoided: 0,
    };
    this.logger.info("UnifiedGatekeeper reset");
  }
}

/**
 * Global singleton instance
 */
let unifiedGatekeeperInstance: UnifiedGatekeeper | null = null;

export function getUnifiedGatekeeper(maxConcurrent?: number): UnifiedGatekeeper {
  if (!unifiedGatekeeperInstance) {
    unifiedGatekeeperInstance = new UnifiedGatekeeper(maxConcurrent);
  }
  return unifiedGatekeeperInstance;
}

export function resetUnifiedGatekeeper(): void {
  const instance = unifiedGatekeeperInstance;
  if (instance) {
    instance.stopLockMonitoring();
  }
  unifiedGatekeeperInstance = null;
}
