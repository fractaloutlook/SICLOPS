/**
 * SharedMemoryCache - Three-Bucket LRU Cache for Agent Context Sharing
 * 
 * Purpose: Enable agents to share context across runs with token-aware caching,
 * preventing memory overflow while maintaining decision context.
 * 
 * Design:
 * - Three classification buckets: transient, decision, sensitive
 * - LRU (Least Recently Used) eviction within each bucket
 * - TTL (Time To Live) per bucket type
 * - 50k token hard cap total
 * - Sensitive bucket: 10% (~5k tokens), never auto-evicts
 * - Comprehensive eviction logging for observability
 */

import { EventEmitter } from 'events';

interface CacheEntry<T> {
  key: string;
  value: T;
  bucket: BucketType;
  tokens: number;
  createdAt: number;
  lastAccessedAt: number;
  reason?: string; // Documentation only - NEVER used for eviction logic
}

type BucketType = 'transient' | 'decision' | 'sensitive';

interface BucketConfig {
  maxTokens: number;
  ttlMs: number;
  autoEvict: boolean;
}

interface CacheStats {
  totalTokens: number;
  entriesByBucket: Record<BucketType, number>;
  tokensByBucket: Record<BucketType, number>;
  hitRate: number;
  evictionLog: Array<{
    timestamp: number;
    key: string;
    bucket: BucketType;
    reason: string;
    tokensFreed: number;
  }>;
}

export class SharedMemoryCache extends EventEmitter {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private bucketConfigs: Record<BucketType, BucketConfig>;
  private totalMaxTokens = 50000;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    evictionLog: [] as Array<{
      timestamp: number;
      key: string;
      bucket: BucketType;
      reason: string;
      tokensFreed: number;
    }>,
  };

  constructor() {
    super();

    // Bucket configuration with TTLs and capacity
    this.bucketConfigs = {
      transient: {
        maxTokens: 20000, // 40% of total
        ttlMs: 3600000, // 1 hour
        autoEvict: true,
      },
      decision: {
        maxTokens: 25000, // 50% of total
        ttlMs: 86400000, // 24 hours
        autoEvict: true,
      },
      sensitive: {
        maxTokens: 5000, // 10% of total
        ttlMs: 604800000, // 7 days
        autoEvict: false, // Manual eviction only
      },
    };
  }

  /**
   * Store a value in the cache with optional reason for documentation.
   * Reason field is strictly observational - never influences eviction logic.
   */
  store<T>(
    key: string,
    value: T,
    bucket: BucketType,
    reason?: string
  ): void {
    const tokens = this.estimateTokens(value);

    if (tokens > this.bucketConfigs[bucket].maxTokens) {
      const error = `Value exceeds bucket capacity: ${tokens} tokens > ${this.bucketConfigs[bucket].maxTokens} max`;
      this.log('STORE_FAILED', { key, bucket, reason, error, tokens });
      throw new Error(error);
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict if necessary to make room
    this.ensureCapacity(bucket, tokens);

    const entry: CacheEntry<T> = {
      key,
      value,
      bucket,
      tokens,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      reason,
    };

    this.cache.set(key, entry);
    this.log('STORE', { key, bucket, reason, tokens });
  }

  /**
   * Retrieve a value from the cache.
   * Updates LRU timestamp on successful retrieval.
   */
  retrieve<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.log('RETRIEVE_MISS', { key });
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.createdAt;
    const config = this.bucketConfigs[entry.bucket];
    if (age > config.ttlMs) {
      this.cache.delete(key);
      this.log('RETRIEVE_EXPIRED', {
        key,
        bucket: entry.bucket,
        ageMs: age,
        ttlMs: config.ttlMs,
        tokens: entry.tokens,
      });
      this.stats.misses++;
      return null;
    }

    // Update LRU timestamp
    entry.lastAccessedAt = Date.now();
    this.stats.hits++;
    this.log('RETRIEVE_HIT', { key, bucket: entry.bucket, ageMs: age });

    return entry.value as T;
  }

  /**
   * Manually evict a key from the cache.
   * Sensitive bucket requires explicit eviction.
   */
  evict(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      this.log('EVICT_NOT_FOUND', { key });
      return false;
    }

    this.cache.delete(key);
    this.stats.evictions++;
    this.recordEviction(
      key,
      entry.bucket,
      'manual_eviction',
      entry.tokens
    );

    return true;
  }

  /**
   * Get cache statistics and eviction history.
   */
  getStats(): CacheStats {
    const stats: CacheStats = {
      totalTokens: 0,
      entriesByBucket: {
        transient: 0,
        decision: 0,
        sensitive: 0,
      },
      tokensByBucket: {
        transient: 0,
        decision: 0,
        sensitive: 0,
      },
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      evictionLog: this.stats.evictionLog,
    };

    for (const entry of this.cache.values()) {
      stats.totalTokens += entry.tokens;
      stats.entriesByBucket[entry.bucket]++;
      stats.tokensByBucket[entry.bucket] += entry.tokens;
    }

    return stats;
  }

  /**
   * PRIVATE: Ensure bucket has capacity for incoming value.
   * Uses LRU eviction strategy - removes least recently used items first.
   * Never auto-evicts from sensitive bucket.
   */
  private ensureCapacity(bucket: BucketType, requiredTokens: number): void {
    const config = this.bucketConfigs[bucket];
    const bucketEntries = Array.from(this.cache.values()).filter(
      (e) => e.bucket === bucket
    );

    let bucketTokens = bucketEntries.reduce((sum, e) => sum + e.tokens, 0);

    // Check if we need to evict from this bucket
    if (bucketTokens + requiredTokens > config.maxTokens) {
      if (!config.autoEvict && bucket === 'sensitive') {
        throw new Error(
          `Sensitive bucket full: ${bucketTokens} + ${requiredTokens} > ${config.maxTokens}`
        );
      }

      // Sort by LRU (least recently used first)
      bucketEntries.sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt
      );

      // Evict until we have space
      for (const entry of bucketEntries) {
        if (bucketTokens + requiredTokens <= config.maxTokens) break;

        this.cache.delete(entry.key);
        bucketTokens -= entry.tokens;
        this.stats.evictions++;
        this.recordEviction(
          entry.key,
          bucket,
          'lru_eviction_bucket_full',
          entry.tokens
        );
      }
    }

    // Check total cache capacity
    const totalTokens = Array.from(this.cache.values()).reduce(
      (sum, e) => sum + e.tokens,
      0
    );

    if (totalTokens + requiredTokens > this.totalMaxTokens) {
      // Aggressive eviction: remove LRU items from non-sensitive buckets
      const evictableEntries = Array.from(this.cache.values())
        .filter((e) => e.bucket !== 'sensitive')
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      let currentTotal = totalTokens;
      for (const entry of evictableEntries) {
        if (currentTotal + requiredTokens <= this.totalMaxTokens) break;

        this.cache.delete(entry.key);
        currentTotal -= entry.tokens;
        this.stats.evictions++;
        this.recordEviction(
          entry.key,
          entry.bucket,
          'lru_eviction_total_capacity',
          entry.tokens
        );
      }

      // Last resort: check if still over capacity
      if (currentTotal + requiredTokens > this.totalMaxTokens) {
        throw new Error(
          `Cannot allocate ${requiredTokens} tokens. Total capacity exceeded.`
        );
      }
    }
  }

  /**
   * PRIVATE: Record eviction event for observability.
   */
  private recordEviction(
    key: string,
    bucket: BucketType,
    reason: string,
    tokens: number
  ): void {
    const entry = {
      timestamp: Date.now(),
      key,
      bucket,
      reason,
      tokensFreed: tokens,
    };

    this.stats.evictionLog.push(entry);
    // Keep last 1000 evictions in memory
    if (this.stats.evictionLog.length > 1000) {
      this.stats.evictionLog.shift();
    }

    this.log('EVICTION_RECORDED', entry);
  }

  /**
   * PRIVATE: Estimate token count for a value.
   * Rough heuristic: ~1 token per 4 characters for strings,
   * recursive estimation for objects.
   */
  private estimateTokens(value: any): number {
    if (typeof value === 'string') {
      return Math.ceil(value.length / 4);
    }

    if (typeof value === 'number') {
      return 1;
    }

    if (typeof value === 'boolean') {
      return 1;
    }

    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateTokens(item), 0);
    }

    if (typeof value === 'object' && value !== null) {
      return Object.values(value).reduce(
        (sum, v) => sum + this.estimateTokens(v),
        0
      );
    }

    return 1;
  }

  /**
   * PRIVATE: Emit observability logs.
   */
  private log(event: string, data: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
    };

    console.log(`[SharedMemoryCache] ${JSON.stringify(logEntry)}`);
    this.emit('log', logEntry);
  }
}

export default SharedMemoryCache;
