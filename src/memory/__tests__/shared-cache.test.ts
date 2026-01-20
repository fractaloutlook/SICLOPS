/**
 * Test Suite for SharedMemoryCache
 * 
 * Coverage:
 * - Basic store/retrieve operations
 * - Three-bucket classification (transient/decision/sensitive)
 * - LRU eviction behavior
 * - Token capacity enforcement (50k total, 5k sensitive)
 * - TTL expiration
 * - Reason field (documentation-only, never affects eviction)
 * - Sensitive bucket protection (never auto-evicts)
 * - Stats tracking and observability
 */ // Sam: Test run re-triggered by Jordan for verification of SharedMemoryCache changes.
import { SharedMemoryCache, BucketType, CacheEntry, CacheStats } from '../shared-cache';

describe('SharedMemoryCache', () => {
  let cache: SharedMemoryCache;

  beforeAll(() => {
    jest.useFakeTimers(); // Enable fake timers for all tests
  });

  beforeEach(() => {
     cache = new SharedMemoryCache();
    // Enable verbose logging for tests to see what's happening
    process.env.VERBOSE_CACHE_LOGGING = 'true';
    // Suppress console logs during tests
    jest.spyOn(console, 'log').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
  });   afterEach(() => {
     jest.restoreAllMocks();
   });

  afterAll(() => {
    jest.useRealTimers(); // Restore real timers after all tests
  });

  describe('Basic Operations', () => {
    test('should store and retrieve a value', () => {
      cache.store('key1', 'value1', 'transient');
      expect(cache.retrieve('key1')).toBe('value1');
    });

    test('should return null for non-existent key', () => {
      expect(cache.retrieve('nonexistent')).toBeNull();
    });

    test('should update existing key', () => {
      cache.store('key1', 'value1', 'transient');
      cache.store('key1', 'value2', 'transient');
      expect(cache.retrieve('key1')).toBe('value2');
    });

    test('should manually evict an entry', () => {
      cache.store('key1', 'value1', 'transient');
      expect(cache.evict('key1')).toBe(true);
      expect(cache.retrieve('key1')).toBeNull();
    });

    test('should return false when evicting non-existent key', () => {
      expect(cache.evict('nonexistent')).toBe(false);
    });


  });

  describe('Three-Bucket Classification', () => {
    test('should store entries in different buckets', () => {
      cache.store('transient1', 'data', 'transient');
      cache.store('decision1', 'data', 'decision');
      cache.store('sensitive1', 'data', 'sensitive');

      const stats = cache.getStats();
      expect(stats.bucketStats.transient.entries).toBe(1);
      expect(stats.bucketStats.decision.entries).toBe(1);
      expect(stats.bucketStats.sensitive.entries).toBe(1);
    });

    test('should track tokens per bucket', () => {
      // ~250 tokens each (1000 chars / 4)
      const largeValue = 'x'.repeat(1000);
      cache.store('t1', largeValue, 'transient');
      cache.store('d1', largeValue, 'decision');
      cache.store('s1', largeValue, 'sensitive');

      const stats = cache.getStats();
      expect(stats.bucketStats.transient.tokens).toBe(250);
      expect(stats.bucketStats.decision.tokens).toBe(250);
      expect(stats.bucketStats.sensitive.tokens).toBe(250);
    });
  });

  describe('Reason Field (Documentation-Only)', () => {
    test('should accept optional reason parameter', () => {
      cache.store('key1', 'value1', 'transient', 'Important context for agent');
      expect(cache.retrieve('key1')).toBe('value1');
    });

    test('should work without reason parameter', () => {
      cache.store('key1', 'value1', 'transient');
      expect(cache.retrieve('key1')).toBe('value1');
    });

    test('CRITICAL: reason should NOT affect eviction order', () => { // Removed async keyword
      // Fill cache to trigger eviction
      const largeValue = 'x'.repeat(20000); // ~5000 tokens

      // Store with and without reasons - eviction should be LRU only
      cache.store('no-reason', largeValue, 'transient');
      cache.store('with-reason', largeValue, 'transient', 'CRITICAL DATA');
      cache.store('another', largeValue, 'transient');

      // Advance timers to ensure timestamp differs
      jest.advanceTimersByTime(10); // Replaced setTimeout
      // Access 'with-reason' to make it recently used
      cache.retrieve('with-reason');
      // Advance timers again
      jest.advanceTimersByTime(10); // Replaced setTimeout

      // Add more data to trigger eviction - 'no-reason' should evict first (LRU)
      cache.store('trigger1', largeValue, 'transient');
      cache.store('trigger2', largeValue, 'transient');
      cache.store('trigger3', largeValue, 'transient');
      cache.store('trigger4', largeValue, 'transient');
      cache.store('trigger5', largeValue, 'transient');
      cache.store('trigger6', largeValue, 'transient');
      cache.store('trigger7', largeValue, 'transient');
      cache.store('trigger8', largeValue, 'transient');

      // 'with-reason' should still exist (was accessed recently)
      expect(cache.retrieve('with-reason')).not.toBeNull();
      // 'no-reason' should be evicted (least recently used)
      expect(cache.retrieve('no-reason')).toBeNull();
    });
  });

  describe('Token Capacity (50k total)', () => {
    test('should track total tokens correctly', () => {
      const value1000 = 'x'.repeat(1000); // ~250 tokens
      cache.store('k1', value1000, 'transient');
      cache.store('k2', value1000, 'transient');

      const stats = cache.getStats();
      expect(stats.totalTokens).toBe(500);
    });

    test('should evict LRU entries when exceeding 50k tokens', () => {
      const largeValue = 'x'.repeat(20000); // ~5000 tokens each

      // Store 11 entries = 55k tokens (exceeds 50k)
      for (let i = 0; i < 11; i++) {
        cache.store(`key${i}`, largeValue, 'transient');
      }

      const stats = cache.getStats();
      expect(stats.totalTokens).toBeLessThanOrEqual(50000);
      expect(stats.evictionCount).toBeGreaterThan(0);
    });

    test('should evict oldest entries first (LRU)', () => {
      const largeValue = 'x'.repeat(20000); // ~5000 tokens

      cache.store('old1', largeValue, 'transient');
      cache.store('old2', largeValue, 'transient');
      cache.store('recent', largeValue, 'transient');

      // Access 'recent' to update LRU
      cache.retrieve('recent');

      // Trigger eviction by filling cache
      for (let i = 0; i < 10; i++) {
        cache.store(`filler${i}`, largeValue, 'transient');
      }

      // 'recent' should survive longer than 'old1' and 'old2'
      const stats = cache.getStats();
      expect(stats.totalTokens).toBeLessThanOrEqual(50000);
    });

    test('should correctly handle token count increase on update and trigger LRU eviction', () => {
      const smallValue = 'x'.repeat(4000); // ~1000 tokens
      const largeValue = 'x'.repeat(20000); // ~5000 tokens

      // Fill cache with 'old' entries to get close to capacity (45,000 tokens)
      for (let i = 0; i < 9; i++) {
        cache.store(`oldKey${i}`, largeValue, 'transient'); // 9 * 5000 = 45000 tokens
      }
      expect(cache.getStats().totalTokens).toBe(45000);

      // Store a small entry that will be updated later (1000 tokens)
      cache.store('keyToUpdate', smallValue, 'transient'); // Total: 45000 + 1000 = 46000 tokens

      // Update 'keyToUpdate' with a much larger value (6000 tokens)
      // This update should cause total tokens to exceed MAX_TOKENS (46000 - 1000 + 6000 = 51000).
      // Eviction should happen, and 'oldKey0' (LRU) should be removed.
      cache.store('keyToUpdate', 'y'.repeat(24000), 'transient'); // ~6000 tokens

      // Verify that the total tokens are now within limits
      const stats = cache.getStats();
      expect(stats.totalTokens).toBeLessThanOrEqual(50000);

      // 'keyToUpdate' should still exist because it was just accessed/updated (MRU)
      expect(cache.retrieve('keyToUpdate')).not.toBeNull();

      // The oldest entry ('oldKey0') should have been evicted
      expect(cache.retrieve('oldKey0')).toBeNull();

      // Check the eviction count increased
      expect(stats.evictionCount).toBeGreaterThan(0);
    });
  });

  describe('Sensitive Bucket Protection', () => {
    test('should limit sensitive bucket to 5k tokens', () => {
      const largeValue = 'x'.repeat(6000); // ~1500 tokens

      cache.store('s1', largeValue, 'sensitive');
      cache.store('s2', largeValue, 'sensitive');
      cache.store('s3', largeValue, 'sensitive');
      cache.store('s4', largeValue, 'sensitive'); // Total = 6k tokens

      const stats = cache.getStats();
      // Should reject the 4th entry (would exceed 5k limit)
      expect(stats.bucketStats.sensitive.tokens).toBeLessThanOrEqual(5000);
    });

    test('CRITICAL: should NEVER auto-evict from sensitive bucket', () => {
      const largeValue = 'x'.repeat(20000); // ~5000 tokens

      // Fill sensitive bucket
      cache.store('sensitive-data', largeValue, 'sensitive');

      // Fill rest of cache to exceed 50k total
      for (let i = 0; i < 10; i++) {
        cache.store(`transient${i}`, largeValue, 'transient');
      }

      // Sensitive entry should still exist
      expect(cache.retrieve('sensitive-data')).not.toBeNull();

      const stats = cache.getStats();
      expect(stats.bucketStats.sensitive.entries).toBe(1);
    });

    test('should reject new sensitive entries if bucket is full', () => {
      const largeValue = 'x'.repeat(6000); // ~1500 tokens

      cache.store('s1', largeValue, 'sensitive');
      cache.store('s2', largeValue, 'sensitive');
      cache.store('s3', largeValue, 'sensitive');
      cache.store('s4', largeValue, 'sensitive'); // Should be rejected

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('STORE REJECTED: Sensitive bucket full')
      );
    });
  });

  describe('TTL Expiration', () => {
    // Fake timers are now enabled globally for this test suite
    test('should expire transient entries after 1 hour', () => {
      cache.store('transient-key', 'value', 'transient');

      // Fast-forward 2 hours
      jest.advanceTimersByTime(2 * 60 * 60 * 1000);

      expect(cache.retrieve('transient-key')).toBeNull();
    });

    test('should NOT expire decision entries before 24 hours', () => {
      cache.store('decision-key', 'value', 'decision');

      // Fast-forward 12 hours
      jest.advanceTimersByTime(12 * 60 * 60 * 1000);

      expect(cache.retrieve('decision-key')).not.toBeNull();
    });

    test('should expire decision entries after 24 hours', () => {
      cache.store('decision-key', 'value', 'decision');

      // Fast-forward 25 hours
      jest.advanceTimersByTime(25 * 60 * 60 * 1000);

      expect(cache.retrieve('decision-key')).toBeNull();
    });

    test('should NOT expire sensitive entries before 7 days', () => {
      cache.store('sensitive-key', 'value', 'sensitive');

      // Fast-forward 6 days
      jest.advanceTimersByTime(6 * 24 * 60 * 60 * 1000);

      expect(cache.retrieve('sensitive-key')).not.toBeNull();
    });
  });

  describe('Stats Tracking', () => {
    test('should track hit and miss counts', () => {
      cache.store('key1', 'value1', 'transient');

      cache.retrieve('key1'); // hit
      cache.retrieve('key2'); // miss
      cache.retrieve('key1'); // hit

      const stats = cache.getStats();
      expect(stats.hitCount).toBe(2);
      expect(stats.missCount).toBe(1);
    });

    test('should track eviction count', () => {
      cache.store('key1', 'value', 'transient');
      cache.evict('key1');

      const stats = cache.getStats();
      expect(stats.evictionCount).toBe(1);
    });

    test('should provide complete stats structure', () => {
      cache.store('t1', 'data', 'transient');
      cache.store('d1', 'data', 'decision');
      cache.store('s1', 'data', 'sensitive');

      const stats = cache.getStats();

      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('totalTokens');
      expect(stats).toHaveProperty('bucketStats');
      expect(stats).toHaveProperty('evictionCount');
      expect(stats).toHaveProperty('hitCount');
      expect(stats).toHaveProperty('missCount');

      expect(stats.bucketStats.transient).toHaveProperty('entries');
      expect(stats.bucketStats.transient).toHaveProperty('tokens');
    });
  });

  describe('Observability (Logging)', () => {
    test('should log every store operation', () => {
      cache.store('key1', 'value1', 'transient');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[SharedMemoryCache] STORE: key1')
      );
    });

    test('should log reason when provided', () => {
      cache.store('key1', 'value1', 'transient', 'Test reason');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Reason: Test reason')
      );
    });

    test('should log cache hits', () => {
      cache.store('key1', 'value1', 'transient');
      cache.retrieve('key1');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[SharedMemoryCache] HIT: key1')
      );
    });

    test('should log cache misses', () => {
      cache.retrieve('nonexistent');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[SharedMemoryCache] MISS: nonexistent')
      );
    });

    test('should log eviction events', () => {
      cache.store('key1', 'value1', 'transient');
      cache.evict('key1');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[SharedMemoryCache] MANUAL EVICT: key1')
      );
    });

    test('should log capacity exceeded events', () => {
      const largeValue = 'x'.repeat(20000);
      for (let i = 0; i < 11; i++) {
        cache.store(`key${i}`, largeValue, 'transient');
      }
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[SharedMemoryCache] CAPACITY EXCEEDED')
      );
    });
  });

  describe('State Persistence', () => {
    test('should export cache state', () => {
      cache.store('key1', 'value1', 'transient');
      cache.store('key2', 'value2', 'decision');

      const state = cache.exportState();
      expect(state).toHaveLength(2);
      expect(state[0]).toHaveProperty('key');
      expect(state[0]).toHaveProperty('value');
      expect(state[0]).toHaveProperty('bucket');
    });

    test('should import cache state', () => {
      const entries: CacheEntry[] = [
        {
          key: 'key1',
          value: 'value1',
          bucket: 'transient',
          tokens: 100,
          timestamp: Date.now(),
          lastAccessed: Date.now(),
          ttl: 3600000,
        },
      ];

      cache.importState(entries);
      expect(cache.retrieve('key1')).toBe('value1');
    });

    test('should skip expired entries on import', () => {
      const entries: CacheEntry[] = [
        {
          key: 'expired',
          value: 'value',
          bucket: 'transient',
          tokens: 100,
          timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
          lastAccessed: Date.now() - 2 * 60 * 60 * 1000,
          ttl: 3600000, // 1 hour TTL
        },
      ];

      cache.importState(entries);
      expect(cache.retrieve('expired')).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty string values', () => {
      cache.store('empty', '', 'transient');
      expect(cache.retrieve('empty')).toBe('');
    });

    test('should handle very large values', () => {
      const huge = 'x'.repeat(100000); // ~25k tokens
      cache.store('huge', huge, 'transient');
      expect(cache.retrieve('huge')).toBe(huge);
    });

    test('should handle special characters in keys', () => {
      cache.store('key:with:colons', 'value', 'transient');
      cache.store('key/with/slashes', 'value', 'transient');
      cache.store('key.with.dots', 'value', 'transient');

      expect(cache.retrieve('key:with:colons')).toBe('value');
      expect(cache.retrieve('key/with/slashes')).toBe('value');
      expect(cache.retrieve('key.with.dots')).toBe('value');
    });

    test('should handle rapid updates to same key', () => {
      for (let i = 0; i < 100; i++) {
        cache.store('key', `value${i}`, 'transient');
      }
      expect(cache.retrieve('key')).toBe('value99');
      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });
});
