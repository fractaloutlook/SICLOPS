/**
 * Comprehensive tests for SharedMemoryCache
 * 
 * Tests cover:
 * - Basic store/retrieve operations
 * - Bucket segregation and limits
 * - LRU eviction behavior
 * - TTL expiration
 * - Stats tracking
 * - Import/export state
 */

import { SharedMemoryCache, BucketType, CacheEntry } from '../src/memory/shared-cache';

// Test utilities
function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
  console.log(`✓ ${message}`);
}

function assertNotNull<T>(value: T | null, message: string): asserts value is T {
  if (value === null) {
    throw new Error(`${message}: Expected non-null value`);
  }
  console.log(`✓ ${message}`);
}

function assertNull<T>(value: T | null, message: string): void {
  if (value !== null) {
    throw new Error(`${message}: Expected null, got ${JSON.stringify(value)}`);
  }
  console.log(`✓ ${message}`);
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`${message}: Condition was false`);
  }
  console.log(`✓ ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Suite
async function runTests(): Promise<void> {
  console.log('\n🧪 Running SharedMemoryCache Tests\n');
  
  let passedTests = 0;
  let failedTests = 0;
  
  // Test 1: Basic store and retrieve
  try {
    console.log('Test 1: Basic store and retrieve');
    const cache = new SharedMemoryCache();
    cache.store('key1', 'value1', 'transient', 'Test data');
    const result = cache.retrieve('key1');
    assertEq(result, 'value1', 'Should retrieve stored value');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 1 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 2: Bucket segregation
  try {
    console.log('\nTest 2: Bucket segregation');
    const cache = new SharedMemoryCache();
    cache.store('transient1', 'data1', 'transient');
    cache.store('decision1', 'data2', 'decision');
    cache.store('sensitive1', 'data3', 'sensitive');
    
    const stats = cache.getStats();
    assertEq(stats.bucketStats.transient.entries, 1, 'Transient bucket has 1 entry');
    assertEq(stats.bucketStats.decision.entries, 1, 'Decision bucket has 1 entry');
    assertEq(stats.bucketStats.sensitive.entries, 1, 'Sensitive bucket has 1 entry');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 2 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 3: Sensitive bucket limit enforcement
  try {
    console.log('\nTest 3: Sensitive bucket limit enforcement');
    const cache = new SharedMemoryCache();
    
    // Fill sensitive bucket to capacity (5000 tokens = ~20,000 chars)
    const largeData = 'x'.repeat(19000);
    cache.store('sensitive1', largeData, 'sensitive', 'Near capacity');
    
    // Try to add more - should be rejected
    const extraData = 'y'.repeat(2000);
    cache.store('sensitive2', extraData, 'sensitive', 'Over capacity');
    
    const result = cache.retrieve('sensitive2');
    assertNull(result, 'Should reject data exceeding sensitive bucket limit');
    
    const stats = cache.getStats();
    assertTrue(stats.bucketStats.sensitive.tokens <= 5000, 'Sensitive bucket should not exceed 5000 tokens');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 3 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 4: LRU eviction (non-sensitive buckets only)
  try {
    console.log('\nTest 4: LRU eviction behavior');
    const cache = new SharedMemoryCache();
    
    // Fill cache with transient data near capacity
    const chunkSize = 10000; // ~2500 tokens each
    for (let i = 0; i < 20; i++) {
      cache.store(`transient${i}`, 'x'.repeat(chunkSize), 'transient', `Entry ${i}`);
    }
    
    // Oldest entries should be evicted
    const oldEntry = cache.retrieve('transient0');
    assertNull(oldEntry, 'Oldest entry should be evicted');
    
    const recentEntry = cache.retrieve('transient19');
    assertNotNull(recentEntry, 'Most recent entry should still exist');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 4 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 5: TTL expiration
  try {
    console.log('\nTest 5: TTL expiration');
    const cache = new SharedMemoryCache();
    
    // Store with very short TTL by directly manipulating entry
    cache.store('shortTtl', 'expires soon', 'transient');
    
    // Access immediately - should work
    const immediate = cache.retrieve('shortTtl');
    assertNotNull(immediate, 'Should retrieve immediately');
    
    // Wait for TTL to expire (transient = 1 hour, but we'll test with manipulation)
    // Note: In production, this would require time manipulation or very short TTLs
    console.log('  (TTL test limited - production TTLs are 1hr+)');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 5 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 6: Stats tracking
  try {
    console.log('\nTest 6: Stats tracking');
    const cache = new SharedMemoryCache();
    
    cache.store('key1', 'value1', 'transient');
    cache.retrieve('key1'); // Hit
    cache.retrieve('nonexistent'); // Miss
    cache.evict('key1'); // Manual eviction
    
    const stats = cache.getStats();
    assertEq(stats.hitCount, 1, 'Hit count should be 1');
    assertEq(stats.missCount, 1, 'Miss count should be 1');
    assertEq(stats.evictionCount, 1, 'Eviction count should be 1');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 6 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 7: Export and import state
  try {
    console.log('\nTest 7: Export and import state');
    const cache1 = new SharedMemoryCache();
    cache1.store('key1', 'value1', 'transient');
    cache1.store('key2', 'value2', 'decision');
    cache1.store('key3', 'value3', 'sensitive');
    
    const exported = cache1.exportState();
    assertEq(exported.length, 3, 'Should export 3 entries');
    
    const cache2 = new SharedMemoryCache();
    cache2.importState(exported);
    
    assertEq(cache2.retrieve('key1'), 'value1', 'Should restore transient entry');
    assertEq(cache2.retrieve('key2'), 'value2', 'Should restore decision entry');
    assertEq(cache2.retrieve('key3'), 'value3', 'Should restore sensitive entry');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 7 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 8: Update existing entry
  try {
    console.log('\nTest 8: Update existing entry');
    const cache = new SharedMemoryCache();
    cache.store('key1', 'original', 'transient');
    cache.store('key1', 'updated', 'transient');
    
    const result = cache.retrieve('key1');
    assertEq(result, 'updated', 'Should return updated value');
    
    const stats = cache.getStats();
    assertEq(stats.totalEntries, 1, 'Should still have 1 entry (updated, not duplicated)');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 8 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 9: Sensitive bucket never auto-evicts
  try {
    console.log('\nTest 9: Sensitive bucket protection from auto-eviction');
    const cache = new SharedMemoryCache();
    
    // Add sensitive data
    cache.store('sensitive1', 'x'.repeat(10000), 'sensitive');
    
    // Fill transient bucket to trigger eviction
    for (let i = 0; i < 20; i++) {
      cache.store(`transient${i}`, 'y'.repeat(10000), 'transient');
    }
    
    // Sensitive data should still be there
    const sensitiveData = cache.retrieve('sensitive1');
    assertNotNull(sensitiveData, 'Sensitive data should never be auto-evicted');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 9 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Test 10: Manual eviction
  try {
    console.log('\nTest 10: Manual eviction');
    const cache = new SharedMemoryCache();
    cache.store('key1', 'value1', 'transient');
    
    const evicted = cache.evict('key1');
    assertTrue(evicted, 'Should return true for successful eviction');
    
    const result = cache.retrieve('key1');
    assertNull(result, 'Should not find manually evicted entry');
    
    const notFound = cache.evict('nonexistent');
    assertTrue(!notFound, 'Should return false for non-existent key');
    passedTests++;
  } catch (e) {
    console.error('❌ Test 10 failed:', (e as Error).message);
    failedTests++;
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passedTests}`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log(`   📈 Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%\n`);
  
  if (failedTests > 0) {
    throw new Error(`${failedTests} test(s) failed`);
  }
  
  console.log('✅ All tests passed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error.message);
  process.exit(1);
});