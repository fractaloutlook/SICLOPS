/**
 * SharedMemoryCache Test Suite
 *
 * Demonstrates store/retrieve/eviction behavior with realistic agent scenarios.
 * Run with: npx ts-node tests/test-shared-cache.ts
 */

import { SharedMemoryCache } from '../src/memory/shared-cache';

// Test helper to log events
function createTestCache(): SharedMemoryCache {
  const cache = new SharedMemoryCache();
  cache.on('log', (event) => {
    console.log(`[${event.event}]`, JSON.stringify(event, null, 2));
  });
  return cache;
}

// Test 1: Basic store and retrieve
function testBasicStoreRetrieve() {
  console.log('\n=== Test 1: Basic Store/Retrieve ===');
  const cache = createTestCache();

  // Store a team decision
  cache.store(
    'api_design_v1',
    { type: 'REST', auth: 'JWT', versioning: 'header' },
    'decision',
    'Team consensus from run #5: REST over GraphQL'
  );

  // Retrieve it
  const retrieved = cache.retrieve('api_design_v1');
  console.log('\nRetrieved:', retrieved);

  // Try non-existent key
  const missing = cache.retrieve('nonexistent');
  console.log('Missing key:', missing);

  const stats = cache.getStats();
  console.log('\nCache stats:', stats);
}

// Test 2: Bucket quotas and capacity
function testBucketQuotas() {
  console.log('\n=== Test 2: Bucket Quotas ===');
  const cache = createTestCache();

  // Fill transient bucket with work-in-progress data
  for (let i = 0; i < 5; i++) {
    cache.store(
      `wip_${i}`,
      `This is work in progress item ${i}. `.repeat(100), // ~400 tokens each
      'transient',
      `Temporary work context ${i}`
    );
  }

  // Add some decisions
  cache.store(
    'db_choice',
    { database: 'PostgreSQL', reason: 'Better JSON support' },
    'decision',
    'Team vote: 4/5 for Postgres'
  );

  // Try to fill sensitive bucket beyond quota (5000 tokens)
  try {
    const largeData = 'x'.repeat(25000); // ~6250 tokens
    cache.store('credentials', largeData, 'sensitive', 'API keys');
    console.log('ERROR: Should have thrown quota error!');
  } catch (err) {
    console.log('\n✅ Correctly rejected oversized sensitive entry:', (err as Error).message);
  }

  const stats = cache.getStats();
  console.log('\nCache stats after quota test:', stats);
}

// Test 3: LRU eviction under capacity pressure
function testLRUEviction() {
  console.log('\n=== Test 3: LRU Eviction ===');
  const cache = createTestCache();

  // Store multiple entries with access patterns
  cache.store('entry_1', 'x'.repeat(10000), 'transient', 'First entry'); // ~2500 tokens
  cache.store('entry_2', 'x'.repeat(10000), 'transient', 'Second entry'); // ~2500 tokens
  cache.store('entry_3', 'x'.repeat(10000), 'decision', 'Third entry'); // ~2500 tokens

  console.log('\nBefore eviction:');
  console.log('Stats:', cache.getStats());

  // Access entry_1 and entry_3 to make them more recent
  cache.retrieve('entry_1');
  cache.retrieve('entry_3');

  // Now store a huge entry that forces eviction
  // This should evict entry_2 (least recently used)
  const hugeData = 'x'.repeat(180000); // ~45000 tokens
  cache.store('huge_entry', hugeData, 'transient', 'Forces eviction');

  console.log('\nAfter storing huge entry:');
  console.log('Stats:', cache.getStats());

  // Check what survived
  console.log('\nentry_1 exists:', cache.retrieve('entry_1') !== null);
  console.log('entry_2 exists (should be evicted):', cache.retrieve('entry_2') !== null);
  console.log('entry_3 exists:', cache.retrieve('entry_3') !== null);
  console.log('huge_entry exists:', cache.retrieve('huge_entry') !== null);
}

// Test 4: Manual eviction (only way to clear sensitive)
function testManualEviction() {
  console.log('\n=== Test 4: Manual Eviction ===');
  const cache = createTestCache();

  // Store sensitive data
  cache.store(
    'user_preferences',
    { theme: 'dark', notifications: true },
    'sensitive',
    'User settings - must be manually managed'
  );

  console.log('\nBefore eviction:');
  console.log('Stats:', cache.getStats());

  // Manually evict
  const evicted = cache.evict('user_preferences');
  console.log('\nEviction result:', evicted);

  console.log('\nAfter eviction:');
  console.log('Stats:', cache.getStats());

  // Try to retrieve evicted entry
  const retrieved = cache.retrieve('user_preferences');
  console.log('Retrieved after eviction:', retrieved);
}

// Test 5: Realistic agent workflow
function testAgentWorkflow() {
  console.log('\n=== Test 5: Realistic Agent Workflow ===');
  const cache = createTestCache();

  // Run 1: Team discusses and decides on architecture
  console.log('\n--- Run 1: Initial Architecture Discussion ---');
  cache.store(
    'architecture_decision',
    {
      pattern: 'Event-driven microservices',
      rationale: 'Better scalability and fault isolation',
      votedBy: ['Morgan', 'Sam', 'Jordan', 'Alex'],
    },
    'decision',
    'Consensus reached after 3 rounds of discussion'
  );

  // Run 2: Check if already decided (avoid re-discussion)
  console.log('\n--- Run 2: Check Previous Decision ---');
  const previousDecision = cache.retrieve('architecture_decision');
  if (previousDecision) {
    console.log('✅ Found cached decision:', previousDecision);
    console.log('Skipping re-discussion, proceeding with implementation...');
  } else {
    console.log('No cached decision, need to discuss...');
  }

  // Store implementation progress
  cache.store(
    'implementation_status',
    'Completed auth service, working on notification service',
    'transient',
    'Current sprint progress'
  );

  // Run 3: Store sensitive finding
  console.log('\n--- Run 3: Security Finding ---');
  cache.store(
    'security_audit_finding',
    {
      severity: 'high',
      issue: 'SQL injection vulnerability in user search',
      remediation: 'Use parameterized queries',
    },
    'sensitive',
    'Security audit from Sam - must not auto-evict'
  );

  console.log('\nFinal stats:');
  const stats = cache.getStats();
  console.log(JSON.stringify(stats, null, 2));
}

// Run all tests
console.log('\n========================================');
console.log('SharedMemoryCache Test Suite');
console.log('========================================');

try {
  testBasicStoreRetrieve();
  testBucketQuotas();
  testLRUEviction();
  testManualEviction();
  testAgentWorkflow();

  console.log('\n========================================');
  console.log('✅ All tests completed!');
  console.log('========================================\n');
} catch (err) {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
}
