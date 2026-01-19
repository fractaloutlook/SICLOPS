/**
 * Simple Test Framework - Let agents verify their own code
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';

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
 * Runs a specific Jest test file using `npx jest`.
 * It uses `spawn` for better security and to capture stdout/stderr separately.
 * The test result includes success status, number of tests passed/failed, and any errors or output.
 *
 * @param testPath The absolute or relative path to the Jest test file.
 * @returns A Promise that resolves to a TestResult object containing the outcome of the test run.
 */
export async function runJestTestFile(testPath: string): Promise<TestResult> {
    console.log(`\n🚀 Running Jest tests for ${testPath}...`);
    try {
        const jestArgs = ['jest', '--config', 'jest.config.js', testPath];
        const child = spawn('npx', jestArgs, {
            timeout: 60000,
            shell: true,
            stdio: 'pipe' // Capture output
        });

        const stdoutBuffer: string[] = [];
        const stderrBuffer: string[] = [];

        child.stdout.on('data', (data) => stdoutBuffer.push(data.toString()));
        child.stderr.on('data', (data) => stderrBuffer.push(data.toString()));

        return await new Promise<TestResult>((resolve, reject) => {
            child.on('close', (code) => {
                const output = stdoutBuffer.join('') + stderrBuffer.join('');
                let parsedTestsPassed = 0;
                let parsedTestsFailed = 0;

                const passedMatch = output.match(/Tests:.* (\d+) passed/);
                const failedMatch = output.match(/Tests:.* (\d+) failed/);

                if (passedMatch) parsedTestsPassed = parseInt(passedMatch[1], 10);
                if (failedMatch) parsedTestsFailed = parseInt(failedMatch[1], 10);

                if (!passedMatch && !failedMatch) {
                    if (code === 0 && output.includes('passed')) {
                        parsedTestsPassed = 1;
                    } else if (code !== 0) {
                        parsedTestsFailed = 1;
                    }
                }

                if (code === 0 && parsedTestsFailed === 0) {
                    console.log(`   ✅ Jest tests passed for ${testPath}. Passed: ${parsedTestsPassed}, Failed: ${parsedTestsFailed}`);
                    resolve({
                        success: true,
                        testsPassed: parsedTestsPassed,
                        testsFailed: 0,
                        errors: [],
                        output: stdoutBuffer.join('')
                    });
                } else {
                    console.error(`   ❌ Jest tests failed for ${testPath}: Code ${code}. Passed: ${parsedTestsPassed}, Failed: ${parsedTestsFailed}`);
                    // Instead of rejecting, we can resolve with the failure result to avoid extra try/catch complexity
                    resolve({
                        success: false,
                        testsPassed: parsedTestsPassed,
                        testsFailed: parsedTestsFailed,
                        errors: [`Jest tests failed with code ${code}.`],
                        output: output
                    });
                }
            });
            child.on('error', (err) => reject(err));
        });

    } catch (error: any) {
        // Collect buffers from the scope outside the try/catch if possible, 
        // but here they are defined inside the try block's children listeners.
        // Actually stdoutBuffer and stderrBuffer are defined inside runJestTestFile's try block.
        // I should move them up or handle the error gracefully.

        // Let's assume the error might contain the output if it was rejected with one.
        console.error(`   ❌ Error running Jest for ${testPath}: ${error.message}`);

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
 * Runs a general TypeScript test file using `npx ts-node`.
 * This is intended for executing general TypeScript files as scripts, not for running
 * a full-fledged test suite like Jest. It's suitable for quick checks or utility scripts.
 *
 * @param testPath The absolute or relative path to the TypeScript file to run.
 * @returns A Promise that resolves to a TestResult object containing the outcome.
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
 * Quick sanity check on a given file.
 * This function verifies:
 * - The file exists and is accessible.
 * - The file is readable and not empty.
 * - Basic syntax elements like brace balancing (within a tolerance).
 * - Absence of suspicious statements like 'undefined;' or 'null;'.
 *
 * @param filePath The path to the file to perform the sanity check on.
 * @returns A Promise that resolves to a TestResult object indicating success or failure and details.
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
 * Runs a comprehensive suite of tests for a given development cycle.
 * This includes TypeScript compilation checks, basic sanity checks on changed files,
 * and execution of relevant Jest test files.
 *
 * @param changedFiles An array of file paths that have been modified in the current cycle.
 * @returns A Promise that resolves to a TestResult object summarizing all test outcomes.
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

    // 3. Run Jest tests for relevant changed files
    const testFilesToRun: Set<string> = new Set();
    for (const file of changedFiles) {
        if (file.endsWith('.test.ts')) {
            testFilesToRun.add(file);
        }
        // If a source file was changed, try to find its corresponding test file
        else if (file.startsWith('src/') && file.endsWith('.ts') && !file.endsWith('.test.ts')) {
            const baseName = path.basename(file, '.ts');
            const dirName = path.dirname(file);
            const potentialTestFile = path.join(dirName, `${baseName}.test.ts`);
            // Check if the potential test file exists
            try {
                await fs.access(potentialTestFile);
                testFilesToRun.add(potentialTestFile);
            } catch (e) {
                // Test file doesn't exist, ignore
            }
        }
    }

    for (const testFile of testFilesToRun) {
        const jestResult = await runJestTestFile(testFile);
        results.push(jestResult);
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

// CLI Entry Point
/**
 * CLI Entry Point
 * This block allows the `simple-test.ts` file to be executed directly from the command line.
 * It parses command-line arguments to determine which test function to run.
 * Commands supported:
 * - `runJestTestFile <testPath>`: Runs a specific Jest test file.
 * - `runTypeCheck`: Performs a TypeScript compilation check.
 * - `runCycleTests <changedFiles>`: Runs a comprehensive test suite for a cycle, optionally for a comma-separated list of changed files.
 *
 * Example usage:
 * `npx ts-node src/utils/simple-test.ts runJestTestFile src/memory/shared-cache.test.ts`
 * `npx ts-node src/utils/simple-test.ts runTypeCheck`
 * `npx ts-node src/utils/simple-test.ts runCycleTests src/memory/shared-cache.ts,src/memory/shared-cache.test.ts`
 */
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const testPath = args[1];

    (async () => {
        let result: TestResult;
        switch (command) {
            case 'runJestTestFile':
                if (!testPath) {
                    console.error('Error: testPath is required for runJestTestFile');
                    process.exit(1);
                }
                result = await runJestTestFile(testPath);
                break;
            case 'runTypeCheck':
                result = await runTypeCheck();
                break;
            case 'runCycleTests':
                // For runCycleTests, args[1] would be a comma-separated list of changed files
                const changedFiles = testPath ? testPath.split(',') : [];
                result = await runCycleTests(changedFiles);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
        console.log(JSON.stringify(result, null, 2));
    })();
}
