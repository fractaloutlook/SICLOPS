/**
 * Test script to validate the pattern-based file edit system.
 * Run with: npx ts-node src/utils/test-edit-system.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_FILE = path.join(__dirname, '../../test-edit-target.tmp.ts');

interface EditTest {
    name: string;
    initialContent: string;
    edits: Array<{ find: string; replace: string }>;
    expectedResult: string | null;  // null = expect failure
    expectedError?: string;
}

// Simulated edit logic (matching the orchestrator's handleFileEdit)
function applyEdits(content: string, edits: Array<{ find: string; replace: string }>): { success: boolean; content?: string; error?: string } {
    let result = content;

    for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const findPattern = edit.find;

        // Check if pattern exists
        const firstIndex = result.indexOf(findPattern);
        if (firstIndex === -1) {
            return {
                success: false,
                error: `Edit ${i + 1}: Pattern not found in file.`
            };
        }

        // Check if pattern is unique
        const lastIndex = result.lastIndexOf(findPattern);
        if (firstIndex !== lastIndex) {
            const occurrences = result.split(findPattern).length - 1;
            return {
                success: false,
                error: `Edit ${i + 1}: Pattern appears ${occurrences} times. Add more context.`
            };
        }

        // Apply the replacement
        result = result.replace(findPattern, edit.replace);
    }

    return { success: true, content: result };
}

const tests: EditTest[] = [
    {
        name: 'Simple single-line edit',
        initialContent: `function hello() {
    console.log("hello");
}`,
        edits: [{
            find: 'console.log("hello");',
            replace: 'console.log("world");'
        }],
        expectedResult: `function hello() {
    console.log("world");
}`
    },
    {
        name: 'Multi-line pattern edit',
        initialContent: `class Example {
    private value: number;

    getValue(): number {
        return this.value;
    }
}`,
        edits: [{
            find: `getValue(): number {
        return this.value;
    }`,
            replace: `getValue(): number {
        return this.value ?? 0;
    }`
        }],
        expectedResult: `class Example {
    private value: number;

    getValue(): number {
        return this.value ?? 0;
    }
}`
    },
    {
        name: 'Pattern not found',
        initialContent: `const x = 1;`,
        edits: [{
            find: 'const y = 2;',
            replace: 'const y = 3;'
        }],
        expectedResult: null,
        expectedError: 'Pattern not found'
    },
    {
        name: 'Non-unique pattern (should fail)',
        initialContent: `const a = 1;
const b = 1;
const c = 1;`,
        edits: [{
            find: '= 1',
            replace: '= 2'
        }],
        expectedResult: null,
        expectedError: 'appears 3 times'
    },
    {
        name: 'Multiple edits in sequence',
        initialContent: `function foo() { return 1; }
function bar() { return 2; }`,
        edits: [
            { find: 'return 1;', replace: 'return 10;' },
            { find: 'return 2;', replace: 'return 20;' }
        ],
        expectedResult: `function foo() { return 10; }
function bar() { return 20; }`
    },
    {
        name: 'Whitespace-sensitive match',
        initialContent: `    indented line`,
        edits: [{
            find: '    indented line',
            replace: '    modified line'
        }],
        expectedResult: `    modified line`
    }
];

async function runTests() {
    console.log('\n========================================');
    console.log('  PATTERN-BASED EDIT SYSTEM TESTS');
    console.log('========================================\n');

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        process.stdout.write(`Testing: ${test.name}... `);

        const result = applyEdits(test.initialContent, test.edits);

        if (test.expectedResult === null) {
            // Expecting failure
            if (!result.success) {
                if (test.expectedError && result.error?.includes(test.expectedError)) {
                    console.log('PASS (correctly failed)');
                    passed++;
                } else {
                    console.log(`FAIL (wrong error: "${result.error}")`);
                    failed++;
                }
            } else {
                console.log('FAIL (should have failed but succeeded)');
                failed++;
            }
        } else {
            // Expecting success
            if (result.success && result.content === test.expectedResult) {
                console.log('PASS');
                passed++;
            } else if (!result.success) {
                console.log(`FAIL (error: "${result.error}")`);
                failed++;
            } else {
                console.log('FAIL (content mismatch)');
                console.log('  Expected:', JSON.stringify(test.expectedResult));
                console.log('  Got:     ', JSON.stringify(result.content));
                failed++;
            }
        }
    }

    console.log('\n========================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('========================================\n');

    // Test line number formatting
    console.log('Line number formatting test:');
    const sampleContent = `line one
line two
line three
line four
line five
line six
line seven
line eight
line nine
line ten
line eleven`;

    const lines = sampleContent.split('\n');
    const padding = String(lines.length).length;
    const numbered = lines.map((line, i) =>
        `${String(i + 1).padStart(padding)} | ${line}`
    ).join('\n');

    console.log(numbered);
    console.log('\n========================================\n');

    return failed === 0;
}

// Run if called directly
runTests().then(success => {
    process.exit(success ? 0 : 1);
});
