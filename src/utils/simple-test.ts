/**
 * Simple Test Framework - Let agents verify their own code
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface TestResult {
    success: boolean;
    testsPassed: number;
    testsFailed: number;
    errors: string[];
    output: string;
}

/**
 * Run TypeScript compilation check
 */
export async function runTypeCheck(): Promise<TestResult> {
    try {
        const { stdout, stderr } = await execAsync('npx tsc --noEmit');
        return {
            success: true,
            testsPassed: 1,
            testsFailed: 0,
            errors: [],
            output: 'TypeScript compilation successful'
        };
    } catch (error: any) {
        const errorOutput = error.stderr || error.stdout || error.message;
        return {
            success: false,
            testsPassed: 0,
            testsFailed: 1,
            errors: [errorOutput],
            output: errorOutput
        };
    }
}

/**
 * Run a specific test file
 */
export async function runTestFile(testPath: string): Promise<TestResult> {
    try {
        const { stdout, stderr } = await execAsync(`npx ts-node ${testPath}`);
        return {
            success: true,
            testsPassed: 1,
            testsFailed: 0,
            errors: [],
            output: stdout
        };
    } catch (error: any) {
        return {
            success: false,
            testsPassed: 0,
            testsFailed: 1,
            errors: [error.message],
            output: error.stdout || error.message
        };
    }
}

/**
 * Quick sanity check - verify file exists and has basic syntax
 */
export async function quickSanityCheck(filePath: string): Promise<TestResult> {
    const errors: string[] = [];

    try {
        // Check file exists
        await fs.access(filePath);

        // Check file is readable
        const content = await fs.readFile(filePath, 'utf-8');

        // Basic syntax checks
        if (content.trim().length === 0) {
            errors.push('File is empty');
        }

        // Count braces (should be balanced for most files)
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;
        if (Math.abs(openBraces - closeBraces) > 2) {
            errors.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
        }

        // Check for obvious syntax errors
        if (content.includes('undefined;') || content.includes('null;')) {
            errors.push('Contains suspicious "undefined;" or "null;" statements');
        }

        if (errors.length > 0) {
            return {
                success: false,
                testsPassed: 0,
                testsFailed: errors.length,
                errors,
                output: errors.join('\n')
            };
        }

        return {
            success: true,
            testsPassed: 1,
            testsFailed: 0,
            errors: [],
            output: 'Basic syntax checks passed'
        };
    } catch (error: any) {
        return {
            success: false,
            testsPassed: 0,
            testsFailed: 1,
            errors: [error.message],
            output: error.message
        };
    }
}

/**
 * Comprehensive test suite for a cycle
 */
export async function runCycleTests(changedFiles: string[]): Promise<TestResult> {
    const results: TestResult[] = [];

    // 1. Run type check
    console.log('\n🧪 Running TypeScript compilation check...');
    const typeCheckResult = await runTypeCheck();
    results.push(typeCheckResult);

    if (!typeCheckResult.success) {
        console.log('   ❌ TypeScript errors detected\n');
        return typeCheckResult;
    }
    console.log('   ✅ TypeScript compilation passed\n');

    // 2. Run sanity checks on changed files
    for (const file of changedFiles) {
        if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            console.log(`   Checking ${file}...`);
            const sanityResult = await quickSanityCheck(file);
            results.push(sanityResult);

            if (!sanityResult.success) {
                console.log(`   ⚠️  Issues found in ${file}`);
            }
        }
    }

    // Aggregate results
    const totalPassed = results.reduce((sum, r) => sum + r.testsPassed, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.testsFailed, 0);
    const allErrors = results.flatMap(r => r.errors);

    return {
        success: totalFailed === 0,
        testsPassed: totalPassed,
        testsFailed: totalFailed,
        errors: allErrors,
        output: `${totalPassed} checks passed, ${totalFailed} failed`
    };
}
