import { EventEmitter } from 'events';

/**
 * SharedMemoryCache: Three-bucket LRU cache for agent context sharing
 * - Transient: Short-lived context (TTL: 1 hour)
 * - Decision: Important decisions (TTL: 24 hours)
 * - Sensitive: Sensitive data, manual-only eviction (TTL: 7 days)
 * Hard cap: 50k tokens total. Sensitive gets 10% (~5k tokens).
 */

type CacheBucket = 'transient' | 'decision' | 'sensitive';

interface CacheEntry {
  key: string;
  value: unknown;
  bucket: CacheBucket;
  tokens: number;
  createdAt: number;
  lastAccessedAt: number;
  reason?: string; // Documentation only, NEVER used for eviction logic
}

interface CacheStats {
  totalTokens: number;
  entryCount: number;
  bucketStats: {
    transient: { tokens: number; entries: number };
    decision: { tokens: number; entries: number };
    sensitive: { tokens: number; entries: number };
  };
}

export class SharedMemoryCache extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly MAX_TOKENS = 50000;
  private readonly SENSITIVE_QUOTA = 5000; // 10% of 50k
  private readonly TTL = {
    transient: 1 * 60 * 60 * 1000, // 1 hour
    decision: 24 * 60 * 60 * 1000, // 24 hours
    sensitive: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  constructor() {
    super();
    // Start cleanup loop to evict expired entries
    this.startCleanupLoop();
  }

  /**
   * Store a value in the cache with token awareness
   */
  store(key: string, value: unknown, bucket: CacheBucket, reason?: string): void {
    const tokens = this.estimateTokens(value);

    // Remove old entry if exists
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.emit('log', {
        event: 'store_replace',
        key,
        bucket,
        oldTokens: oldEntry.tokens,
        newTokens: tokens,
        reason,
        timestamp: Date.now(),
      });
    }

    // Check if this violates sensitive bucket quota
    if (bucket === 'sensitive') {
      const sensitiveTokens = this.getTokensInBucket('sensitive');
      if (sensitiveTokens + tokens > this.SENSITIVE_QUOTA) {
        this.emit('log', {
          event: 'store_rejected',
          key,
          bucket,
          tokens,
          reason: 'Sensitive bucket quota exceeded',
          timestamp: Date.now(),
        });
        throw new Error(
          `Cannot store ${tokens} tokens in sensitive bucket (quota: ${this.SENSITIVE_QUOTA}, used: ${sensitiveTokens})`
        );
      }
    }

    const entry: CacheEntry = {
      key,
      value,
      bucket,
      tokens,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      reason,
    };

    this.cache.set(key, entry);

    // Evict if necessary
    this.enforceCapacity();

    this.emit('log', {
      event: 'store',
      key,
      bucket,
      tokens,
      reason,
      totalTokens: this.getTotalTokens(),
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieve a value from the cache
   */
  retrieve(key: string): unknown | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.emit('log', {
        event: 'retrieve_miss',
        key,
        timestamp: Date.now(),
      });
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.createdAt;
    if (age > this.TTL[entry.bucket]) {
      this.cache.delete(key);
      this.emit('log', {
        event: 'retrieve_expired',
        key,
        bucket: entry.bucket,
        ageMs: age,
        ttlMs: this.TTL[entry.bucket],
        timestamp: Date.now(),
      });
      return null;
    }

    // Update LRU timestamp
    entry.lastAccessedAt = Date.now();

    this.emit('log', {
      event: 'retrieve_hit',
      key,
      bucket: entry.bucket,
      tokens: entry.tokens,
      ageMs: age,
      timestamp: Date.now(),
    });

    return entry.value;
  }

  /**
   * Manually evict a key (useful for sensitive data)
   */
  evict(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);

    this.emit('log', {
      event: 'evict_manual',
      key,
      bucket: entry.bucket,
      tokens: entry.tokens,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const stats: CacheStats = {
      totalTokens: 0,
      entryCount: this.cache.size,
      bucketStats: {
        transient: { tokens: 0, entries: 0 },
        decision: { tokens: 0, entries: 0 },
        sensitive: { tokens: 0, entries: 0 },
      },
    };

    for (const entry of this.cache.values()) {
      stats.totalTokens += entry.tokens;
      stats.bucketStats[entry.bucket].tokens += entry.tokens;
      stats.bucketStats[entry.bucket].entries += 1;
    }

    return stats;
  }

  // ============== PRIVATE HELPERS ==============

  private getTotalTokens(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.tokens;
    }
    return total;
  }

  private getTokensInBucket(bucket: CacheBucket): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      if (entry.bucket === bucket) {
        total += entry.tokens;
      }
    }
    return total;
  }

  private estimateTokens(value: unknown): number {
    // Rough estimate: 1 token ≈ 4 characters
    const str = JSON.stringify(value);
    return Math.ceil(str.length / 4);
  }

  private enforceCapacity(): void {
    const totalTokens = this.getTotalTokens();

    if (totalTokens <= this.MAX_TOKENS) {
      return; // Within capacity
    }

    // Evict LRU entries from non-sensitive buckets until under capacity
    const entriesToEvict = Array.from(this.cache.values())
      .filter((e) => e.bucket !== 'sensitive')
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    let currentTotal = totalTokens;
    for (const entry of entriesToEvict) {
      if (currentTotal <= this.MAX_TOKENS) break;

      this.cache.delete(entry.key);
      currentTotal -= entry.tokens;

      this.emit('log', {
        event: 'evict_lru',
        key: entry.key,
        bucket: entry.bucket,
        tokens: entry.tokens,
        reason: 'LRU eviction (capacity exceeded)',
        timestamp: Date.now(),
      });
    }

    // Last resort: if still over capacity and sensitive entries exist, warn
    if (this.getTotalTokens() > this.MAX_TOKENS) {
      this.emit('log', {
        event: 'capacity_warning',
        totalTokens: this.getTotalTokens(),
        maxTokens: this.MAX_TOKENS,
        reason: 'Unable to evict below capacity (sensitive entries locked)',
        timestamp: Date.now(),
      });
    }
  }

  private startCleanupLoop(): void {
    // Run cleanup every 5 minutes
    setInterval(() => {
      const now = Date.now();
      let evicted = 0;

      for (const [key, entry] of this.cache.entries()) {
        const age = now - entry.createdAt;
        if (age > this.TTL[entry.bucket]) {
          this.cache.delete(key);
          evicted++;

          this.emit('log', {
            event: 'evict_ttl',
            key,
            bucket: entry.bucket,
            tokens: entry.tokens,
            ageMs: age,
            ttlMs: this.TTL[entry.bucket],
            timestamp: Date.now(),
          });
        }
      }

      if (evicted > 0) {
        this.emit('log', {
          event: 'cleanup_cycle',
          evictedCount: evicted,
          remainingTokens: this.getTotalTokens(),
          timestamp: Date.now(),
        });
      }
    }, 5 * 60 * 1000);
  }
}
