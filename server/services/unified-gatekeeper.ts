/**
 * Unified Gatekeeper - Concurrency & Cache Management
 * 
 * Centralized system for:
 * 1. Compile slot allocation (semaphore-based)
 * 2. Cache Read-Write locking (multiple readers, single writer)
 * 3. TTL-based deadlock prevention (auto-release after timeout)
 * 4. Priority queuing (system checks prioritized over regular tasks)
 * 5. Event-driven architecture (eliminates polling overhead)
 * 
 * Replaces the previous dual-gatekeeper pattern with atomic, deadlock-safe operations.
 * Performance: O(1) event notification instead of O(n) polling overhead.
 */

import { Logger } from "@shared/logger";
import { cpus } from "os";
import { EventEmitter } from "events";

// Priority levels for task queuing
export enum TaskPriority {
  HIGH = 0,    // System health checks, cleanup, user interactions
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
  ownerId: string;
  owner: string;
  createdAt: number;
}

/**
 * Calculate adaptive concurrency based on CPU count
 * Formula: max(1, cpuCount - 1)
 * Examples:
 *   2-core (RasPi):  max(1, 2-1) = 1
 *   4-core desktop:  max(1, 4-1) = 3
 *   8-core workstation: max(1, 8-1) = 7
 *   16-core server:  max(1, 16-1) = 15
 */
function calculateOptimalConcurrency(): number {
  try {
    const numCores = cpus().length;
    return Math.max(1, numCores - 1);
  } catch {
    return 4; // Fallback default
  }
}

export class UnifiedGatekeeper extends EventEmitter {
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
  
  // Queue size limit to prevent unbounded memory growth under extreme load
  private readonly maxQueueSize = 500;
  
  private logger = new Logger("UnifiedGatekeeper");
  
  // Statistics
  private stats = {
    totalCompileSlotRequests: 0,
    totalCacheLockRequests: 0,
    expiredLocks: 0,
    deadlocksAvoided: 0,
  };

  constructor(maxConcurrent?: number) {
    super();
    
    // Allow unlimited event listeners for high-contention scenarios (200+ waiters)
    this.setMaxListeners(0);
    
    // In worker threads, disable gatekeeper since the worker pool controls concurrency
    const isWorkerThread = process.env.COMPILE_GATEKEEPER_DISABLED === "true";
    
    if (isWorkerThread) {
      this.maxCompileConcurrent = Infinity;
      this.availableSlots = Infinity;
      this.logger.info("UnifiedGatekeeper in worker thread (pool-controlled)");
    } else {
      // Priority 1: Explicit env override
      // Priority 2: Constructor parameter
      // Priority 3: CPU-adaptive calculation
      if (process.env.COMPILE_MAX_CONCURRENT) {
        this.maxCompileConcurrent = parseInt(process.env.COMPILE_MAX_CONCURRENT, 10);
      } else if (maxConcurrent) {
        this.maxCompileConcurrent = maxConcurrent;
      } else {
        this.maxCompileConcurrent = calculateOptimalConcurrency();
      }
      
      this.availableSlots = this.maxCompileConcurrent;
      const numCores = cpus().length;
      this.logger.info(
        `UnifiedGatekeeper initialized: max ${this.maxCompileConcurrent} concurrent compiles ` +
        `(${numCores} CPU cores detected, formula: max(1, cores-1))`,
      );
    }
    
    // Start periodic lock expiration check
    this.startLockMonitoring();
  }

  /**
   * Acquire a compile slot with HIGH priority (for user-initiated simulations)
   * Ensures interactive tasks get prompt access
   */
  async acquireCompileSlotHighPriority(owner: string = "simulation-start"): Promise<() => void> {
    return this.acquireCompileSlot(TaskPriority.HIGH, 30000, owner);
  }

  /**
   * Acquire a compile slot (internal method used by all priorities)
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
          ownerId,
          owner,
          createdAt: Date.now(),
        };

        // Reject if queue is full to prevent unbounded memory growth
        if (this.compileQueue.length >= this.maxQueueSize) {
          reject(new Error(
            `Compile queue full (${this.maxQueueSize} pending). ` +
            `Try again later. Active: ${this.activeSlots.size}, Queued: ${this.compileQueue.length}`,
          ));
          return;
        }

        // Priority-aware insertion (O(n) instead of O(n log n) full sort)
        let insertIdx = this.compileQueue.length;
        for (let i = 0; i < this.compileQueue.length; i++) {
          if (queuedTask.priority < this.compileQueue[i].priority) {
            insertIdx = i;
            break;
          }
        }
        this.compileQueue.splice(insertIdx, 0, queuedTask);
        
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
   * Uses event-driven approach - no polling overhead
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
      let timeoutHandle: NodeJS.Timeout | null = null;
      let eventListener: (() => void) | null = null;

      const tryAcquire = (): boolean => {
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
            
            // Cleanup
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (eventListener) this.off(`cache_lock_released:${key}`, eventListener);
            
            resolve(this.createCacheLockReleaser(key, ownerId));
            return true;
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
            
            // Cleanup
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (eventListener) this.off(`cache_lock_released:${key}`, eventListener);
            
            resolve(this.createCacheLockReleaser(key, ownerId));
            return true;
          }
        }

        return false;
      };

      // Try immediate acquisition
      if (tryAcquire()) {
        return;
      }

      // Set up event-driven waiting (no polling)
      const eventName = `cache_lock_released:${key}`;
      eventListener = () => {
        tryAcquire(); // Event fires when lock might be available
      };
      
      this.on(eventName, eventListener);

      // Timeout handling with cleanup
      timeoutHandle = setTimeout(() => {
        if (eventListener) {
          this.off(eventName, eventListener);
        }
        reject(new Error(`Cache lock timeout (${lockType}) for ${key} after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Release a compile slot
   * Emits event for monitoring and triggers next queued task
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

          // Emit event for monitoring (event-driven architecture)
          this.emit("slot_released");

          // Grant next queued task if any
          if (this.compileQueue.length > 0) {
            const task = this.compileQueue.shift()!;
            try {
              // Use task.ownerId so activeSlots key matches the release function key
              task.resolver(this.createReleaseFunction(task.ownerId, "compile"));
            } catch (err) {
              // If resolver throws, the slot was already incremented above
              // but never decremented by the resolver — reclaim it
              this.logger.error(
                `Failed to grant queued slot to ${task.owner}: ${err instanceof Error ? err.message : String(err)}`,
              );
              // Slot remains available (already incremented), try next task
              if (this.compileQueue.length > 0) {
                const next = this.compileQueue.shift()!;
                try {
                  next.resolver(this.createReleaseFunction(next.ownerId, "compile"));
                } catch {
                  // Silently drop — slot stays available
                }
              }
            }
          }
        }
      }
    };
  }

  /**
   * Create a cache lock releaser function
   * Emits event to wake up waiting tasks (event-driven, no polling)
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
        
        // Emit event to wake up waiting tasks (O(1) notification instead of polling)
        this.emit(`cache_lock_released:${key}`);
      }
    };
  }

  /**
   * Monitor for expired locks and clean them up automatically
   * Prevents deadlocks caused by crashed processes
   * Emits events to wake up waiting tasks
   */
  private startLockMonitoring(): void {
    if (this.lockCheckInterval) {
      return;
    }

    this.lockCheckInterval = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;
      const releasedKeys = new Set<string>();

      // Check compile slots
      for (const [ownerId, slot] of this.activeSlots.entries()) {
        if (slot.expiresAt < now) {
          this.activeSlots.delete(ownerId);
          this.availableSlots++;
          expiredCount++;
          this.logger.warn(`⚠ Compile slot TTL expired for ${slot.owner}, auto-releasing`);
          
          // Emit event to wake up queued tasks
          this.emit("slot_released");
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
          releasedKeys.add(key);
        }
      }

      // Emit events for all released cache locks (O(1) per key)
      for (const key of releasedKeys) {
        this.emit(`cache_lock_released:${key}`);
      }

      if (expiredCount > 0) {
        this.stats.expiredLocks += expiredCount;
        this.stats.deadlocksAvoided++;
      }
    }, this.checkIntervalMs);
  }

  /**
   * Gracefully stop lock monitoring and cleanup event listeners
   */
  stopLockMonitoring(): void {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
      this.lockCheckInterval = null;
    }
    
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
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
   * Removes all event listeners to prevent memory leaks
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
    
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
    
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
