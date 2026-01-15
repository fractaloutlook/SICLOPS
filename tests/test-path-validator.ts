/**
 * Comprehensive tests for path-validator module
 * 
 * Tests security boundaries, edge cases, and integration behavior.
 * Run with: npx ts-node tests/test-path-validator.ts
 */

import { validatePath, validateFileSize, validateOperationCount, PathValidationError } from '../src/validation/path-validator';

let passCount = 0;
let failCount = 0;

function test(description: string, fn: () => void): void {
  try {
    fn();
    passCount++;
    console.log(`✅ ${description}`);
  } catch (error) {
    failCount++;
    console.error(`❌ ${description}`);
    console.error(`   ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => void, expectedError: string): void {
  try {
    fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (error: any) {
    if (error.message === 'Expected function to throw, but it did not') {
      throw error;
    }
    if (!error.message.includes(expectedError)) {
      throw new Error(`Expected error message to include "${expectedError}", got: ${error.message}`);
    }
  }
}

console.log('\n🧪 Testing Path Validator Module\n');

// ═══════════════════════════════════════════════════════════════
// VALID PATH TESTS
// ═══════════════════════════════════════════════════════════════

test('Valid path: src/memory/shared-cache.ts', () => {
  const result = validatePath('src/memory/shared-cache.ts');
  assert(result.isValid === true, 'Should be valid');
  assert(result.normalizedPath === 'src/memory/shared-cache.ts', 'Path should be normalized');
  assert(result.error === undefined, 'Should have no error');
});

test('Valid path: tests/test-path-validator.ts', () => {
  const result = validatePath('tests/test-path-validator.ts');
  assert(result.isValid === true, 'Should be valid');
});

test('Valid path: docs/README.md', () => {
  const result = validatePath('docs/README.md');
  assert(result.isValid === true, 'Should be valid');
});

test('Valid path: notes/morgan-notes.md', () => {
  const result = validatePath('notes/morgan-notes.md');
  assert(result.isValid === true, 'Should be valid');
});

test('Valid path: src/deeply/nested/path/file.ts', () => {
  const result = validatePath('src/deeply/nested/path/file.ts');
  assert(result.isValid === true, 'Should be valid');
});

// ═══════════════════════════════════════════════════════════════
// PATH TRAVERSAL ATTACK TESTS
// ═══════════════════════════════════════════════════════════════

test('Path traversal: ../../../etc/passwd', () => {
  assertThrows(
    () => validatePath('../../../etc/passwd'),
    'Path traversal attempt detected'
  );
});

test('Path traversal: src/../../../etc/passwd', () => {
  assertThrows(
    () => validatePath('src/../../../etc/passwd'),
    'Path traversal attempt detected'
  );
});

test('Path traversal: src/memory/../../node_modules/bad.js', () => {
  assertThrows(
    () => validatePath('src/memory/../../node_modules/bad.js'),
    'Path traversal attempt detected'
  );
});

test('Path traversal with backslashes: src\\..\\..\\etc\\passwd', () => {
  assertThrows(
    () => validatePath('src\\..\\..\\etc\\passwd'),
    'Path traversal attempt detected'
  );
});

// ═══════════════════════════════════════════════════════════════
// DIRECTORY WHITELIST TESTS
// ═══════════════════════════════════════════════════════════════

test('Reject path outside whitelist: lib/malicious.ts', () => {
  const result = validatePath('lib/malicious.ts');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('allowed directories'), 'Error should mention allowed directories');
});

test('Reject path outside whitelist: /etc/passwd', () => {
  const result = validatePath('/etc/passwd');
  assert(result.isValid === false, 'Should be invalid');
});

test('Reject path outside whitelist: random-file.txt', () => {
  const result = validatePath('random-file.txt');
  assert(result.isValid === false, 'Should be invalid');
});

test('Reject path outside whitelist: ../src/file.ts', () => {
  assertThrows(
    () => validatePath('../src/file.ts'),
    'Path traversal attempt detected'
  );
});

// ═══════════════════════════════════════════════════════════════
// SENSITIVE FILE PATTERN TESTS
// ═══════════════════════════════════════════════════════════════

test('Reject sensitive file: .env', () => {
  const result = validatePath('.env');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('.env'), 'Error should mention .env');
});

test('Reject sensitive file: src/.env', () => {
  const result = validatePath('src/.env');
  assert(result.isValid === false, 'Should be invalid');
});

test('Reject sensitive directory: node_modules/package/index.js', () => {
  const result = validatePath('node_modules/package/index.js');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('node_modules'), 'Error should mention node_modules');
});

test('Reject sensitive directory: .git/config', () => {
  const result = validatePath('.git/config');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('.git'), 'Error should mention .git');
});

test('Reject sensitive file: package.json', () => {
  const result = validatePath('package.json');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('package.json'), 'Error should mention package.json');
});

test('Reject sensitive file: tsconfig.json', () => {
  const result = validatePath('tsconfig.json');
  assert(result.isValid === false, 'Should be invalid');
  assert(result.error?.includes('tsconfig.json'), 'Error should mention tsconfig.json');
});

// ═══════════════════════════════════════════════════════════════
// EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════

test('Empty path string', () => {
  const result = validatePath('');
  assert(result.isValid === false, 'Empty path should be invalid');
});

test('Path with trailing slash: src/', () => {
  const result = validatePath('src/');
  assert(result.isValid === true, 'Trailing slash should be allowed');
});

test('Path with ./ prefix: ./src/file.ts', () => {
  const result = validatePath('./src/file.ts');
  assert(result.isValid === true, 'Should normalize ./ and be valid');
  assert(result.normalizedPath === 'src/file.ts', 'Should remove ./ prefix');
});

test('Path normalization: src/./memory/./cache.ts', () => {
  const result = validatePath('src/./memory/./cache.ts');
  assert(result.isValid === true, 'Should be valid after normalization');
  assert(result.normalizedPath === 'src/memory/cache.ts', 'Should normalize correctly');
});

test('Windows-style path: src\\memory\\cache.ts', () => {
  const result = validatePath('src\\memory\\cache.ts');
  assert(result.isValid === true, 'Should handle Windows paths');
  assert(result.normalizedPath === 'src/memory/cache.ts', 'Should convert to forward slashes');
});

// ═══════════════════════════════════════════════════════════════
// FILE SIZE VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════

test('File size: Small file (1KB)', () => {
  const content = 'x'.repeat(1024); // 1KB
  assert(validateFileSize(content, 100), '1KB should pass 100KB limit');
});

test('File size: Exactly at limit (100KB)', () => {
  const content = 'x'.repeat(100 * 1024); // 100KB
  assert(validateFileSize(content, 100), '100KB should pass 100KB limit');
});

test('File size: Over limit (200KB)', () => {
  const content = 'x'.repeat(200 * 1024); // 200KB
  assert(!validateFileSize(content, 100), '200KB should fail 100KB limit');
});

test('File size: Custom limit (10KB)', () => {
  const content = 'x'.repeat(20 * 1024); // 20KB
  assert(!validateFileSize(content, 10), '20KB should fail 10KB limit');
});

test('File size: Empty file', () => {
  assert(validateFileSize('', 100), 'Empty file should pass');
});

// ═══════════════════════════════════════════════════════════════
// OPERATION COUNT VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════

test('Operation count: Zero operations', () => {
  assert(validateOperationCount(0, 5), 'Zero operations should pass');
});

test('Operation count: Under limit (3/5)', () => {
  assert(validateOperationCount(3, 5), '3 operations should pass 5 limit');
});

test('Operation count: At limit (5/5)', () => {
  assert(!validateOperationCount(5, 5), '5 operations should fail 5 limit');
});

test('Operation count: Over limit (10/5)', () => {
  assert(!validateOperationCount(10, 5), '10 operations should fail 5 limit');
});

test('Operation count: Custom limit (2)', () => {
  assert(validateOperationCount(1, 2), '1 operation should pass 2 limit');
  assert(!validateOperationCount(2, 2), '2 operations should fail 2 limit');
});

// ═══════════════════════════════════════════════════════════════
// ERROR CLASS TESTS
// ═══════════════════════════════════════════════════════════════

test('PathValidationError: Correct properties', () => {
  try {
    validatePath('../../../etc/passwd');
    throw new Error('Should have thrown PathValidationError');
  } catch (error: any) {
    assert(error instanceof PathValidationError, 'Should be PathValidationError instance');
    assert(error.name === 'PathValidationError', 'Error name should be PathValidationError');
    assert(error.path === '../../../etc/passwd', 'Error should preserve original path');
    assert(error.message.includes('Path traversal'), 'Error message should describe the issue');
  }
});

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`\n📊 Test Results:`);
console.log(`   ✅ Passed: ${passCount}`);
console.log(`   ❌ Failed: ${failCount}`);
console.log(`   📈 Total:  ${passCount + failCount}`);

if (failCount > 0) {
  console.log(`\n⚠️  ${failCount} test(s) failed!\n`);
  process.exit(1);
} else {
  console.log(`\n✨ All tests passed!\n`);
  process.exit(0);
}
