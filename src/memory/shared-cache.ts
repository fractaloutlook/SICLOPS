import { EventEmitter } from 'events';

/**
 * SharedMemoryCache: Three-bucket LRU cache for agent context sharing
 *
 * PURPOSE:
 * Allows agents to share context and decisions across multiple runs, preventing
 * re-discussion of settled topics and maintaining institutional knowledge.
 *
 * ARCHITECTURE:
 * - Three priority buckets with different TTLs and eviction policies
 * - Token-aware capacity management (prevents memory overflow)
 * - LRU (Least Recently Used) eviction when capacity exceeded
 * - Comprehensive event logging for observability
 *
 * BUCKETS:
 * - transient: Temporary context for current task (TTL: 1 hour, auto-evict)
 *   Use for: Work-in-progress notes, temporary findings
 *
 * - decision: Team consensus outcomes (TTL: 24 hours, auto-evict)
 *   Use for: Voted decisions, API designs, architecture choices
 *
 * - sensitive: Long-term critical data (TTL: 7 days, manual-evict only)
 *   Use for: Security findings, user preferences, credentials metadata
 *   Quota: 5000 tokens (10% of total), never auto-evicted
 *
 * CAPACITY:
 * - Hard cap: 50,000 tokens total
 * - When full, evicts LRU entries from transient/decision (never sensitive)
 * - Throws error if sensitive bucket full or total capacity exceeded
 *
 * USAGE EXAMPLE:
 *
 * // After team reaches consensus on REST API design
 * cache.store(
 *   'rest_api_design_v2',
 *   JSON.stringify({ endpoints: [...], auth: 'JWT' }),
 *   'decision',
 *   'Team consensus from run #15: Chose REST over GraphQL'
 * );
 *
 * // In next run, check if already decided
 * const cached = cache.retrieve('rest_api_design_v2');
 * if (cached) {
 *   const design = JSON.parse(cached as string);
 *   console.log('Already decided:', design);
 * } else {
 *   // Need to discuss and decide
 * }
 *
 * INTEGRATION STATUS:
 * - Currently instantiated by Orchestrator (orchestrator.ts:37)
 * - Loaded with previous decisions on context load (orchestrator.ts:73-83)
 * - Stores new decisions at cycle end (orchestrator.ts:817-828)
 * - NOT YET exposed to agents directly (no agent API for store/retrieve)
 *
 * FUTURE ENHANCEMENTS:
 * - Add agent-facing API to store/retrieve during turns
 * - Persistence to disk across process restarts
 * - Query/search capabilities across cached entries
 * - Export to JSON for human inspection
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
   * Store a value in the cache with automatic token estimation and eviction.
   *
   * @param key - Unique identifier for this cached value
   * @param value - Any JSON-serializable value (string, object, array, etc.)
   * @param bucket - Which bucket to store in: 'transient' | 'decision' | 'sensitive'
   * @param reason - Optional human-readable note explaining why this was cached
   *                 (for observability only, never affects eviction logic)
   *
   * @throws Error if sensitive bucket quota exceeded or total capacity can't be freed
   *
   * @example
   * // Store a team decision
   * cache.store(
   *   'chosen_database',
   *   { type: 'PostgreSQL', reason: 'Better JSON support' },
   *   'decision',
   *   'Team vote: 4/5 agreed on Postgres over MySQL'
   * );
   *
   * @example
   * // Store temporary work context
   * cache.store(
   *   'current_refactor_status',
   *   'Halfway through auth module - need to finish token validation',
   *   'transient'
   * );
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
   * Retrieve a value from the cache, checking TTL expiration.
   *
   * @param key - The key to look up
   * @returns The cached value, or null if not found/expired
   *
   * Note: Automatically updates lastAccessedAt for LRU tracking
   *
   * @example
   * // Check if team already decided on a database
   * const dbChoice = cache.retrieve('chosen_database');
   * if (dbChoice) {
   *   console.log('Already decided:', dbChoice);
   *   // Skip re-discussion
   * } else {
   *   // Need to discuss and vote
   * }
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
   * Manually evict a key from the cache.
   *
   * This is the ONLY way to remove items from the 'sensitive' bucket
   * (they never auto-evict on TTL or capacity pressure).
   *
   * @param key - The key to remove
   * @returns true if evicted, false if key didn't exist
   *
   * @example
   * // Remove sensitive data after use
   * cache.evict('api_credentials_temp');
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
   * Get current cache statistics for monitoring and debugging.
   *
   * @returns Object containing:
   *   - totalTokens: Total tokens across all buckets
   *   - entryCount: Total number of cached entries
   *   - bucketStats: Per-bucket breakdown of tokens and entry counts
   *
   * @example
   * const stats = cache.getStats();
   * console.log(`Cache using ${stats.totalTokens}/50000 tokens`);
   * console.log(`Decisions cached: ${stats.bucketStats.decision.entries}`);
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
    // Use unref() so the interval doesn't prevent process exit
    const interval = setInterval(() => {
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

    // Don't let this interval prevent the process from exiting
    interval.unref();
  }
}
