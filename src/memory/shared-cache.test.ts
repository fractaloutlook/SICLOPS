import { SharedMemoryCache, BucketType, CacheEntry } from './shared-cache';

describe('SharedMemoryCache', () => {
  let cache: SharedMemoryCache;
  const DEFAULT_MAX_TOKENS = 50000;
  const DEFAULT_SENSITIVE_TOKENS = 5000;

  beforeEach(() => {
    // Reset environment variable for consistent logging behavior across tests
    process.env.VERBOSE_CACHE_LOGGING = 'false';
    cache = new SharedMemoryCache();

    // Clear cache internal state (if any persistence was imported)
    // This is a workaround as the cache doesn't have a public clear method yet.
    // In a real scenario, we might add a `clear()` method for testing.
    (cache as any).cache = new Map<string, CacheEntry>();
    (cache as any).evictionCount = 0;
    (cache as any).hitCount = 0;
    (cache as any).missCount = 0;
  });

  it('should initialize with correct token limits and empty stats', () => {
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.evictionCount).toBe(0);
    expect(stats.hitCount).toBe(0);
    expect(stats.missCount).toBe(0);
    // Check internal properties, though not ideal for public API testing
    expect((cache as any).MAX_TOKENS).toBe(DEFAULT_MAX_TOKENS);
    expect((cache as any).SENSITIVE_TOKENS).toBe(DEFAULT_SENSITIVE_TOKENS);
  });

  it('should store and retrieve an item successfully', () => {
    cache.store('key1', 'value1', 'transient', 'Test reason');
    const retrieved = cache.retrieve('key1');
    expect(retrieved).toBe('value1');
    expect(cache.getStats().totalEntries).toBe(1);
    expect(cache.getStats().hitCount).toBe(1);
    expect(cache.getStats().missCount).toBe(0);
  });

  it('should return null for a non-existent key', () => {
    const retrieved = cache.retrieve('non-existent');
    expect(retrieved).toBeNull();
    expect(cache.getStats().missCount).toBe(1);
  });

  it('should update an existing item and its tokens', () => {
    cache.store('key1', 'value1', 'transient');
    cache.store('key1', 'newValue1WithMoreTokens', 'transient');
    expect(cache.retrieve('key1')).toBe('newValue1WithMoreTokens');
    expect(cache.getStats().totalEntries).toBe(1);
    // Token count should reflect the new value's length
    expect(cache.getStats().totalTokens).toBe(Math.ceil('newValue1WithMoreTokens'.length / 4));
  });

  it('should manually evict an item', () => {
    cache.store('key1', 'value1', 'transient');
    const evicted = cache.evict('key1');
    expect(evicted).toBe(true);
    expect(cache.retrieve('key1')).toBeNull();
    expect(cache.getStats().totalEntries).toBe(0);
    expect(cache.getStats().evictionCount).toBe(1);
  });

  it('should not evict a non-existent item', () => {
    const evicted = cache.evict('non-existent');
    expect(evicted).toBe(false);
    expect(cache.getStats().evictionCount).toBe(0);
  });

  it('should not allow sensitive bucket to exceed its token limit', () => {
    // Make SENSITIVE_TOKENS small for testing
    (cache as any).SENSITIVE_TOKENS = 10; 

    const value1 = 'sensitivedata1234'; // ~5 tokens
    const value2 = 'more_sensitive_data_56789'; // ~7 tokens

    cache.store('s1', value1, 'sensitive'); // Should store (5 tokens)
    expect(cache.getStats().bucketStats.sensitive.tokens).toBeGreaterThan(0);

    // Attempt to store more, exceeding 10 token limit
    cache.store('s2', value2, 'sensitive'); // Should be rejected

    expect(cache.retrieve('s1')).toBe(value1);
    expect(cache.retrieve('s2')).toBeNull(); // s2 should not be stored
    expect(cache.getStats().bucketStats.sensitive.entries).toBe(1);
    expect(cache.getStats().bucketStats.sensitive.tokens).toBe(Math.ceil(value1.length / 4));
  });

  it('should evict transient/decision items when total capacity is exceeded', () => {
    // Reduce MAX_TOKENS for easier testing
    (cache as any).MAX_TOKENS = 20; 
    (cache as any).SENSITIVE_TOKENS = 0; // Disable sensitive limit for this test

    const item1 = 'a'.repeat(8); // 2 tokens
    const item2 = 'b'.repeat(8); // 2 tokens
    const item3 = 'c'.repeat(8); // 2 tokens
    const item4 = 'd'.repeat(8); // 2 tokens
    const item5 = 'e'.repeat(8); // 2 tokens

    // Store 5 items, total 10 tokens, well under 20 MAX_TOKENS
    cache.store('k1', item1, 'transient');
    cache.store('k2', item2, 'transient');
    cache.store('k3', item3, 'transient');
    cache.store('k4', item4, 'decision');
    cache.store('k5', item5, 'decision');

    expect(cache.getStats().totalEntries).toBe(5);
    expect(cache.getStats().totalTokens).toBe(10);

    // Store a large item that will exceed capacity and trigger eviction
    // This item will be 15 tokens, bringing total to 25, exceeding 20
    const largeItem = 'L'.repeat(60); // 15 tokens
    cache.store('k6', largeItem, 'transient'); 

    // After storing k6 (15 tokens), total should be 25 tokens. Max is 20.
    // Expect 5 tokens to be evicted (2 + 2 + 1).
    // k1, k2, k3, k4, k5 are oldest, k1, k2, k3 (transient) should be evicted first
    // Then k4 (decision) might be evicted

    // The current LRU logic prioritizes oldest non-sensitive items.
    // k1, k2, k3, k4, k5 were stored first.
    // k1, k2, k3 should be evicted first, then k4
    expect(cache.retrieve('k1')).toBeNull();
    expect(cache.retrieve('k2')).toBeNull();
    expect(cache.retrieve('k3')).toBeNull();
    // The total is 10 + 15 = 25. Need to free 5 tokens.
    // k1 (2) + k2 (2) + k3 (2) = 6 tokens. So k1, k2, k3 should be evicted.
    expect(cache.retrieve('k4')).not.toBeNull();
    expect(cache.retrieve('k5')).not.toBeNull();
    expect(cache.retrieve('k6')).not.toBeNull();

    expect(cache.getStats().totalEntries).toBe(3);
    expect(cache.getStats().evictionCount).toBe(3);
    expect(cache.getStats().totalTokens).toBe(2 + 2 + 15); // k4 + k5 + k6
  });

  it('should not evict sensitive items during automatic capacity enforcement', () => {
    // Reduce MAX_TOKENS for easier testing
    (cache as any).MAX_TOKENS = 20; 
    (cache as any).SENSITIVE_TOKENS = 10; // Keep sensitive limit at 10

    const sensitiveItem = 'S'.repeat(20); // 5 tokens
    cache.store('sensitive_key', sensitiveItem, 'sensitive');

    const transientItem1 = 'T1'.repeat(20); // 10 tokens
    cache.store('transient_key1', transientItem1, 'transient');

    const transientItem2 = 'T2'.repeat(20); // 10 tokens
    // This will make total tokens 5 (sensitive) + 10 (t1) + 10 (t2) = 25 tokens, exceeding MAX_TOKENS (20)
    cache.store('transient_key2', transientItem2, 'transient');

    // Expect transient_key1 to be evicted first (oldest non-sensitive)
    expect(cache.retrieve('transient_key1')).toBeNull();
    expect(cache.retrieve('sensitive_key')).not.toBeNull();
    expect(cache.retrieve('transient_key2')).not.toBeNull();

    expect(cache.getStats().totalEntries).toBe(2);
    expect(cache.getStats().evictionCount).toBe(1);
    expect(cache.getStats().totalTokens).toBe(Math.ceil(sensitiveItem.length / 4) + Math.ceil(transientItem2.length / 4)); // 5 + 10 = 15
  });

  it('should expire items based on TTL', async () => {
    // Set a very short TTL for transient bucket
    (cache as any).TTL_CONFIG = { 
      transient: 10, // 10 ms
      decision: 24 * 60 * 60 * 1000, 
      sensitive: 7 * 24 * 60 * 60 * 1000 
    };

    cache.store('expiring_key', 'value', 'transient');
    expect(cache.retrieve('expiring_key')).toBe('value'); // Should be found initially

    await new Promise(resolve => setTimeout(resolve, 50)); // Wait for TTL to pass

    expect(cache.retrieve('expiring_key')).toBeNull(); // Should now be expired
    expect(cache.getStats().missCount).toBe(2); // Initial miss + expired miss
    expect(cache.getStats().evictionCount).toBe(1); // Evicted due to expiration
    expect(cache.getStats().totalEntries).toBe(0);
  });

  it('should update lastAccessed on retrieve', async () => {
    cache.store('key_lru', 'value', 'transient');
    const entry = (cache as any).cache.get('key_lru');
    const initialLastAccessed = entry.lastAccessed;
    
    await new Promise(resolve => setTimeout(resolve, 10)); // Simulate time passing
    cache.retrieve('key_lru');
    const updatedLastAccessed = entry.lastAccessed;

    expect(updatedLastAccessed).toBeGreaterThan(initialLastAccessed);
  });

  it('should correctly calculate total and bucket-specific stats', () => {
    cache.store('t1', 'transient_val1', 'transient');
    cache.store('d1', 'decision_val1', 'decision');
    cache.store('s1', 'sensitive_val1', 'sensitive');
    cache.store('t2', 'transient_val2_more_tokens', 'transient');

    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(4);
    expect(stats.totalTokens).toBe(
      Math.ceil('transient_val1'.length / 4) +
      Math.ceil('decision_val1'.length / 4) +
      Math.ceil('sensitive_val1'.length / 4) +
      Math.ceil('transient_val2_more_tokens'.length / 4)
    );

    expect(stats.bucketStats.transient.entries).toBe(2);
    expect(stats.bucketStats.transient.tokens).toBe(
      Math.ceil('transient_val1'.length / 4) +
      Math.ceil('transient_val2_more_tokens'.length / 4)
    );

    expect(stats.bucketStats.decision.entries).toBe(1);
    expect(stats.bucketStats.decision.tokens).toBe(Math.ceil('decision_val1'.length / 4));

    expect(stats.bucketStats.sensitive.entries).toBe(1);
    expect(stats.bucketStats.sensitive.tokens).toBe(Math.ceil('sensitive_val1'.length / 4));
  });

  it('should export and import state correctly, filtering expired entries on import', async () => {
    // Set a very short TTL for transient bucket
    (cache as any).TTL_CONFIG = { 
      transient: 10, // 10 ms
      decision: 24 * 60 * 60 * 1000, 
      sensitive: 7 * 24 * 60 * 60 * 1000 
    };

    cache.store('active_key', 'active_value', 'decision');
    cache.store('expired_key', 'expired_value', 'transient');

    await new Promise(resolve => setTimeout(resolve, 50)); // Wait for transient to expire

    cache.store('another_active_key', 'another_active_value', 'sensitive');

    const exportedState = cache.exportState();
    expect(exportedState.length).toBe(3); // All entries are exported regardless of expiration

    const newCache = new SharedMemoryCache();
    // Set short TTL for new cache instance for consistency
    (newCache as any).TTL_CONFIG = (cache as any).TTL_CONFIG;
    newCache.importState(exportedState);

    expect(newCache.getStats().totalEntries).toBe(2); // expired_key should not be imported
    expect(newCache.retrieve('active_key')).toBe('active_value');
    expect(newCache.retrieve('another_active_key')).toBe('another_active_value');
    expect(newCache.retrieve('expired_key')).toBeNull();
  });
});
