/**
 * SharedMemoryCache - Three-Bucket LRU Cache with Token Awareness
 * 
 * Purpose: Help agents share context across runs with intelligent eviction.
 * Design: Three classification buckets (transient/decision/sensitive) with LRU eviction.
 * Constraints:
 * - 50k token hard cap total
 * - Sensitive bucket: 10% (~5k tokens), never auto-evicts
 * - Reason field: documentation-only, NEVER used for eviction logic
 * - Aggressive logging from day one
 */

export type BucketType = 'transient' | 'decision' | 'sensitive';

export interface CacheEntry {
  key: string;
  value: string;
  bucket: BucketType;
  tokens: number;
  reason?: string; // Documentation only - never used in eviction logic
  timestamp: number; // For LRU tracking
  lastAccessed: number; // For LRU tracking
  ttl: number; // Time to live in milliseconds
}

export interface CacheStats {
  totalEntries: number;
  totalTokens: number;
  bucketStats: {
    transient: { entries: number; tokens: number };
    decision: { entries: number; tokens: number };
    sensitive: { entries: number; tokens: number };
  };
  evictionCount: number;
  hitCount: number;
  missCount: number;
}

export class SharedMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly MAX_TOKENS = 50000;
  private readonly SENSITIVE_TOKENS = 5000; // 10% of total

  // TTL configurations (in milliseconds)
  private readonly TTL_CONFIG = {
    transient: 60 * 60 * 1000, // 1 hour
    decision: 24 * 60 * 60 * 1000, // 24 hours
    sensitive: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  // Stats tracking
  private evictionCount = 0;
  private hitCount = 0;
  private missCount = 0;

  constructor() {
    this.log('[SharedMemoryCache] Initialized with MAX_TOKENS:', this.MAX_TOKENS);
  }

  /**
   * Log only if VERBOSE_CACHE_LOGGING is enabled
   */
  private log(...args: any[]): void {
    if (process.env.VERBOSE_CACHE_LOGGING === 'true') {
      console.log(...args);
    }
  }

  /**
   * Warn only if VERBOSE_CACHE_LOGGING is enabled
   */
  private warn(...args: any[]): void {
    if (process.env.VERBOSE_CACHE_LOGGING === 'true') {
      console.warn(...args);
    }
  }
  
  /**
   * Store a value in the cache with classification and optional reason.
   * 
   * @param key - Unique identifier for the entry
   * @param value - Content to cache
   * @param bucket - Classification bucket (transient/decision/sensitive)
   * @param reason - Optional documentation for why this is being cached (not used in eviction)
   */
  store(key: string, value: string, bucket: BucketType, reason?: string): void {
    const tokens = this.estimateTokens(value);
    const now = Date.now();
    
    const entry: CacheEntry = {
      key,
      value,
      bucket,
      tokens,
      reason,
      timestamp: now,
      lastAccessed: now,
      ttl: this.TTL_CONFIG[bucket],
    };
    
    // Check if storing in sensitive bucket would exceed its allocation
    if (bucket === 'sensitive') {
      const currentSensitiveTokens = this.getBucketTokens('sensitive');
      if (currentSensitiveTokens + tokens > this.SENSITIVE_TOKENS) {
        this.warn(
          `[SharedMemoryCache] STORE REJECTED: Sensitive bucket full. ` +
          `Current: ${currentSensitiveTokens}, Requested: ${tokens}, Max: ${this.SENSITIVE_TOKENS}. ` +
          `Key: ${key}`
        );
        return;
      }
    }
    
    // Remove existing entry if updating
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.log(
        `[SharedMemoryCache] UPDATE: ${key} | Bucket: ${bucket} | ` +
        `Tokens: ${oldEntry.tokens} → ${tokens}${reason ? ` | Reason: ${reason}` : ''}`
      );
    } else {
      this.log(
        `[SharedMemoryCache] STORE: ${key} | Bucket: ${bucket} | ` +
        `Tokens: ${tokens}${reason ? ` | Reason: ${reason}` : ''}`
      );
    }
    
    this.cache.set(key, entry);
    
    // Evict entries if necessary (respects sensitive bucket protection)
    this.enforceCapacity();
  }
  
  /**
   * Retrieve a value from the cache.
   * Updates LRU tracking and checks TTL expiration.
   */
  retrieve(key: string): string | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      this.log(`[SharedMemoryCache] MISS: ${key}`);
      return null;
    }
    
    // Check if entry has expired
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.log(
        `[SharedMemoryCache] EXPIRED: ${key} | Bucket: ${entry.bucket} | ` +
        `Age: ${Math.round((now - entry.timestamp) / 1000 / 60)} minutes`
      );
      this.cache.delete(key);
      this.evictionCount++;
      this.missCount++;
      return null;
    }
    
    // Update LRU tracking
    entry.lastAccessed = now;
    this.hitCount++;
    
    this.log(
      `[SharedMemoryCache] HIT: ${key} | Bucket: ${entry.bucket} | ` +
      `Tokens: ${entry.tokens}`
    );
    
    return entry.value;
  }
  
  /**
   * Manually evict an entry from the cache.
   */
  evict(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.log(`[SharedMemoryCache] EVICT FAILED: ${key} not found`);
      return false;
    }
    
    this.log(
      `[SharedMemoryCache] MANUAL EVICT: ${key} | Bucket: ${entry.bucket} | ` +
      `Tokens: ${entry.tokens}`
    );
    
    this.cache.delete(key);
    this.evictionCount++;
    return true;
  }
  
  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const stats: CacheStats = {
      totalEntries: this.cache.size,
      totalTokens: this.getTotalTokens(),
      bucketStats: {
        transient: this.getBucketStats('transient'),
        decision: this.getBucketStats('decision'),
        sensitive: this.getBucketStats('sensitive'),
      },
      evictionCount: this.evictionCount,
      hitCount: this.hitCount,
      missCount: this.missCount,
    };
    
    return stats;
  }
  
  /**
   * Enforce capacity constraints with LRU eviction.
   * NEVER auto-evicts from sensitive bucket.
   */
  private enforceCapacity(): void {
    const totalTokens = this.getTotalTokens();
    
    if (totalTokens <= this.MAX_TOKENS) {
      return; // Under capacity, no eviction needed
    }
    
    this.log(
      `[SharedMemoryCache] CAPACITY EXCEEDED: ${totalTokens}/${this.MAX_TOKENS} tokens. ` +
      `Starting eviction...`
    );
    
    // Sort entries by lastAccessed (oldest first), excluding sensitive bucket
    const evictablEntries = Array.from(this.cache.values())
      .filter(e => e.bucket !== 'sensitive')
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    let tokensToFree = totalTokens - this.MAX_TOKENS;
    let evicted = 0;
    
    for (const entry of evictablEntries) {
      if (tokensToFree <= 0) break;
      
      this.log(
        `[SharedMemoryCache] AUTO EVICT (LRU): ${entry.key} | ` +
        `Bucket: ${entry.bucket} | Tokens: ${entry.tokens} | ` +
        `Last accessed: ${Math.round((Date.now() - entry.lastAccessed) / 1000 / 60)} minutes ago`
      );
      
      this.cache.delete(entry.key);
      tokensToFree -= entry.tokens;
      evicted++;
      this.evictionCount++;
    }
    
    this.log(
      `[SharedMemoryCache] EVICTION COMPLETE: ${evicted} entries removed, ` +
      `${this.getTotalTokens()}/${this.MAX_TOKENS} tokens remaining`
    );
  }
  
  /**
   * Estimate token count for a string (rough approximation).
   * Using ~4 characters per token as a heuristic.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Get total tokens across all buckets.
   */
  private getTotalTokens(): number {
    return Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.tokens, 0);
  }
  
  /**
   * Get token count for a specific bucket.
   */
  private getBucketTokens(bucket: BucketType): number {
    return Array.from(this.cache.values())
      .filter(e => e.bucket === bucket)
      .reduce((sum, entry) => sum + entry.tokens, 0);
  }
  
  /**
   * Get stats for a specific bucket.
   */
  private getBucketStats(bucket: BucketType): { entries: number; tokens: number } {
    const entries = Array.from(this.cache.values()).filter(e => e.bucket === bucket);
    return {
      entries: entries.length,
      tokens: entries.reduce((sum, e) => sum + e.tokens, 0),
    };
  }
  
  /**
   * Export cache state for persistence.
   */
  exportState(): CacheEntry[] {
    return Array.from(this.cache.values());
  }
  
  /**
   * Import cache state from persistence.
   */
  importState(entries: CacheEntry[]): void {
    this.log(`[SharedMemoryCache] Importing ${entries.length} entries from persistence`);
    
    this.cache.clear();
    
    for (const entry of entries) {
      // Check TTL on import - don't restore expired entries
      const now = Date.now();
      if (now - entry.timestamp <= entry.ttl) {
        this.cache.set(entry.key, entry);
      } else {
        this.log(
          `[SharedMemoryCache] SKIP EXPIRED on import: ${entry.key} | ` +
          `Bucket: ${entry.bucket}`
        );
      }
    }
    
    this.log(
      `[SharedMemoryCache] Import complete: ${this.cache.size} active entries, ` +
      `${this.getTotalTokens()} tokens`
    );
  }
}
