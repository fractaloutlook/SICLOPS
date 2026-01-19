/**
 * SharedMemoryCache Test Suite
 * Plain TypeScript implementation - no Jest required
 * Run with: npx ts-node tests/test-shared-cache.ts
 */

import { SharedMemoryCache } from '../src/memory/shared-cache';

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
}

function assertEquals(actual: any, expected: any, message: string): void {
  if (actual !== expected) {
    console.error(`❌ FAILED: ${message}`);
    console.error(`   Expected: ${expected}`);
    console.error(`   Actual: ${actual}`);
    process.exit(1);
  }
}

console.log('🧪 Testing SharedMemoryCache\n');

// Test 1: Basic store and retrieve
console.log('Test 1: Basic store/retrieve...');
const cache1 = new SharedMemoryCache();
cache1.store('key1', 'value1', 'transient');
const result1 = cache1.retrieve('key1');
assertEquals(result1, 'value1', 'Should retrieve stored value');
console.log('✅ PASSED\n');

// Test 2: Bucket segregation
console.log('Test 2: Bucket segregation...');
const cache2 = new SharedMemoryCache();
cache2.store('t1', 'transient-data', 'transient');
cache2.store('d1', 'decision-data', 'decision');
cache2.store('s1', 'sensitive-data', 'sensitive');
const stats2 = cache2.getStats();
assert(stats2.bucketStats.transient.entries === 1, 'Transient bucket should have 1 entry');
assert(stats2.bucketStats.decision.entries === 1, 'Decision bucket should have 1 entry');
assert(stats2.bucketStats.sensitive.entries === 1, 'Sensitive bucket should have 1 entry');
console.log('✅ PASSED\n');

// Test 3: Sensitive bucket protection
console.log('Test 3: Sensitive bucket limit...');
const cache3 = new SharedMemoryCache();
const largeData = 'x'.repeat(20000); // ~5000 tokens
cache3.store('s1', largeData, 'sensitive');
const stats3a = cache3.getStats();
assert(stats3a.bucketStats.sensitive.entries === 1, 'First sensitive entry should succeed');
// Try to exceed limit
cache3.store('s2', largeData, 'sensitive');
const stats3b = cache3.getStats();
assert(stats3b.bucketStats.sensitive.entries === 1, 'Second sensitive entry should be rejected');
console.log('✅ PASSED\n');

// Test 4: LRU eviction (transient bucket)
console.log('Test 4: LRU eviction...');
const cache4 = new SharedMemoryCache();
const hugeData = 'x'.repeat(200000); // ~50k tokens
cache4.store('t1', hugeData, 'transient');
assert(cache4.retrieve('t1') !== null, 'First entry should exist');
// This should trigger eviction of t1
cache4.store('t2', hugeData, 'transient');
assert(cache4.retrieve('t1') === null, 'First entry should be evicted');
assert(cache4.retrieve('t2') !== null, 'Second entry should exist');
console.log('✅ PASSED\n');

// Test 5: TTL expiration
console.log('Test 5: TTL expiration...');
const cache5 = new SharedMemoryCache();
cache5.store('expire-test', 'data', 'transient');
// Manually expire by manipulating timestamp (hack for testing)
const entry = (cache5 as any).cache.get('expire-test');
if (entry) {
  entry.timestamp = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
}
const expired = cache5.retrieve('expire-test');
assert(expired === null, 'Expired entry should return null');
console.log('✅ PASSED\n');

// Test 6: Stats tracking
console.log('Test 6: Stats tracking...');
const cache6 = new SharedMemoryCache();
cache6.store('k1', 'v1', 'transient');
cache6.retrieve('k1'); // hit
cache6.retrieve('k2'); // miss
const stats6 = cache6.getStats();
assert(stats6.hitCount === 1, 'Should have 1 hit');
assert(stats6.missCount === 1, 'Should have 1 miss');
console.log('✅ PASSED\n');

// Test 7: Export/import state
console.log('Test 7: Export/import state...');
const cache7a = new SharedMemoryCache();
cache7a.store('persist1', 'data1', 'decision');
cache7a.store('persist2', 'data2', 'sensitive');
const exported = cache7a.exportState();
assert(exported.length === 2, 'Should export 2 entries');

const cache7b = new SharedMemoryCache();
cache7b.importState(exported);
assert(cache7b.retrieve('persist1') === 'data1', 'Should restore first entry');
assert(cache7b.retrieve('persist2') === 'data2', 'Should restore second entry');
console.log('✅ PASSED\n');

// Test 8: Update existing entry
console.log('Test 8: Update existing entry...');
const cache8 = new SharedMemoryCache();
cache8.store('update-key', 'original', 'transient');
cache8.store('update-key', 'updated', 'transient');
assertEquals(cache8.retrieve('update-key'), 'updated', 'Should have updated value');
const stats8 = cache8.getStats();
assert(stats8.totalEntries === 1, 'Should still have only 1 entry');
console.log('✅ PASSED\n');

// Test 9: Sensitive bucket never auto-evicts
console.log('Test 9: Sensitive bucket protection during eviction...');
const cache9 = new SharedMemoryCache();
const sensitiveData = 'sensitive'.repeat(1000);
const fillerData = 'x'.repeat(180000); // ~45k tokens
cache9.store('sensitive1', sensitiveData, 'sensitive');
cache9.store('filler1', fillerData, 'transient');
cache9.store('filler2', fillerData, 'transient'); // This should evict filler1, NOT sensitive1
assert(cache9.retrieve('sensitive1') !== null, 'Sensitive entry should never be auto-evicted');
assert(cache9.retrieve('filler1') === null, 'Transient entry should be evicted');
console.log('✅ PASSED\n');

// Test 10: Manual eviction
console.log('Test 10: Manual eviction...');
const cache10 = new SharedMemoryCache();
cache10.store('manual-evict', 'data', 'transient');
assert(cache10.evict('manual-evict') === true, 'Manual eviction should succeed');
assert(cache10.retrieve('manual-evict') === null, 'Entry should be gone');
assert(cache10.evict('non-existent') === false, 'Evicting non-existent key should return false');
console.log('✅ PASSED\n');

console.log('\n🎉 All tests passed!\n');
console.log('SharedMemoryCache is working correctly and ready for integration.');
