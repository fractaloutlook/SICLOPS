/**
 * SharedMemoryCache Test Suite - Plain TypeScript
 *
 * Run with: npx ts-node tests/test-shared-cache.ts
 * 
 * Tests all core functionality without Jest dependencies.
 */

import { SharedMemoryCache } from '../src/memory/shared-cache';

// Test counter
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

function assertEquals(actual: any, expected: any, message: string): void {
  if (actual === expected) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    console.error(`   Expected: ${expected}`);
    console.error(`   Actual: ${actual}`);
    failed++;
  }
}

function assertNotNull(value: any, message: string): void {
  if (value !== null) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

function assertNull(value: any, message: string): void {
  if (value === null) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    console.error(`   Expected: null`);
    console.error(`   Actual: ${value}`);
    failed++;
  }
}

console.log('\n========================================');
console.log('SharedMemoryCache Test Suite');
console.log('========================================\n');

// Test 1: Basic store and retrieve
console.log('--- Test 1: Basic Store/Retrieve ---');
{
  const cache = new SharedMemoryCache();
  cache.store('key1', 'value1', 'transient');
  const result = cache.retrieve('key1');
  assertEquals(result, 'value1', 'Should retrieve stored value');
  
  const missing = cache.retrieve('nonexistent');
  assertNull(missing, 'Should return null for missing key');
}

// Test 2: Three-bucket classification
console.log('\n--- Test 2: Three-Bucket Classification ---');
{
  const cache = new SharedMemoryCache();
  cache.store('t1', 'data', 'transient');
  cache.store('d1', 'data', 'decision');
  cache.store('s1', 'data', 'sensitive');
  
  const stats = cache.getStats();
  assertEquals(stats.bucketStats.transient.entries, 1, 'Transient bucket should have 1 entry');
  assertEquals(stats.bucketStats.decision.entries, 1, 'Decision bucket should have 1 entry');
  assertEquals(stats.bucketStats.sensitive.entries, 1, 'Sensitive bucket should have 1 entry');
}

// Test 3: Token estimation
console.log('\n--- Test 3: Token Estimation ---');
{
  const cache = new SharedMemoryCache();
  const value1000 = 'x'.repeat(1000); // ~250 tokens
  cache.store('k1', value1000, 'transient');
  cache.store('k2', value1000, 'transient');
  
  const stats = cache.getStats();
  assertEquals(stats.totalTokens, 500, 'Should estimate ~500 tokens for 2000 chars');
}

// Test 4: Sensitive bucket limit
console.log('\n--- Test 4: Sensitive Bucket Limit (5k tokens) ---');
{
  const cache = new SharedMemoryCache();
  const largeValue = 'x'.repeat(6000); // ~1500 tokens
  
  cache.store('s1', largeValue, 'sensitive');
  cache.store('s2', largeValue, 'sensitive');
  cache.store('s3', largeValue, 'sensitive');
  cache.store('s4', largeValue, 'sensitive'); // Should be rejected (would exceed 5k)
  
  const stats = cache.getStats();
  assert(stats.bucketStats.sensitive.tokens <= 5000, 'Sensitive bucket should not exceed 5k tokens');
}

// Test 5: LRU eviction
console.log('\n--- Test 5: LRU Eviction ---');
{
  const cache = new SharedMemoryCache();
  const largeValue = 'x'.repeat(20000); // ~5000 tokens
  
  cache.store('old1', largeValue, 'transient');
  cache.store('old2', largeValue, 'transient');
  cache.store('recent', largeValue, 'transient');
  
  // Access 'recent' to update LRU
  cache.retrieve('recent');
  
  // Fill cache to trigger eviction (11 * 5000 = 55k tokens > 50k limit)
  for (let i = 0; i < 8; i++) {
    cache.store(`filler${i}`, largeValue, 'transient');
  }
  
  const stats = cache.getStats();
  assert(stats.totalTokens <= 50000, 'Total tokens should not exceed 50k after eviction');
  assert(stats.evictionCount > 0, 'Should have evicted at least one entry');
}

// Test 6: Sensitive bucket never auto-evicts
console.log('\n--- Test 6: Sensitive Bucket Protection ---');
{
  const cache = new SharedMemoryCache();
  const largeValue = 'x'.repeat(20000); // ~5000 tokens
  
  // Store sensitive data
  cache.store('sensitive-data', largeValue, 'sensitive');
  
  // Fill rest of cache
  for (let i = 0; i < 10; i++) {
    cache.store(`transient${i}`, largeValue, 'transient');
  }
  
  // Sensitive entry should still exist
  assertNotNull(cache.retrieve('sensitive-data'), 'Sensitive data should never auto-evict');
}

// Test 7: Manual eviction
console.log('\n--- Test 7: Manual Eviction ---');
{
  const cache = new SharedMemoryCache();
  cache.store('key1', 'value1', 'transient');
  
  const evicted = cache.evict('key1');
  assert(evicted, 'Should return true when evicting existing key');
  
  assertNull(cache.retrieve('key1'), 'Key should be null after eviction');
  
  const evictedAgain = cache.evict('key1');
  assert(!evictedAgain, 'Should return false when evicting non-existent key');
}

// Test 8: Stats tracking
console.log('\n--- Test 8: Stats Tracking ---');
{
  const cache = new SharedMemoryCache();
  cache.store('key1', 'value1', 'transient');
  
  cache.retrieve('key1'); // hit
  cache.retrieve('missing'); // miss
  cache.retrieve('key1'); // hit
  
  const stats = cache.getStats();
  assertEquals(stats.hitCount, 2, 'Should track 2 hits');
  assertEquals(stats.missCount, 1, 'Should track 1 miss');
}

// Test 9: State export/import
console.log('\n--- Test 9: State Persistence ---');
{
  const cache1 = new SharedMemoryCache();
  cache1.store('key1', 'value1', 'transient');
  cache1.store('key2', 'value2', 'decision');
  
  const exported = cache1.exportState();
  assert(exported.length === 2, 'Should export 2 entries');
  
  const cache2 = new SharedMemoryCache();
  cache2.importState(exported);
  
  assertEquals(cache2.retrieve('key1'), 'value1', 'Should import key1');
  assertEquals(cache2.retrieve('key2'), 'value2', 'Should import key2');
}

// Test 10: Reason field (documentation-only)
console.log('\n--- Test 10: Reason Field ---');
{
  const cache = new SharedMemoryCache();
  cache.store('key1', 'value1', 'transient', 'Important context');
  cache.store('key2', 'value2', 'transient'); // no reason
  
  assertEquals(cache.retrieve('key1'), 'value1', 'Should work with reason');
  assertEquals(cache.retrieve('key2'), 'value2', 'Should work without reason');
}

// Results summary
console.log('\n========================================');
console.log('Test Results');
console.log('========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}

console.log('✅ All tests passed!\n');
