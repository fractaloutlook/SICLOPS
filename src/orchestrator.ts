import { Agent } from './agent';
import { BaseAgent } from './agent-base';
import { HumanAgent } from './human-agent';
import { FileUtils } from './utils/file-utils';
import * as path from 'path';
import { AGENT_CONFIGS, API_KEYS, AGENT_WORKFLOW_ORDER } from './config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AgentConfig, ProjectFile, Changes, OrchestratorContext, FileWriteRequest, FileReadRequest, FileEditRequest, CodeChange } from './types';
import { SharedMemoryCache, CacheEntry } from './memory/shared-cache';
import { PathValidator } from './validation/path-validator';
import { generateVersion } from './utils/version-utils';
import { detectTaskCompletion, shouldContinueNextCycle } from './utils/task-completion';
import { displayProgressDashboard, extractProgressFromHistory, displayCycleSummary, extractKeyActions } from './utils/progress-dashboard';
import { autoCommitCycle, extractChangedFiles, generateCycleSummary } from './utils/git-auto-commit';
import { summarizeContext, getContextHealth } from './utils/context-summarizer';
import { runCycleTests } from './utils/simple-test';
import * as fs from 'fs';

interface OrchestratorConfig {
    maxCycles: number;
    logDirectory: string;
    costSummaryPath: string;
    simulationMode?: boolean;
    conversationMode?: boolean;  // For team discussions
    requireConsensus?: boolean;  // If false, agents just pass in sequence instead of debating to consensus
    humanComment?: string;  // Human comment passed from command line
}

// System capabilities summary injected into all agent prompts
const SYSTEM_CAPABILITIES = `
📚 SYSTEM CAPABILITIES (built by your team):

**File Operations:**
- fileRead: Read any file (shown with line numbers)
- lineRead: Read specific line range (e.g. 1-100)
- fileGrep: Search for string/pattern in a file
- fileEdit: Pattern-match find/replace editing
- fileWrite: Create new files (test files auto-run!)
- All edits auto-validated with TypeScript

**Workflow:**
- Normal: Morgan → Sam → Jordan → Alex → Pierre
- Self-pass: Up to 3 times for multi-step work
- Return for fix: Set returnForFix=true to pass backwards when you find bugs

**Memory:**
- Agent notebooks: notes/{name}-notes.md (persists across runs)
- Context: data/state/orchestrator-context.json (decisions, costs)
- SharedMemoryCache: src/memory/shared-cache.ts (built, not yet agent-accessible)

**What You Can Change:**
- src/config.ts - Your roles, personalities, team composition
- src/orchestrator.ts - How cycles work (careful!)
- Anything else - this is self-improvement code

**Documentation:**
- docs/SYSTEM_CAPABILITIES.md - Feature catalog
- docs/AGENT_GUIDE.md - How to modify the system
`;

export class Orchestrator {
    private agents: Map<string, BaseAgent>;
    private anthropicClient: Anthropic;
    private openaiClient: OpenAI;
    private cycleCount: number = 0;
    private cycleCosts: Array<{ cycle: string, total: number, logPath: string }> = [];
    private sharedCache: SharedMemoryCache;
    private currentPhase: 'discussion' | 'implementation' = 'discussion';
    private googleClient: GoogleGenerativeAI;

    constructor(private config: OrchestratorConfig) {
        this.anthropicClient = new Anthropic({ apiKey: API_KEYS.anthropic });
        this.openaiClient = new OpenAI({ apiKey: API_KEYS.openai });
        if (!API_KEYS.google) {
            throw new Error('GOOGLE_API_KEY is not set. Please set the GOOGLE_API_KEY environment variable.');
        }
        this.googleClient = new GoogleGenerativeAI(API_KEYS.google);
        this.agents = new Map<string, BaseAgent>();
        this.sharedCache = new SharedMemoryCache();
        console.log('✅ SharedMemoryCache initialized');
        this.initializeAgents();
    }

    private initializeAgents(): void {
        for (const [key, agentConfig] of Object.entries(AGENT_CONFIGS)) {
            if (key === 'orchestrator') continue;

            if (agentConfig.model === 'human') {
                this.agents.set(
                    agentConfig.name,
                    new HumanAgent(agentConfig, this.config.logDirectory)
                );
                continue;
            }

            let client: Anthropic | OpenAI | GoogleGenerativeAI;

            if (agentConfig.model.startsWith('claude')) {
                client = this.anthropicClient;
            } else if (agentConfig.model.startsWith('gpt')) {
                client = this.openaiClient;
            } else if (agentConfig.model.startsWith('gemini')) {
                client = this.googleClient;
            } else {
                throw new Error(`Unknown model prefix for agent ${agentConfig.name}: ${agentConfig.model}`);
            }

            this.agents.set(
                agentConfig.name,
                new Agent(agentConfig, this.config.logDirectory, client)
            );
        }
    }

    /**
     * Determine if we should use consensus mode based on current phase.
     * - Discussion phase: Use consensus (debate, vote)
     * - Implementation phase: Use sequential workflow
     */
    private shouldUseConsensus(): boolean {
        // Use consensus for discussion phase, sequential for implementation
        return this.currentPhase === 'discussion';
    }

    // ═══════════════════════════════════════════════════════════════
    // CONTEXT MANAGEMENT (Phase 1: State Persistence)
    // ═══════════════════════════════════════════════════════════════

    private getContextPath(): string {
        return `${this.config.logDirectory}/../state/orchestrator-context.json`;
    }

    private getCachePath(): string {
        return `${this.config.logDirectory}/../state/shared-cache.json`;
    }

    async saveSharedCache(): Promise<void> {
        try {
            const cachePath = this.getCachePath();
            const state = this.sharedCache.exportState();
            await FileUtils.writeFile(cachePath, JSON.stringify(state, null, 2));
            // console.log(`💾 Saved shared cache (${state.length} entries)`);
        } catch (error: any) {
            console.error(`❌ Failed to save shared cache: ${error}`);
        }
    }

    async loadSharedCache(): Promise<void> {
        try {
            const cachePath = this.getCachePath();
            // Check if file exists first
            try {
                const fs = await import('fs/promises');
                await fs.access(cachePath);
            } catch (error: any) {
                console.log('   (No shared cache file found, starting fresh)');
                return;
            }

            const content = await FileUtils.readFile(cachePath);
            const state = JSON.parse(content) as CacheEntry[];
            this.sharedCache.importState(state);
            console.log(`📖 Loaded shared cache (${state.length} entries)`);
        } catch (error: any) {
            console.error(`❌ Failed to load shared cache: ${error}`);
        }
    }

    async loadContext(silent: boolean = true): Promise<OrchestratorContext | null> {
        try {
            const contextPath = this.getContextPath();
            const content = await FileUtils.readFile(contextPath);
            const context = JSON.parse(content) as OrchestratorContext;
            if (!silent) {
                console.log(`📖 Loaded context from run #${context.runNumber}`);
            }

            // Load cached decisions into SharedMemoryCache
            if (!silent && context.discussionSummary?.keyDecisions && context.discussionSummary.keyDecisions.length > 0) {
                console.log(`\n📋 Loading ${context.discussionSummary.keyDecisions.length} previous decisions:`);
                for (const decision of context.discussionSummary.keyDecisions) {
                    // Show first 120 chars of each decision for human readability
                    const preview = decision.length > 120 ? decision.substring(0, 117) + '...' : decision;
                    console.log(`   ${preview}`);

                    this.sharedCache.store(
                        `decision_${Date.now()}_${Math.random()}`,
                        decision,
                        'decision',
                        'Loaded from previous run context'
                    );
                }
                console.log('');
            }

            return context;
        } catch (error: any) {
            // No context file exists - this is a fresh start
            return null;
        }
    }

    async saveContext(context: OrchestratorContext): Promise<void> {
        const contextPath = this.getContextPath();
        await FileUtils.ensureDir(`${this.config.logDirectory}/../state`);

        // Check if context needs summarization
        const health = getContextHealth(context);
        if (health.needsSummarization) {
            console.log(`\n📦 Summarizing context (${health.historySize} entries, ~${health.estimatedTokens} tokens)`);
            context = summarizeContext(context);
            console.log(`   ✨ Reduced to ${context.history.length} entries\n`);
        }

        await FileUtils.writeFile(contextPath, JSON.stringify(context, null, 2));
    }

    async initializeContext(): Promise<OrchestratorContext> {
        const context: OrchestratorContext = {
            version: 'v1.0',
            runNumber: 1,
            startedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            currentPhase: 'discussion',
            discussionSummary: {
                topic: 'Framework Development Priorities',
                keyDecisions: [],
                consensusReached: false,
                consensusSignals: {}
            },
            codeChanges: [],
            agentStates: {},
            nextAction: {
                type: 'continue_discussion',
                reason: 'Starting fresh discussion',
                targetAgent: 'Alex'
            },
            history: [],
            totalCost: 0,
            humanNotes: '',
            summarizedHistory: '' // Initialize summarizedHistory
        };

        await this.saveContext(context);
        console.log(`🆕 Initialized fresh context for run #1`);
        return context;
    }

    async updateContext(updates: Partial<OrchestratorContext>): Promise<void> {
        let context = await this.loadContext();
        if (!context) {
            context = await this.initializeContext();
        }

        Object.assign(context, updates);
        context.lastUpdated = new Date().toISOString();
        await this.saveContext(context);
    }

    generateBriefing(context: OrchestratorContext): string {
        const lastRun = context.history[context.history.length - 1];
        const agentList = Object.entries(context.agentStates)
            .map(([name, state]) => `  - ${name}: ${state.timesProcessed} turns, $${state.totalCost.toFixed(4)}`)
            .join('\n');

        return `
╔════════════════════════════════════════════════════════════════╗
║  ORCHESTRATOR BRIEFING - RUN #${context.runNumber}                        ║
╚════════════════════════════════════════════════════════════════╝

PREVIOUS RUN:
${context.summarizedHistory || 'This is the first run'}

CURRENT PHASE: ${context.currentPhase}

DISCUSSION TOPIC:
${context.discussionSummary.topic}

KEY DECISIONS SO FAR:
${context.discussionSummary.keyDecisions.length > 0
                ? context.discussionSummary.keyDecisions.map((d, i) => `  ${i + 1}. ${d}`).join('\n')
                : '  (None yet)'}

CONSENSUS STATUS:
${Object.entries(context.discussionSummary.consensusSignals).length > 0
                ? Object.entries(context.discussionSummary.consensusSignals)
                    .map(([agent, signal]) => `  - ${agent}: ${signal}`)
                    .join('\n')
                : '  (No signals yet)'}

NEXT ACTION: ${context.nextAction.type}
Reason: ${context.nextAction.reason}

AGENT STATES:
${agentList || '  (No agents processed yet)'}

TOTAL COST SO FAR: $${context.totalCost.toFixed(4)}

HUMAN NOTES:
${context.humanNotes || '(None)'}

═══════════════════════════════════════════════════════════════════
`;
    }

    /**
     * Handles file write requests from agents, orchestrating the full lifecycle from request to validation.
     * This includes path validation, writing to a temporary file, performing TypeScript compilation checks,
     * moving the validated file to its final destination, and automatically running tests for test files.
     * The test execution uses `child_process.spawn` for enhanced security against command injection.
     *
     * @param fileWrite The {@link FileWriteRequest} object containing the file path and content.
     * @param agentName The name of the agent requesting the file write.
     * @returns A Promise that resolves to an object indicating success status and an optional error message.
     */
    private async handleFileWrite(fileWrite: FileWriteRequest, agentName: string): Promise<{ success: boolean; error?: string }> {
        console.log(`\n📝 ${agentName} requesting file write: ${fileWrite.filePath}`);
        console.log(`   Reason: ${fileWrite.reason}`);

        // Validate path before proceeding
        try {
            PathValidator.validatePath(fileWrite.filePath);
            // Normalize path
            fileWrite.filePath = path.normalize(fileWrite.filePath).replace(/\\/g, '/');
        } catch (error: any) {
            console.error(`   ❌ Path validation failed: ${error.message}`);
            return { success: false, error: error.message };
        }

        // Phase Enforcement: Block non-note writes outside of implementation phase
        if (this.currentPhase !== 'implementation' && !fileWrite.filePath.includes('notes/')) {
            const error = `Access denied: Creating or writing to '${fileWrite.filePath}' is only allowed during the 'implementation' phase. We are currently in '${this.currentPhase}'. Please reach consensus first.`;
            console.error(`   ❌ ${error}`);
            return { success: false, error };
        }

        const context = await this.loadContext();
        if (!context) {
            console.error('❌ No context loaded, cannot track code changes');
            return { success: false, error: 'No context loaded' };
        }

        // Create code change record
        const codeChange: CodeChange = {
            file: fileWrite.filePath,
            action: fileWrite.filePath.includes('src/') && !await this.fileExists(fileWrite.filePath) ? 'create' : 'edit',
            content: fileWrite.content,
            appliedAt: null,
            validatedAt: null,
            status: 'pending'
        };

        // Safety Guard: Prevent accidental overwrites of existing files via fileWrite
        // Agents should use fileEdit for existing files.
        if (await this.fileExists(fileWrite.filePath)) {
            const error = `Safety Violation: File '${fileWrite.filePath}' already exists. Use 'fileEdit' for modifications, or delete the file first if you intended to replace it entirely. 'fileWrite' is strictly for brand NEW files.`;
            console.error(`   ❌ ${error}`);
            return { success: false, error };
        }

        try {
            // Step 1: Write to temporary location for validation
            const tempPath = `${fileWrite.filePath}.tmp`;
            const lastSlash = fileWrite.filePath.lastIndexOf('/');
            if (lastSlash > 0) {
                await FileUtils.ensureDir(fileWrite.filePath.substring(0, lastSlash));
            }
            await FileUtils.writeFile(tempPath, fileWrite.content);

            console.log(`   ✓ Wrote to temp file: ${tempPath}`);

            // Step 2: Validate TypeScript compilation
            console.log(`   🔍 Validating TypeScript compilation...`);
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            try {
                await execAsync('npx tsc --noEmit', { timeout: 30000 });
                console.log(`   ✅ TypeScript validation passed!`);

                // Step 3: Move temp file to actual location
                const fs = await import('fs/promises');
                await fs.rename(tempPath, fileWrite.filePath);

                codeChange.appliedAt = new Date().toISOString();
                codeChange.validatedAt = new Date().toISOString();
                codeChange.status = 'validated';

                console.log(`   💾 Saved to: ${fileWrite.filePath}`);

                // Track in context
                context.codeChanges.push(codeChange);
                await this.saveContext(context);

                console.log(`   📊 Status: ${codeChange.status}\n`);

                // Auto-run tests if this is a test file
                if (fileWrite.filePath.includes('/__tests__/') || fileWrite.filePath.endsWith('.test.ts')) {
                    const testFilePath = path.resolve(fileWrite.filePath); // Ensure absolute path
                    console.log(`   🚀 Running tests for ${testFilePath}...`);
                    try {
                        const { spawn } = await import('child_process');
                        const jestArgs = ['jest', '--config', 'jest.config.js', testFilePath];
                        // Using shell: true is required for npx to work correctly on Windows
                        const command = `npx ${jestArgs.join(' ')}`;
                        const child = spawn(command, {
                            timeout: 60000,
                            shell: true
                        });

                        const stdoutBuffer: string[] = [];
                        const stderrBuffer: string[] = [];

                        child.stdout.on('data', (data) => stdoutBuffer.push(data.toString()));
                        child.stderr.on('data', (data) => stderrBuffer.push(data.toString()));

                        await new Promise<void>((resolve, reject) => {
                            child.on('close', (code) => {
                                if (code === 0) {
                                    resolve();
                                } else {
                                    reject(new Error(`Test command failed with code ${code}.\nSTDOUT: ${stdoutBuffer.join('')}\nSTDERR: ${stderrBuffer.join('')}`));
                                }
                            });
                            child.on('error', (err) => reject(err));
                        });
                        console.log(`   ✅ Tests passed for ${testFilePath}`);
                        console.log(`      STDOUT:\n${stdoutBuffer.join('')}`);
                        if (stderrBuffer.length > 0) console.warn(`      STDERR:\n${stderrBuffer.join('')}`);
                    } catch (testError: any) {
                        console.error(`   ❌ Tests failed for ${testFilePath}:`);
                        console.error(`      ERROR: ${testError.message}`);
                        if (testError.stdout) console.error(`      STDOUT:\n${testError.stdout}`);
                        if (testError.stderr) console.error(`      STDERR:\n${testError.stderr}`);
                    }
                }

                return { success: true };

            } catch (compileError: any) {
                // Compilation failed
                const errorMsg = compileError.stderr || compileError.stdout || compileError.message;
                console.error(`   ❌ TypeScript compilation failed:`);
                console.error(`   ${errorMsg.substring(0, 500)}`);

                codeChange.status = 'failed';
                codeChange.validationError = errorMsg;

                // Save failed attempt for debugging (don't delete it!)
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const failedPath = `${fileWrite.filePath}.failed.${timestamp}.ts`;
                try {
                    const fs = await import('fs/promises');
                    await fs.rename(tempPath, failedPath);
                    console.log(`   💾 Saved failed attempt to: ${failedPath}`);
                } catch (e: any) {
                    console.error(`   Failed to save failed attempt: ${e}`);
                }

                console.log(`   ⚠️  File NOT saved due to compilation errors`);

                // CRITICAL: Return error to agent so they know it failed
                return {
                    success: false,
                    error: `TypeScript compilation failed:\n${errorMsg.substring(0, 500)}`
                };
            }

        } catch (error: any) {
            console.error(`   ❌ Error handling file write: ${error.message}`);
            codeChange.status = 'failed';
            codeChange.validationError = error.message;

            // Track failed attempt
            context.codeChanges.push(codeChange);
            await this.saveContext(context);

            return { success: false, error: error.message };
        }
    }

    /**
     * Auto-run a test file and report results.
     * This happens automatically when test files are written.
     */
    private async runTestFile(testPath: string, agentName: string): Promise<void> {
        console.log(`\n🧪 ${agentName} wrote a test file - running automatically...`);
        console.log(`   Test: ${testPath}`);

        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            const result = await execAsync(`npx ts-node ${testPath}`, {
                timeout: 60000,  // 60 second timeout for tests
                maxBuffer: 1024 * 1024  // 1MB buffer for output
            });

            // Test passed
            console.log(`   ✅ Test passed!`);
            if (result.stdout) {
                console.log(`\n   Output:\n${result.stdout.split('\n').map(l => '   ' + l).join('\n')}`);
            }

        } catch (error: any) {
            // Test failed
            console.error(`   ❌ Test failed!`);
            const output = error.stdout || error.stderr || error.message;
            console.error(`\n   Error:\n${output.substring(0, 1000).split('\n').map((l: string) => '   ' + l).join('\n')}`);

            // Note: We don't throw - just report the failure
            // Next agent will see the test failure in history
        }

        console.log(`\n   ⚠️  Next agent will see test results and can fix if needed.\n`);
    }

    /**
     * Format file content with line numbers for agent display.
     * This allows agents to reference specific locations even though
     * edits use pattern matching (not line numbers).
     */
    private formatWithLineNumbers(content: string, startingLine: number = 1): string {
        const lines = content.split('\n');
        const padding = String(lines.length + startingLine).length;
        return lines.map((line, i) =>
            `${String(i + startingLine).padStart(padding)} | ${line}`
        ).join('\n');
    }

    /**
     * Find files with similar names to help agents correct wrong paths.
     * Searches recursively from project root for files with similar basenames.
     */
    private findSimilarFiles(requestedPath: string): string[] {
        const basename = path.basename(requestedPath);
        // Extract key words from filename (e.g., "shared-memory-cache.test.ts" -> ["shared", "memory", "cache", "test"])
        const keywords = basename.toLowerCase().replace(/\.(ts|js|tsx|jsx|json|md)$/, '').split(/[-_\.]+/).filter(k => k.length > 2);

        const suggestions: string[] = [];

        const searchDir = (dir: string, depth: number = 0) => {
            if (depth > 5 || suggestions.length >= 5) return; // Limit recursion
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        searchDir(fullPath, depth + 1);
                    } else if (entry.isFile()) {
                        const entryLower = entry.name.toLowerCase();
                        // Check if any keyword matches
                        const matchCount = keywords.filter(k => entryLower.includes(k)).length;
                        if (matchCount >= Math.min(2, keywords.length)) {
                            suggestions.push(fullPath);
                        }
                    }
                }
            } catch { /* ignore permission errors */ }
        };

        searchDir('.');
        return suggestions.slice(0, 5);
    }

    /**
     * Handles file read requests from agents
     */
    private async handleFileRead(fileRead: FileReadRequest, agentName: string, projectFile?: ProjectFile): Promise<{ success: boolean; content?: string; error?: string }> {
        console.log(`\n📖 ${agentName} requesting file read: ${fileRead?.filePath || 'undefined'}`);
        console.log(`   Reason: ${fileRead?.reason || 'No reason provided'}`);

        if (!fileRead) {
            return { success: false, error: 'File read request is null/undefined' };
        }

        if (!fileRead.filePath || typeof fileRead.filePath !== 'string' || fileRead.filePath.trim().length === 0) {
            const errorMessage = `File read request failed: 'filePath' is invalid. Received: '${fileRead.filePath}'. Please provide a valid string path.`;
            console.error(`   ❌ ${errorMessage}`);
            return { success: false, error: errorMessage };
        }

        // Validate path before proceeding
        try {
            PathValidator.validatePath(fileRead.filePath);
            // Normalize path for internal use
            fileRead.filePath = path.normalize(fileRead.filePath).replace(/\\/g, '/');
        } catch (error: any) {
            console.error(`   ❌ Path validation failed: ${error.message}`);
            return { success: false, error: error.message };
        }

        // 🛠️ REDUNDANT READ CACHE: Check if we already have the full file in history
        if (projectFile && projectFile.history) {
            const cachedEntry = [...projectFile.history].reverse().find(e =>
                e.action === 'file_read_success' &&
                e.changes?.location === fileRead.filePath &&
                e.notes.includes('lines):')
            );

            if (cachedEntry) {
                console.log(`   💎 Redundant read blocked for ${fileRead.filePath}`);
                return {
                    success: false,
                    error: `You already have the latest content for ${fileRead.filePath} in your history. Do not re-read the same file multiple times unless it was changed by another agent or is critical.`
                };
            }
        }

        try {
            if (!await this.fileExists(fileRead.filePath)) {
                console.warn(`   ⚠️  File does not exist: ${fileRead.filePath}`);

                // Try to find similar files
                const similar = this.findSimilarFiles(fileRead.filePath);
                if (similar.length > 0) {
                    const suggestions = similar.map(f => `     - ${f}`).join('\n');
                    console.log(`   💡 Did you mean one of these?\n${suggestions}`);
                    return {
                        success: false,
                        error: `File does not exist: ${fileRead.filePath}\n\nDid you mean one of these?\n${similar.join('\n')}`
                    };
                }

                return { success: false, error: 'File does not exist' };
            }

            const content = await FileUtils.readFile(fileRead.filePath);
            const lineCount = content.split('\n').length;

            console.log(`   ✅ Read ${lineCount} lines from ${fileRead.filePath}`);

            return { success: true, content };

        } catch (error: any) {
            console.error(`   ❌ Error reading file: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handles surgical line read requests (reading specific ranges)
     */
    private async handleLineRead(filePath: string, startLine: number, endLine: number, agentName: string): Promise<{ success: boolean; content?: string; error?: string }> {
        console.log(`\n📖 ${agentName} requesting line read: ${filePath} (L${startLine}-L${endLine})`);

        try {
            PathValidator.validatePath(filePath);
            const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');

            if (!await this.fileExists(normalizedPath)) {
                return { success: false, error: 'File does not exist' };
            }

            const content = await FileUtils.readFile(normalizedPath);
            const lines = content.split('\n');
            const result = lines.slice(startLine - 1, endLine).join('\n');

            console.log(`   ✅ Read ${endLine - startLine + 1} lines from ${normalizedPath}`);
            return { success: true, content: result };
        } catch (error: any) {
            console.error(`   ❌ Error reading lines: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handles file grep requests (searching for patterns)
     */
    private async handleFileGrep(filePath: string, pattern: string, agentName: string): Promise<{ success: boolean; matches?: string[]; error?: string }> {
        console.log(`\n🔍 ${agentName} requesting file grep: "${pattern}" in ${filePath}`);

        try {
            PathValidator.validatePath(filePath);
            const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');

            if (!await this.fileExists(normalizedPath)) {
                return { success: false, error: 'File does not exist' };
            }

            const content = await FileUtils.readFile(normalizedPath);
            const lines = content.split('\n');
            const matches: string[] = [];

            lines.forEach((line, index) => {
                const lineContent = line.trim();
                if (lineContent.toLowerCase().includes(pattern.toLowerCase())) {
                    matches.push(`L${index + 1}: ${lineContent}`);
                }
            });

            console.log(`   ✅ Found ${matches.length} matches in ${normalizedPath}`);
            return { success: true, matches: matches.slice(0, 50) }; // Cap to 50 results
        } catch (error: any) {
            console.error(`   ❌ Error searching file: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handles file edit requests using PATTERN MATCHING (not line numbers).
     *
     * Each edit specifies:
     *   - find: exact string to locate (must be unique in file)
     *   - replace: what to replace it with
     *
     * This approach is more robust than line-based editing because:
     *   1. Agents don't need to count lines
     *   2. The pattern itself serves as verification
     *   3. It's the same approach Claude Code uses successfully
     */
    private async handleFileEdit(fileEdit: FileEditRequest, agentName: string): Promise<{ success: boolean; error?: string }> {
        console.log(`\n✏️  ${agentName} requesting file edit: ${fileEdit?.filePath || 'undefined'}`);
        console.log(`   Reason: ${fileEdit?.reason || 'No reason provided'} `);

        if (!fileEdit || !fileEdit.edits || !Array.isArray(fileEdit.edits)) {
            const error = `Invalid fileEdit request: 'edits' array is missing or invalid.`;
            console.error(`   ❌ ${error} `);
            return { success: false, error };
        }
        console.log(`   Edits: ${fileEdit.edits.length} change(s)`);

        // Validate path before proceeding
        try {
            PathValidator.validatePath(fileEdit.filePath);
            // Normalize path
            fileEdit.filePath = path.normalize(fileEdit.filePath).replace(/\\/g, '/');
        } catch (error: any) {
            console.error(`   ❌ Path validation failed: ${error.message}`);
            return { success: false, error: error.message };
        }

        // Phase Enforcement: Block non-note edits outside of implementation phase
        if (this.currentPhase !== 'implementation' && !fileEdit.filePath.includes('notes/')) {
            const error = `Access denied: Code edits to '${fileEdit.filePath}' are only allowed during the 'implementation' phase. We are currently in '${this.currentPhase}'. Please reach consensus first.`;
            console.error(`   ❌ ${error}`);
            return { success: false, error };
        }

        const context = await this.loadContext();
        if (!context) {
            return { success: false, error: 'No context loaded' };
        }

        try {
            // Read current file
            if (!await this.fileExists(fileEdit.filePath)) {
                return { success: false, error: 'File does not exist - use fileWrite to create new files' };
            }

            let content = await FileUtils.readFile(fileEdit.filePath);

            // Apply each edit using pattern matching
            for (let i = 0; i < fileEdit.edits.length; i++) {
                const edit = fileEdit.edits[i];
                const findPattern = edit.find;
                // resilient matching if exact fails
                let firstIndex = content.indexOf(findPattern);

                if (firstIndex === -1) {
                    // Try whitespace-insensitive matching
                    console.log(`   🔸 Exact match failed for Edit ${i + 1}, trying resilient match...`);

                    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
                    const normalizedFind = normalize(findPattern);
                    const normalizedContent = normalize(content);

                    if (normalizedContent.includes(normalizedFind)) {
                        console.log(`   ✨ Resilient match found! Proceeding with replacement.`);
                        // For simplicity, we fallback to a more complex regex approach if needed, 
                        // but for now we'll just report what went wrong if we can't easily map back.
                        // Actually, let's implement a regex that handles it.

                        const regexString = findPattern
                            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex
                            .replace(/\s+/g, '\\s+'); // Allow any whitespace
                        const regex = new RegExp(regexString);
                        const match = content.match(regex);

                        if (match && match.index !== undefined) {
                            firstIndex = match.index;
                            // Update findPattern for this specific iteration to the matched text
                            const matchedText = match[0];
                            content = content.replace(matchedText, edit.replace);
                            console.log(`   ✓ Edit ${i + 1}: Applied via resilient match`);
                            continue;
                        }
                    }

                    // Pattern not found - provide helpful error
                    const preview = findPattern.length > 80
                        ? findPattern.substring(0, 80) + '...'
                        : findPattern;
                    console.error(`   ❌ Edit ${i + 1}: Pattern not found`);
                    console.error(`   Looking for: "${preview}"`);

                    // Try to find similar content (first 30 chars)
                    const searchStart = findPattern.substring(0, 30);
                    if (content.includes(searchStart)) {
                        console.error(`   💡 Hint: Found "${searchStart}" but full pattern doesn't match`);
                        console.error(`   Check for whitespace differences or truncation`);
                    }

                    return {
                        success: false,
                        error: `Edit ${i + 1}: Pattern not found in file. Looking for: "${preview}". Make sure the 'find' string matches the file content (ignoring whitespace).`
                    };
                }

                // Check if pattern is unique
                const lastIndex = content.lastIndexOf(findPattern);
                if (firstIndex !== lastIndex) {
                    const occurrences = content.split(findPattern).length - 1;
                    console.error(`   ❌ Edit ${i + 1}: Pattern appears ${occurrences} times - must be unique`);
                    console.error(`   Add more surrounding context to make the pattern unique`);
                    return {
                        success: false,
                        error: `Edit ${i + 1}: Pattern appears ${occurrences} times in file. Add more context to make it unique.`
                    };
                }

                // Apply the replacement
                content = content.replace(findPattern, edit.replace);
                const charDiff = edit.replace.length - findPattern.length;
                const diffStr = charDiff >= 0 ? `+${charDiff}` : `${charDiff}`;
                console.log(`   ✓ Edit ${i + 1}: Applied (${diffStr} chars)`);
            }

            // Write to temp file for validation
            const tempPath = `${fileEdit.filePath}.tmp`;
            await FileUtils.writeFile(tempPath, content);

            // Validate TypeScript
            console.log(`   🔍 Validating TypeScript compilation...`);
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            try {
                await execAsync('npx tsc --noEmit', { timeout: 30000 });
                console.log(`   ✅ TypeScript validation passed!`);

                // Move temp to actual
                const fs = await import('fs/promises');
                await fs.rename(tempPath, fileEdit.filePath);

                // Track change
                const codeChange: CodeChange = {
                    file: fileEdit.filePath,
                    action: 'edit',
                    content: content,
                    appliedAt: new Date().toISOString(),
                    validatedAt: new Date().toISOString(),
                    status: 'validated'
                };
                context.codeChanges.push(codeChange);
                await this.saveContext(context);

                console.log(`   💾 Saved edits to: ${fileEdit.filePath}\n`);
                return { success: true };

            } catch (compileError: any) {
                const errorMsg = compileError.stderr || compileError.stdout || compileError.message;
                console.error(`   ❌ TypeScript compilation failed:`);
                console.error(`   ${errorMsg.substring(0, 500)}`);

                // Save failed attempt for debugging
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const failedPath = `${fileEdit.filePath}.failed.${timestamp}.ts`;
                const fs = await import('fs/promises');
                await fs.rename(tempPath, failedPath);
                console.log(`   💾 Saved failed edit to: ${failedPath}`);

                return { success: false, error: `TypeScript compilation failed:\n${errorMsg.substring(0, 500)}` };
            }

        } catch (error: any) {
            console.error(`   ❌ Error applying edits: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            const fs = await import('fs/promises');
            await fs.access(filePath);
            return true;
        } catch (error: any) {
            return false;
        }
    }

    /**
     * Detects if consensus was reached, accounting for agents who hit processing limits.
     * Consensus is reached when 4+ agents agree or signal "agree", even if some couldn't respond.
     */
    private hasConsensus(context: OrchestratorContext): boolean {
        const signals = context.discussionSummary.consensusSignals;
        const agreeCount = Object.values(signals).filter(s => s === 'agree').length;
        const buildingCount = Object.values(signals).filter(s => s === 'building').length;
        const disagreeCount = Object.values(signals).filter(s => s === 'disagree').length;
        const totalSignals = Object.keys(signals).length;

        // Strong consensus: 4+ explicit agrees
        if (agreeCount >= 4) return true;

        // Moderate consensus: 3 agrees + 1 building (not blocking)
        if (agreeCount >= 3 && buildingCount >= 1 && totalSignals >= 4) {
            return true;
        }

        // Soft consensus: 2 agrees + 2+ building + 0 disagrees
        if (agreeCount >= 2 && buildingCount >= 2 && disagreeCount === 0 && totalSignals >= 4) {
            return true;
        }

        // Soft consensus (original): 1-2 agrees + 3+ building + no more than 1 disagree
        if (agreeCount >= 1 && (agreeCount + buildingCount) >= 4 && disagreeCount <= 1) {
            return true;
        }

        // Debug logging for near-misses
        if (agreeCount >= 2) {
            console.log(`   ⏳ Consensus near-miss: ${agreeCount} agree, ${buildingCount} building, ${disagreeCount} disagree`);
        }

        return false;
    }

    /**
     * Determines if consensus is about "task completion" vs "design ready".
     * - Task completion: agents saying work is done/complete/validated
     * - Design ready: agents proposing/suggesting what to build
     *
     * Returns: 'completion' | 'design' | 'unclear'
     */
    private detectConsensusType(keyDecisions: string[]): 'completion' | 'design' | 'unclear' {
        // Only look at the 3 most recent decisions to avoid stale "completion" language
        // from previous tasks polluting the detection
        const recentDecisions = keyDecisions.slice(-3);

        const completionWords = ['complete', 'done', 'finished', 'validated', 'verified', 'shipped', 'ready to ship', 'all tests pass', 'implemented'];
        const designWords = ['should build', 'propose', 'suggest we', 'approach:', 'design:', 'architecture:', 'let\'s implement', 'i recommend', 'next feature', 'new feature', 'we should add'];

        let completionScore = 0;
        let designScore = 0;

        for (const decision of recentDecisions) {
            const lower = decision.toLowerCase();
            for (const w of completionWords) {
                if (lower.includes(w)) completionScore++;
            }
            for (const w of designWords) {
                if (lower.includes(w)) designScore++;
            }
        }

        console.log(`   📊 Consensus detection: completion=${completionScore}, design=${designScore} (from ${recentDecisions.length} recent decisions)`);

        // Need clear signal - at least 2 more of one type (lowered threshold for fewer decisions)
        if (completionScore > designScore) return 'completion'; // Lowered threshold to just >
        if (designScore > completionScore) return 'design'; // Lowered threshold to just >
        return 'unclear';
    }

    /**
     * Extract key decisions from agent discussion.
     * Looks for agents who signaled "agree" and extracts their main points.
     */
    private extractKeyDecisions(projectFileHistory: any[], consensusSignals: Record<string, string>): string[] {
        const decisions: string[] = [];
        const agentsWhoAgreed = Object.entries(consensusSignals)
            .filter(([_, signal]) => signal === 'agree')
            .map(([agent, _]) => agent);

        // Find entries from agents who agreed
        for (const entry of projectFileHistory) {
            // Filter out system messages and orchestrator errors
            if (entry.agent === 'Orchestrator' || entry.agent === 'System') continue;

            if (agentsWhoAgreed.includes(entry.agent)) {
                // Extract decision from their notes or changes.description
                const decision = this.extractDecisionFromEntry(entry);
                if (decision) {
                    decisions.push(`${entry.agent}: ${decision}`);
                }
            }
        }

        // If no one agreed, extract from last few entries anyway (partial progress)
        if (decisions.length === 0 && projectFileHistory.length > 0) {
            const recentEntries = projectFileHistory.slice(-5); // Look slightly further back
            for (const entry of recentEntries) {
                if (entry.agent === 'Orchestrator' || entry.agent === 'System') continue;

                const decision = this.extractDecisionFromEntry(entry);
                if (decision) {
                    decisions.push(`${entry.agent} (building): ${decision}`);
                }
            }
        }

        return decisions;
    }

    private extractDecisionFromEntry(entry: any): string | null {
        // Try to extract meaningful decision from notes or changes
        if (entry.notes && entry.notes.length > 10) {
            // Extract first sentence or up to 150 chars
            const cleaned = entry.notes.trim().split('\n')[0];
            return cleaned.substring(0, 150);
        }

        if (entry.changes?.description && entry.changes.description.length > 10) {
            const cleaned = entry.changes.description.trim().split('\n')[0];
            return cleaned.substring(0, 150);
        }

        // Fallback: Use reasoning (the "Talk") if nothing else is available
        if (entry.reasoning && entry.reasoning.length > 10) {
            const cleaned = entry.reasoning.trim().split('\n')[0];
            return cleaned.substring(0, 150);
        }

        return null;
    }

    /**
     * Extracts the agreed-upon feature from discussion key decisions.
     * Looks for common themes or explicit feature mentions in agent agreements.
     */
    private extractAgreedFeature(context: OrchestratorContext): string {
        const decisions = context.discussionSummary.keyDecisions;

        if (decisions.length === 0) {
            return 'Agreed Feature';
        }

        // Common feature keywords to look for
        const keywords = [
            'SharedMemoryCache', 'shared memory', 'cache',
            'Jest test', 'testing', 'test',
            'error recovery', 'error handling',
            'validation', 'pipeline',
            'handoff', 'protocol',
            'serialization', 'state'
        ];

        // Count mentions of each keyword category
        const featureCounts: Record<string, number> = {};
        for (const decision of decisions) {
            const lower = decision.toLowerCase();
            if (lower.includes('sharedmemorycache') || lower.includes('shared memory') || lower.includes('cache')) {
                featureCounts['SharedMemoryCache'] = (featureCounts['SharedMemoryCache'] || 0) + 1;
            }
            if (lower.includes('jest') || lower.includes('test')) {
                featureCounts['Testing Infrastructure'] = (featureCounts['Testing Infrastructure'] || 0) + 1;
            }
            if (lower.includes('error') && (lower.includes('recovery') || lower.includes('handling'))) {
                featureCounts['Error Recovery System'] = (featureCounts['Error Recovery System'] || 0) + 1;
            }
            if (lower.includes('validation') || lower.includes('pipeline')) {
                featureCounts['Code Validation Pipeline'] = (featureCounts['Code Validation Pipeline'] || 0) + 1;
            }
            if (lower.includes('handoff') || lower.includes('protocol')) {
                featureCounts['Agent Handoff Protocol'] = (featureCounts['Agent Handoff Protocol'] || 0) + 1;
            }
        }

        // Return the most mentioned feature, or a generic name
        const sortedFeatures = Object.entries(featureCounts).sort((a, b) => b[1] - a[1]);
        return sortedFeatures.length > 0 ? sortedFeatures[0][0] : 'Next Feature';
    }

    /**
     * Generates implementation-focused prompt with design decisions from discussion.
     */
    private generateImplementationPrompt(context: OrchestratorContext): string {
        const decisions = context.discussionSummary.keyDecisions.length > 0
            ? context.discussionSummary.keyDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
            : 'See discussion summary below.';

        // Extract the agreed-upon feature from key decisions
        const agreedFeature = this.extractAgreedFeature(context);

        return `IMPLEMENTATION TASK: ${agreedFeature}

You are part of a self-improving AI team building a virtual assistant framework.

CONSENSUS REACHED ✅
Your team has agreed on what to build. Now it's time to implement it!

APPROVED DESIGN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decisions}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Your Role** (sequential workflow):
${AGENT_CONFIGS.Morgan ? '**Morgan**: Lead the implementation. Write working code.' : ''}
${AGENT_CONFIGS.Sam ? '**Sam**: Review for safety and test coverage.' : ''}
${AGENT_CONFIGS.Jordan ? '**Jordan**: Verify architecture and best practices.' : ''}
${AGENT_CONFIGS.Alex ? '**Alex**: Check usability and developer experience.' : ''}
${AGENT_CONFIGS.Pierre ? '**Pierre**: Keep scope tight, ensure we ship something working.' : ''}

IMMEDIATE GOAL:
Implement the agreed-upon feature. Make it:
- ✅ TypeScript-clean (will be compiled before use)
- ✅ Documented (inline comments for key decisions)
- ✅ Usable in next cycle (simple API)
- ✅ Observable (logs everything)

**⚠️ CRITICAL: FILE OPERATIONS ⚠️**

DO NOT embed code in "changes.code" - it will be truncated!

**Three file operations available:**

**1. READ files before editing (ALWAYS do this first!):**
\`\`\`json
{
  "fileRead": {
    "action": "read_file",
    "filePath": "src/memory/shared-cache.ts",
    "reason": "Need to see current implementation before fixing bug"
  },
  "target": "Morgan",
  "reasoning": "Reading file, then Morgan will fix the type error"
}
\`\`\`
Next agent will see file content in project history.

**2. EDIT existing files (PATTERN MATCHING - like Claude Code!):**
Use find/replace pattern matching. File content shows line numbers for reference.
\`\`\`json
{
  "fileEdit": {
    "action": "edit_file",
    "filePath": "src/memory/shared-cache.ts",
    "edits": [{
      "find": "return Array.from(this.cache.values()).reduce((sum, e) => sum + e.tokens, 0);",
      "replace": "return Array.from(this.cache.values()).reduce((sum: number, e) => sum + e.tokens, 0);"
    }],
    "reason": "Fix TypeScript error: add type annotation to sum parameter"
  },
  "target": "Jordan",
  "reasoning": "Fixed type error. Jordan, verify it compiles."
}
\`\`\`

**How pattern matching works:**
- "find": The EXACT string to locate in the file (must be unique)
- "replace": What to replace it with
- Include enough context in "find" to make it unique (e.g., full function signature, not just one line)
- If "find" appears multiple times, the edit will FAIL - add more context to make it unique
- Whitespace matters! Copy the exact string from the file content shown

**Use fileEdit for:**
- Fixing bugs
- Adding types
- Refactoring functions
- Any change to existing files

**3. WRITE new files (full content - only for NEW files!):**
\`\`\`json
{
  "fileWrite": {
    "action": "write_file",
    "filePath": "src/memory/shared-cache.ts",
    "content": "<full TypeScript code>",
    "reason": "Initial implementation of SharedMemoryCache"
  },
  "target": "Sam",
  "reasoning": "New file created. Sam, review for safety."
}
\`\`\`
**ONLY use fileWrite for:**
- Brand new files that don't exist yet
- Files > 1000 lines where edits would be too complex

**All operations:**
✅ Auto-validate TypeScript (\`tsc --noEmit\`)
✅ Save failed attempts for debugging
✅ Show errors to next agent
✅ Track in context

**WORKFLOW:**
1. fileRead → see file content WITH LINE NUMBERS
2. fileEdit → use pattern matching to find & replace (or fileWrite if brand new)
3. Next agent sees results

**Best practices:**
- ALWAYS read a file before editing it
- Copy exact strings from the displayed content for "find"
- Include multiple lines if needed to make the pattern unique

When implementation is complete and validated, signal consensus="agree".

${SYSTEM_CAPABILITIES}
${context.humanNotes ? `\n\n🗣️ MESSAGE FROM YOUR HUMAN USER:\n${context.humanNotes}\n` : ''}
Reference: docs/SYSTEM_CAPABILITIES.md and docs/AGENT_GUIDE.md for full details.`;
    }

    // ═══════════════════════════════════════════════════════════════

    /**
     * Clean up failed compilation files (.failed.ts) to keep workspace tidy.
     */
    private async cleanupFailedFiles(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');

            const findFailedFiles = async (dir: string): Promise<string[]> => {
                const results: string[] = [];
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name !== 'node_modules' && entry.name !== '.git') {
                                results.push(...await findFailedFiles(fullPath));
                            }
                        } else if (entry.isFile() && entry.name.includes('.failed.') && entry.name.endsWith('.ts')) {
                            results.push(fullPath);
                        }
                    }
                } catch (e: any) {
                    // Ignore access errors
                }
                return results;
            };

            // Find all .failed.ts files recursively
            const failedFiles = await findFailedFiles(process.cwd());

            if (failedFiles.length > 0) {
                console.log(`\n🧹 Cleaning up ${failedFiles.length} failed compilation files...`);
                for (const file of failedFiles) {
                    await fs.unlink(file);
                }
                console.log(`   ✓ Cleanup complete\n`);
            }
        } catch (error: any) {
            // Non-critical, just log warning
            console.warn(`⚠️  Failed file cleanup warning: ${error.message || error}`);
        }
    }

    async runCycles(): Promise<void> {
        // await this.cleanupFailedFiles();

        // Check for existing context
        const context = await this.loadContext(false); // Explicitly show on startup
        await this.loadSharedCache();

        if (context) {
            // Resuming from previous run
            console.log(this.generateBriefing(context));
            console.log(`\n🔄 Resuming from run #${context.runNumber}...\n`);

            // Restore agent states from previous run (costs only)
            for (const [agentName, state] of Object.entries(context.agentStates)) {
                const agent = this.agents.get(agentName);
                if (agent) {
                    agent.restoreState({
                        timesProcessed: state.timesProcessed,
                        totalCost: state.totalCost
                    });
                    console.log(`   Restored ${agentName}: ${state.timesProcessed} turns, $${state.totalCost.toFixed(4)}`);
                }
            }

            // Reset turn counts for new cycle (but preserve costs)
            console.log(`\n🔄 Resetting turn counts for new cycle...\n`);
            for (const agent of this.agents.values()) {
                agent.resetTurnsForNewCycle();
            }

            // Always update human notes - clear if not provided to prevent stale instructions
            context.humanNotes = this.config.humanComment || '';
            if (this.config.humanComment) {
                console.log(`\n💬 Human comment: "${this.config.humanComment}"\n`);
            }

            // Increment run number
            context.runNumber += 1;
            await this.saveContext(context);
        } else {
            // Fresh start
            console.log(`\n🆕 Starting fresh run #1\n`);
            await this.initializeContext();
        }

        while (this.cycleCount < this.config.maxCycles) {
            const cycleResult = await this.runCycle();
            this.cycleCount++;

            // Stop early if task is complete with high confidence
            if (cycleResult.taskComplete) {
                console.log(`\n✅ Stopping early - task completed: ${cycleResult.completionReason}\n`);
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await this.generateFinalSummary();
        await this.generateNarrativeSummary();

        // Update context with final state
        await this.updateContextAtEnd();
    }

    private async updateContextAtEnd(consensusSignals?: Record<string, string>, projectFileHistory?: any[]): Promise<void> {
        const context = await this.loadContext();
        if (!context) return;

        // Capture agent states
        const agentStates: Record<string, any> = {};
        for (const [name, agent] of this.agents.entries()) {
            const state = agent.getState();
            agentStates[name] = {
                timesProcessed: state.timesProcessed,
                productiveTurns: state.productiveTurns,
                totalCost: state.totalCost,
                canProcess: agent.canProcess()
            };
        }

        // Calculate total cost
        const totalCost = this.cycleCosts.reduce((sum, c) => sum + c.total, 0);

        // Update consensus signals if provided - ACCUMULATE, don't replace
        if (consensusSignals && Object.keys(consensusSignals).length > 0) {
            // Merge new signals with existing ones (new signals override old ones for same agent)
            context.discussionSummary.consensusSignals = {
                ...context.discussionSummary.consensusSignals,
                ...consensusSignals
            };

            // Check if consensus was reached (based on accumulated signals)
            // Use hasConsensus() to include soft consensus (agree + building combinations)
            if (this.hasConsensus(context)) {
                context.discussionSummary.consensusReached = true;
                const agreeCount = Object.values(context.discussionSummary.consensusSignals).filter(s => s === 'agree').length;
                const buildingCount = Object.values(context.discussionSummary.consensusSignals).filter(s => s === 'building').length;
                console.log(`\n✅ CONSENSUS REACHED: ${agreeCount} agree + ${buildingCount} building!\n`);
            }
        }

        // Extract key decisions from agent discussion
        if (projectFileHistory && projectFileHistory.length > 0) {
            const newDecisions = this.extractKeyDecisions(projectFileHistory, consensusSignals || {});
            if (newDecisions.length > 0) {
                // Add new decisions, avoiding duplicates
                const existingDecisions = new Set(context.discussionSummary.keyDecisions);
                for (const decision of newDecisions) {
                    if (!existingDecisions.has(decision)) {
                        context.discussionSummary.keyDecisions.push(decision);
                    }
                }
                console.log(`\n📋 Extracted ${newDecisions.length} key decision(s) from discussion`);
            }

            // Keep only last 10 decisions to prevent stale context bloat
            const MAX_KEY_DECISIONS = 10;
            if (context.discussionSummary.keyDecisions.length > MAX_KEY_DECISIONS) {
                const removed = context.discussionSummary.keyDecisions.length - MAX_KEY_DECISIONS;
                context.discussionSummary.keyDecisions = context.discussionSummary.keyDecisions.slice(-MAX_KEY_DECISIONS);
                console.log(`   📦 Trimmed ${removed} old decision(s), keeping last ${MAX_KEY_DECISIONS}`);
            }
        }

        // Update phase and nextAction based on consensus state
        // Use accumulated signals, not just this cycle's signals
        const totalAgreeCount = Object.values(context.discussionSummary.consensusSignals).filter(s => s === 'agree').length;

        if (context.discussionSummary.consensusReached) {
            // Consensus reached - but is it "task complete" or "design ready"?
            const consensusType = this.detectConsensusType(context.discussionSummary.keyDecisions);
            console.log(`   🔍 Consensus type: ${consensusType}`);

            if (consensusType === 'completion') {
                // Task is DONE - stay in discussion to figure out what's NEXT
                context.currentPhase = 'discussion';
                context.discussionSummary.consensusReached = false;  // Reset for new topic
                context.discussionSummary.consensusSignals = {};     // Reset signals for new discussion
                context.discussionSummary.topic = '🆕 Pick Next Feature';  // Change topic to signal new discussion
                context.nextAction = {
                    type: 'continue_discussion',
                    reason: 'Previous task complete! PROPOSE a new feature to build.',
                    targetAgent: undefined
                };
                console.log(`\n🎉 TASK COMPLETE! Topic changed to "Pick Next Feature".\n`);
            } else {
                // Design agreed OR unclear - proceed to implementation
                context.currentPhase = 'code_review';
                context.nextAction = {
                    type: 'apply_changes',
                    reason: `Consensus reached (${totalAgreeCount}/5 agree) - ready to implement`,
                    targetAgent: undefined
                };
            }
        } else {
            // Still building toward consensus
            context.currentPhase = 'discussion';
            const disagreeCount = Object.values(consensusSignals || {}).filter(s => s === 'disagree').length;

            if (disagreeCount >= 2) {
                context.nextAction = {
                    type: 'continue_discussion',
                    reason: `${disagreeCount} agents disagree - need more alignment`,
                    targetAgent: undefined
                };
            } else if (totalAgreeCount >= 2) {
                context.nextAction = {
                    type: 'continue_discussion',
                    reason: `Making progress (${totalAgreeCount} agree) - close to consensus`,
                    targetAgent: undefined
                };
            } else {
                context.nextAction = {
                    type: 'continue_discussion',
                    reason: 'Still exploring options',
                    targetAgent: undefined
                };
            }
        }

        // Add to history
        context.history.push({
            runNumber: context.runNumber,
            phase: context.currentPhase,
            summary: `Completed ${this.cycleCount} cycle(s) in ${context.currentPhase} phase`,
            cost: totalCost,
            timestamp: new Date().toISOString()
        });

        // Store new decisions in SharedMemoryCache
        if (projectFileHistory && projectFileHistory.length > 0) {
            const recentDecisions = context.discussionSummary.keyDecisions.slice(-5); // Last 5
            for (const decision of recentDecisions) {
                this.sharedCache.store(
                    `decision_${Date.now()}_${Math.random()}`,
                    decision,
                    'decision',
                    'Stored from current cycle'
                );
            }
        }

        // Update context
        context.agentStates = agentStates;
        context.totalCost += totalCost;
        context.lastUpdated = new Date().toISOString();
        context.summarizedHistory = generateCycleSummary(projectFileHistory || []); // Ensure it's always an array

        await this.saveContext(context);
        await this.saveSharedCache();
        console.log(`\n💾 Saved context for run #${context.runNumber}`);
    }

    private async runCycle(): Promise<{ taskComplete: boolean; completionReason?: string }> {

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const cycleId = `cycle_${String(this.cycleCount + 1).padStart(3, '0')}`;
        const cyclePath = `${this.config.logDirectory}/cycles/${timestamp}_${cycleId}.log`;

        await FileUtils.initializeLogFile(cyclePath);

        // Check if we have consensus from previous run and should switch to implementation mode
        const context = await this.loadContext();
        let projectFileContent: string;
        let projectStage: string;

        // Check if SharedMemoryCache is already implemented
        let sharedCacheExists = false;
        let sharedCacheTestExists = false;
        try {
            await FileUtils.readFile('src/memory/shared-cache.ts');
            sharedCacheExists = true;
        } catch (e: any) {
            // File doesn't exist
        }
        try {
            await FileUtils.readFile('src/memory/__tests__/shared-cache.test.ts');
            sharedCacheTestExists = true;
        } catch (e: any) {
            try {
                await FileUtils.readFile('tests/test-shared-cache.ts');
                sharedCacheTestExists = true;
            } catch (e2: any) {
                // Neither test file exists
            }
        }

        if (context && this.hasConsensus(context)) {
            // Implementation mode - consensus reached, time to code!
            projectFileContent = this.generateImplementationPrompt(context);
            projectStage = 'implementation';
            this.currentPhase = 'implementation';  // Switch to sequential mode
            console.log(`\n✅ Consensus detected! Switching to IMPLEMENTATION mode (sequential workflow).\n`);

            // Reset consensus now so next cycle starts fresh discussion
            context.discussionSummary.consensusReached = false;
            context.discussionSummary.consensusSignals = {};
            // Keep keyDecisions for the implementation phase to use

            // Update context to reflect phase change
            await this.updateContext({
                currentPhase: 'code_review',
                nextAction: {
                    type: 'apply_changes',
                    reason: 'Consensus reached - ready to implement agreed design',
                    targetAgent: undefined
                }
            });
        } else {
            this.currentPhase = 'discussion';  // Ensure we're in discussion mode
            // Discussion mode - still deciding what to build
            const completedFeatures = [];
            if (sharedCacheExists && sharedCacheTestExists) {
                completedFeatures.push('✅ SharedMemoryCache - three-bucket LRU cache with tests');
            }

            projectFileContent = `SUMMARIZED HISTORY (from previous cycle):
${context?.summarizedHistory || 'No summarized history available.'}

TEAM DISCUSSION: ${completedFeatures.length > 0 ? 'What to Build NEXT' : 'Pick ONE Feature to Implement'}

You are part of a self-improving AI team building a virtual assistant framework.

YOUR HUMAN USER:
- Values shipping features over endless discussion
- Wants you to work autonomously (less human intervention)
- Prefers robust, simple solutions over over-engineered ones

YOUR TASK:
Pick ONE feature to ${completedFeatures.length > 0 ? 'implement NEXT' : 'implement fully'}. Choose something that helps you:
1. Function longer without human intervention
2. Maintain context across restarts
3. Coordinate better as a team
4. Recover from errors gracefully

${!sharedCacheExists || !sharedCacheTestExists ? `SUGGESTED FIRST FEATURE:
Based on previous discussions, consider: **Shared Memory Cache**
- Helps agents share context across runs
- Token-aware caching (prevent memory overflow)
- Priority-based pruning (keep important stuff)
- Security classifications (protect sensitive data)

OTHER OPTIONS (pick ONE):` : `SUGGESTED NEXT FEATURES (pick ONE):`}
- Enhanced state serialization
- Agent handoff protocol (prevent stepping on toes)
- Code validation pipeline (catch errors before applying)
- Error recovery system (retry with backoff)
- Fix/improve existing features (e.g., make SharedMemoryCache tests actually run)

DISCUSSION GOALS:
1. ${this.shouldUseConsensus() ? 'Debate which ONE feature to build first' : 'Collaborate to pick ONE feature to build'}
2. ${this.shouldUseConsensus() ? 'Reach consensus (4/5 agents agree)' : 'Each agent contributes their perspective in sequence'}
3. Define SPECIFIC implementation details
4. Be ready to write actual working code

IMPORTANT:
- Focus on ONE feature only
- Don't over-engineer (Jordan: MVP mode!)
- Be direct, challenge ideas, ${this.shouldUseConsensus() ? 'disagree when needed' : 'build on each other\'s ideas'}
${this.shouldUseConsensus() ? `- Signal consensus honestly: agree/building/disagree
- Choose who goes next strategically (don't waste turns on agents who already agree)
- If consensus is clear and remaining agents are out of turns, pass to "Orchestrator" to end round early` : '- Work sequentially: each agent reviews and passes to next'}

${SYSTEM_CAPABILITIES}
${context?.humanNotes ? `\n\n🗣️ MESSAGE FROM YOUR HUMAN USER:\n${context.humanNotes}\n` : ''}
Reference: docs/SYSTEM_CAPABILITIES.md and docs/AGENT_GUIDE.md for full details.`;
            projectStage = 'team_discussion';
        }

        // Initial project file setup
        const projectFile: ProjectFile = {
            content: projectFileContent,
            currentStage: projectStage,
            history: []
        };

        // sim mode
        if (this.config.simulationMode) {
            await this.runSimulationCycle(cyclePath, cycleId);
            return { taskComplete: false, completionReason: 'Simulation mode' };
        }

        // Pick first available agent
        const initialAvailableAgents = Array.from(this.agents.values())
            .filter(a => a.canProcess())
            .map(a => a.getName());

        if (initialAvailableAgents.length === 0) {
            throw new Error('No agents available to start cycle (all at processing limit)');
        }

        let currentAgent: BaseAgent | null = null;

        if (!this.shouldUseConsensus()) {
            // Use fixed workflow order - start with first agent in order
            for (const agentName of AGENT_WORKFLOW_ORDER) {
                const agent = this.agents.get(agentName);
                if (agent && agent.canProcess()) {
                    currentAgent = agent;
                    console.log(`🎯 Starting workflow with ${currentAgent.getName()} (step 1/${AGENT_WORKFLOW_ORDER.length})\n`);
                    break;
                }
            }
            if (!currentAgent) {
                throw new Error('Could not find initial agent in workflow order');
            }
        } else {
            // Random selection for consensus mode
            currentAgent = this.getRandomAvailableAgent(initialAvailableAgents);
            if (!currentAgent) {
                throw new Error('Could not find initial agent');
            }
            console.log(`🎯 Starting with ${currentAgent.getName()} (${initialAvailableAgents.length} agents available)\n`);
        }

        // Track consensus signals
        const consensusSignals: Record<string, string> = {};

        await this.logCycle(cyclePath, 'Starting cycle', {
            cycleId,
            initialAgent: currentAgent.getName(),
            availableAgents: initialAvailableAgents
        });

        const cycleCost = { cycle: cycleId, total: 0, logPath: cyclePath };

        while (true) {
            const agreeCount = Object.values(consensusSignals).filter(s => s === 'agree').length;
            const totalAgents = this.agents.size;

            // Check for consensus (only if requireConsensus is enabled)
            if (this.shouldUseConsensus()) {
                const consensusThreshold = Math.ceil(totalAgents * 0.8); // 80% = 4 out of 5

                if (agreeCount >= consensusThreshold) {
                    await this.logCycle(cyclePath, 'Cycle complete - consensus reached', {
                        finalState: projectFile,
                        consensusSignals,
                        agreeCount,
                        threshold: consensusThreshold
                    });
                    console.log(`\n✅ Consensus reached! ${agreeCount}/${totalAgents} agents agree.`);
                    break;
                }
            }



            // Get available targets
            let availableTargets = Array.from(this.agents.values())
                .filter(a => a.canProcess())
                .map(a => a.getName());

            // In consensus mode, add "Orchestrator" as option to end round early
            if (this.shouldUseConsensus()) {
                availableTargets.push('Orchestrator');
            }

            // Build turn availability info for agents
            const turnInfo: string[] = [];
            for (const [name, agent] of this.agents.entries()) {
                const state = agent.getState();
                // Get the actual limit for this agent (base + bonuses)
                // Since we don't publicize the exact limit, we'll just show "turns taken" vs "active"
                // Or better: just show "Active" or "Exhausted" to avoid confusion

                const canProcess = agent.canProcess();
                const status = canProcess ? `Active (${state.timesProcessed} turns used)` : 'Exhausted (next round)';
                turnInfo.push(`  - ${name}: ${status}`);
            }
            const turnInfoStr = this.shouldUseConsensus()
                ? `\nTURN AVAILABILITY:\n${turnInfo.join('\n')}\n${availableTargets.includes('Orchestrator') ? '  - Orchestrator: Pass here to end round early\n' : ''}`
                : '';

            // Inject turn info into project file for agents to see
            if (this.shouldUseConsensus() && projectFile.history.length > 0) {
                // Add as a system note in history
                projectFile.history.push({
                    agent: 'System',
                    timestamp: new Date().toISOString(),
                    action: 'turn_status',
                    notes: turnInfoStr,
                    changes: { description: 'Turn availability update', location: 'system' }
                });
            }

            if (availableTargets.length === 0 || (availableTargets.length === 1 && availableTargets[0] === 'Orchestrator')) {
                await this.logCycle(cyclePath, 'Cycle complete - no available targets', {
                    finalState: projectFile,
                    consensusSignals,
                    finalAgreeCount: agreeCount
                });
                const consensusMsg = this.shouldUseConsensus()
                    ? `Final consensus: ${agreeCount}/${totalAgents} agents agree.`
                    : 'All agents completed their turns.';
                console.log(`\n${consensusMsg}`);
                break;
            }

            // Inner loop: Keep calling same agent while they request file reads
            // This allows agents to read multiple files and then act on them in ONE turn
            if (currentAgent && !currentAgent.canProcess()) {
                console.log(`\n🔄 Current agent ${currentAgent.getName()} is exhausted. Picking new target...`);
                currentAgent = this.getRandomAvailableAgent(availableTargets);
            }

            if (!currentAgent) {
                console.log('\n🛑 No available agents left. Cycle finishing.');
                break;
            }

            // Track if this is a retry turn for logging and logic
            const forceRetry = projectFile.history.length > 0 &&
                (projectFile.history[projectFile.history.length - 1].action.includes('failed'));

            let result = await currentAgent.processFile(projectFile, availableTargets, context?.summarizedHistory || "");

            // FAIL FAST CHECK
            if (!result) {
                console.error(`\n❌ CRITICAL: Agent ${currentAgent.getName()} failed to provide a result (likely API error).`);
                console.error(`   Terminating process immediately to prevent credit wastage.`);
                process.exit(1);
            }

            // VISIBILITY: Print what the agent is thinking and voting
            const retryPrefix = forceRetry ? ' (RETRY)' : '';
            console.log(`\n💬 ${currentAgent.getName()}${retryPrefix}: "${result.reasoning}"`);
            if (this.shouldUseConsensus() && result.consensus) {
                const icon = result.consensus === 'agree' ? '✅' : (result.consensus === 'disagree' ? '❌' : '🏗️');
                console.log(`   ${icon} Vote: ${result.consensus.toUpperCase()}`);
            }

            let fileReadIterations = 0;
            const MAX_FILE_READS_PER_TURN = 5; // Prevent infinite loops

            while ((result.fileRead || result.lineRead || result.fileGrep) && fileReadIterations < MAX_FILE_READS_PER_TURN) {
                cycleCost.total += result.cost;

                if (result.fileRead) {
                    const readResult = await this.handleFileRead(result.fileRead, currentAgent.getName(), projectFile);
                    if (readResult.success && readResult.content) {
                        const lineCount = readResult.content.split('\n').length;
                        const numberedContent = this.formatWithLineNumbers(readResult.content);
                        console.log(`\n📖 File read: ${result.fileRead.filePath} (${lineCount} lines)\n`);

                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'file_read_success',
                            notes: `📖 File content from ${result.fileRead.filePath} (${lineCount} lines):\n\n${numberedContent}`,
                            changes: { description: `Read ${lineCount} lines`, location: result.fileRead.filePath }
                        });
                    } else {
                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'file_read_failed',
                            notes: `❌ Failed to read ${result.fileRead.filePath}: ${readResult.error}`,
                            changes: { description: 'File read failed', location: result.fileRead.filePath }
                        });
                    }
                } else if (result.lineRead) {
                    const readResult = await this.handleLineRead(result.lineRead.filePath, result.lineRead.startLine, result.lineRead.endLine, currentAgent.getName());
                    if (readResult.success && readResult.content) {
                        const numberedContent = this.formatWithLineNumbers(readResult.content, result.lineRead.startLine);
                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'line_read_success',
                            notes: `📖 Lines ${result.lineRead.startLine}-${result.lineRead.endLine} from ${result.lineRead.filePath}:\n\n${numberedContent}`,
                            changes: { description: `Read lines ${result.lineRead.startLine}-${result.lineRead.endLine}`, location: result.lineRead.filePath }
                        });
                    } else {
                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'line_read_failed',
                            notes: `❌ Failed to read lines from ${result.lineRead.filePath}: ${readResult.error}`,
                            changes: { description: 'Line read failed', location: result.lineRead.filePath }
                        });
                    }
                } else if (result.fileGrep) {
                    const grepResult = await this.handleFileGrep(result.fileGrep.filePath, result.fileGrep.pattern, currentAgent.getName());
                    if (grepResult.success && grepResult.matches) {
                        const matchesStr = grepResult.matches.join('\n');
                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'file_grep_success',
                            notes: `🔍 Search results for "${result.fileGrep.pattern}" in ${result.fileGrep.filePath}:\n\n${matchesStr}`,
                            changes: { description: `Searched for "${result.fileGrep.pattern}"`, location: result.fileGrep.filePath }
                        });
                    } else {
                        projectFile.history.push({
                            agent: 'Orchestrator',
                            timestamp: new Date().toISOString(),
                            action: 'file_grep_failed',
                            notes: `❌ Search failed for "${result.fileGrep.pattern}" in ${result.fileGrep.filePath}: ${grepResult.error}`,
                            changes: { description: 'File grep failed', location: result.fileGrep.filePath }
                        });
                    }
                }

                console.log(`   🔄 Calling ${currentAgent.getName()} again with new context (iteration ${fileReadIterations + 1}/${MAX_FILE_READS_PER_TURN})`);
                fileReadIterations++;
                result = await currentAgent.processFile(projectFile, availableTargets, context?.summarizedHistory || "");
                console.log(`\n💬 ${currentAgent.getName()} (READ LOOP): "${result.reasoning}"`);
            }

            // Check if loop terminated due to limit
            if (fileReadIterations >= MAX_FILE_READS_PER_TURN && result.fileRead) {
                console.warn(`\n⚠️  Agent ${currentAgent.getName()} reached max file read limit (${MAX_FILE_READS_PER_TURN}). Stopping reads.`);
                // We proceed with the last result, effectively ignoring the 6th read request
                // and forcing the agent to move on (or pass to the targetAgent in that result)
            }

            // Clean up history to prevent huge context bloat
            // We truncate large file content from OLDER history entries
            // BUT we preserve the very last entry so the next agent (or self-pass) can see what just happened
            for (let i = 0; i < projectFile.history.length - 1; i++) {
                const entry = projectFile.history[i];
                if (entry.action === 'file_read_success' && entry.notes.length > 2000) {
                    const lines = entry.notes.split('\n');
                    if (lines.length > 50) {
                        entry.notes = lines.slice(0, 50).join('\n') + `\n\n... (truncated ${lines.length - 50} lines for history) ...`;
                    }
                }
            }

            // Add final cost from last call
            cycleCost.total += result.cost;

            if (!result.accepted) {
                // If agent refused (e.g. limit reached), pick someone else who CAN work
                const newTarget = this.getRandomAvailableAgent(availableTargets);
                if (!newTarget) {
                    console.log('\n🛑 No other agents available to take over. Ending cycle.');
                    break;
                }
                currentAgent = newTarget;
                continue;
            }

            // Track consensus signal
            if (result.consensus) {
                consensusSignals[currentAgent.getName()] = result.consensus;
                console.log(`  ${currentAgent.getName()}: ${result.consensus}`);
            }

            // Update project file history with final action
            projectFile.history.push({
                agent: currentAgent.getName(),
                timestamp: new Date().toISOString(),
                action: 'review_and_modify',
                notes: result.reasoning,
                changes: result.changes || { description: '', location: '' }
            });

            // Apply changes if any (only in non-implementation stages)
            // In implementation mode, we want to PRESERVE the instruction prompt in projectFile.content
            if (result.changes && projectFile.currentStage !== 'implementation') {
                projectFile.content = result.changes.code || projectFile.content;
            }

            // fileRead is now handled in the loop above - no duplicate handling needed

            // Handle file edit requests (surgical edits)
            let editOrWriteFailed = false;
            if (result.fileEdit) {
                const editResult = await this.handleFileEdit(result.fileEdit, currentAgent.getName());

                if (!editResult.success && editResult.error) {
                    editOrWriteFailed = true;
                    projectFile.history.push({
                        agent: 'Orchestrator',
                        timestamp: new Date().toISOString(),
                        action: 'file_edit_failed',
                        notes: `❌ EDIT FAILED for ${result.fileEdit.filePath}\n\nErrors:\n${editResult.error}`,
                        changes: {
                            description: 'File edit failed - see errors above',
                            location: result.fileEdit.filePath
                        }
                    });

                    console.log(`\n⚠️  Edit failed. Giving ${currentAgent.getName()} a chance to fix it right away.\n`);
                } else if (editResult.success) {
                    projectFile.history.push({
                        agent: 'Orchestrator',
                        timestamp: new Date().toISOString(),
                        action: 'file_edit_success',
                        notes: `✅ Successfully edited and validated ${result.fileEdit.filePath} (${result.fileEdit.edits.length} change(s))`,
                        changes: {
                            description: `Applied ${result.fileEdit.edits.length} edit(s) successfully`,
                            location: result.fileEdit.filePath
                        }
                    });
                }
            }

            // Handle file write requests (full file writes - for new files)
            if (result.fileWrite) {
                const writeResult = await this.handleFileWrite(result.fileWrite, currentAgent.getName());

                if (!writeResult.success && writeResult.error) {
                    editOrWriteFailed = true;
                    projectFile.history.push({
                        agent: 'Orchestrator',
                        timestamp: new Date().toISOString(),
                        action: 'file_write_failed',
                        notes: `❌ COMPILATION FAILED for ${result.fileWrite.filePath}\n\nErrors:\n${writeResult.error}`,
                        changes: {
                            description: 'File write failed - see errors above',
                            location: result.fileWrite.filePath
                        }
                    });

                    console.log(`\n⚠️  Compilation failed. Giving ${currentAgent.getName()} a chance to fix it right away.\n`);
                } else if (writeResult.success) {
                    projectFile.history.push({
                        agent: 'Orchestrator',
                        timestamp: new Date().toISOString(),
                        action: 'file_write_success',
                        notes: `✅ Successfully saved and validated ${result.fileWrite.filePath}`,
                        changes: {
                            description: 'File compiled successfully and saved',
                            location: result.fileWrite.filePath
                        }
                    });
                }
            }

            // Detect phase transition: if agents are doing file operations, they're implementing!
            if ((result.fileRead || result.fileEdit || result.fileWrite) && projectStage === 'team_discussion') {
                projectStage = 'implementation';
                projectFile.currentStage = 'implementation';
                console.log(`\n🔨 Phase auto-detected: IMPLEMENTATION (agents are working on code)\n`);

                // Update context to reflect phase change
                const ctx = await this.loadContext();
                if (ctx) {
                    await this.updateContext({
                        currentPhase: 'code_review',
                        nextAction: {
                            type: 'apply_changes',
                            reason: 'Agents actively implementing - iterating until feature complete and tested',
                            targetAgent: undefined
                        }
                    });
                }
            }

            // Get next agent (use fixed workflow order if consensus disabled)
            let nextAgent: BaseAgent | null = null;

            // Safety check
            if (!currentAgent) {
                console.error('❌ Current agent is null, breaking loop');
                break;
            }

            if (editOrWriteFailed && currentAgent.canProcess()) {
                nextAgent = currentAgent;
            } else if (!this.shouldUseConsensus()) {
                // Check if agent is requesting to return backwards for fix
                if (result.returnForFix) {
                    console.log(`🔙 ${currentAgent.getName()} requesting return for fix → ${result.targetAgent}`);
                    nextAgent = this.agents.get(result.targetAgent) || null;
                    if (!nextAgent) {
                        console.warn(`⚠️  Target agent ${result.targetAgent} not found, continuing workflow normally`);
                        nextAgent = this.getNextAgentInWorkflow(currentAgent.getName(), availableTargets);
                    } else if (!nextAgent.canProcess()) {
                        console.warn(`⚠️  Target agent ${result.targetAgent} cannot process, continuing workflow normally`);
                        nextAgent = this.getNextAgentInWorkflow(currentAgent.getName(), availableTargets);
                    }
                }
                // Check if agent is self-passing for multi-step work
                else if (result.targetAgent === currentAgent.getName()) {
                    nextAgent = currentAgent;
                    console.log(`🔄 ${currentAgent.getName()} self-passing for multi-step work`);
                } else {
                    // Fixed workflow order when passing to others
                    nextAgent = this.getNextAgentInWorkflow(currentAgent.getName(), availableTargets);
                    if (!nextAgent) {
                        console.log(`✅ Workflow complete - all agents processed in order`);
                        break;
                    }
                }
            } else {
                // Consensus mode - agent chooses who to pass to

                // Check if agent passed to Orchestrator to end round early
                if (result.targetAgent === 'Orchestrator') {
                    await this.logCycle(cyclePath, 'Round ended early by agent request', {
                        requestingAgent: currentAgent.getName(),
                        reasoning: result.reasoning,
                        finalState: projectFile,
                        consensusSignals,
                        agreeCount
                    });
                    console.log(`\n🎯 ${currentAgent.getName()} passed to Orchestrator - ending round early.`);
                    console.log(`   Reasoning: ${result.reasoning}`);
                    console.log(`   Current consensus: ${agreeCount}/${totalAgents} agents agree.\n`);
                    break;
                }

                // Agent chose a specific team member
                nextAgent = this.agents.get(result.targetAgent) || null;
                if (!nextAgent) {
                    await this.logCycle(cyclePath, 'Invalid target agent selected', {
                        requestedAgent: result.targetAgent,
                        availableAgents: Array.from(this.agents.keys()),
                        availableTargets
                    });
                    console.log(`⚠️  ${currentAgent.getName()} selected unavailable agent "${result.targetAgent}".`);
                    console.log(`   Available options: ${availableTargets.filter(a => a !== 'Orchestrator').join(', ')}`);
                    console.log(`   Ending round to avoid confusion.`);
                    break;
                }

                // Check if the target agent can still process
                if (!nextAgent.canProcess()) {
                    console.log(`⚠️  ${currentAgent.getName()} selected ${result.targetAgent}, but they're out of turns.`);
                    console.log(`   ${result.targetAgent} has exhausted their turns this round.`);
                    console.log(`   Available options: ${availableTargets.filter(a => a !== 'Orchestrator').join(', ')}`);
                    console.log(`   Ending round to avoid confusion.`);
                    break;
                }
            }

            currentAgent = nextAgent;

            if (!currentAgent) {
                console.error('❌ Next agent became null unexpectedly');
                break;
            }

            await this.logCycle(cyclePath, 'Processing step', {
                agent: currentAgent.getName(),
                currentState: projectFile,
                cost: result.cost
            });
        }

        this.cycleCosts.push(cycleCost);
        await this.updateCostSummary();

        // Display progress dashboard
        const progress = extractProgressFromHistory(projectFile, cycleCost.total);
        progress.cycle = this.cycleCount;
        displayProgressDashboard(progress);

        // Display cycle summary with key actions
        const keyActions = extractKeyActions(projectFile);
        displayCycleSummary(this.cycleCount, progress, keyActions);

        // Run tests on changed files
        const changedFiles = extractChangedFiles(projectFile.history);
        if (changedFiles.length > 0) {
            const testResult = await runCycleTests(changedFiles);
            if (testResult.success) {
                console.log(`✅ All checks passed (${testResult.testsPassed}/${testResult.testsPassed})\n`);

                // Auto-commit successful code changes only if tests pass
                const commitSummary = generateCycleSummary(projectFile.history);
                const commitResult = await autoCommitCycle(this.cycleCount, changedFiles, commitSummary);
                if (commitResult.success && commitResult.commitHash) {
                    console.log(`📝 ${commitResult.message}\n`);
                }
            } else {
                console.log(`❌ Tests failed (${testResult.testsFailed} issues) - skipping auto-commit\n`);
                if (testResult.errors.length > 0) {
                    console.log(`Errors:\n${testResult.errors.slice(0, 3).map(e => `  - ${e}`).join('\n')}\n`);
                }
            }
        }

        // Check if task is complete
        const completionResult = detectTaskCompletion(projectFile, this.cycleCount);
        if (completionResult.isComplete) {
            console.log(`\n🎯 TASK COMPLETION DETECTED`);
            console.log(`   Reason: ${completionResult.reason}`);
            console.log(`   Confidence: ${(completionResult.confidence * 100).toFixed(0)}%\n`);
        }

        // Always save context and extract key decisions (even if no consensus signals)
        await this.updateContextAtEnd(consensusSignals, projectFile.history);

        return {
            taskComplete: completionResult.isComplete,
            completionReason: completionResult.reason
        };
    }

    private async generateNarrativeSummary(): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const narrativePath = `${this.config.logDirectory}/narrative_${timestamp}.md`;

        // Check if this was a conversation or code session
        const isConversation = this.config.conversationMode || false;

        let narrative = `# ${isConversation ? 'Team Discussion' : 'Project Development Session'}\n\n`;
        narrative += `**Date:** ${new Date().toLocaleDateString()}\n`;
        narrative += `**Mode:** ${isConversation ? 'Conversation' : 'Code Development'}\n`;
        narrative += `**Participants:** ${Array.from(this.agents.keys()).join(', ')}\n\n`;
        narrative += `---\n\n`;

        // Process history from project file for each cycle
        for (const cycle of this.cycleCosts) {
            narrative += `## ${cycle.cycle}\n\n`;

            // Read the cycle log directly from the stored path
            const cycleLog = await FileUtils.readLogFile(cycle.logPath);

            // Get the initial task from first entry
            if (cycleLog.length > 0 && cycleLog[0].currentState?.content) {
                const taskContent = cycleLog[0].currentState.content;
                if (isConversation && taskContent.includes('YOUR TASK:')) {
                    const taskMatch = taskContent.match(/YOUR TASK:\n(.+?)(?:\n\n|$)/s);
                    if (taskMatch) {
                        narrative += `### Discussion Topic\n${taskMatch[1]}\n\n`;
                    }
                }
            }

            narrative += `### Discussion Flow\n\n`;

            // Track rounds of discussion by grouping consecutive messages
            let roundCount = 1;
            let currentRound: any[] = [];

            // Parse and format each step
            for (const entry of cycleLog) {
                if (entry.currentState?.history) {
                    const step = entry.currentState.history[entry.currentState.history.length - 1];
                    if (step) {
                        currentRound.push(step);

                        // Start new round every 5 exchanges or when we detect pattern shift
                        if (currentRound.length >= 5) {
                            narrative += this.formatRound(roundCount, currentRound, !!isConversation);
                            currentRound = [];
                            roundCount++;
                        }
                    }
                }
            }

            // Format any remaining messages
            if (currentRound.length > 0) {
                narrative += this.formatRound(roundCount, currentRound, !!isConversation);
            }
        }

        // Calculate and add cost summary
        const costs: Record<string, number> = {};
        let total = 0;

        Array.from(this.agents.values()).forEach(agent => {
            const state = agent.getState();
            const modelKey = agent.getModel();
            costs[modelKey] = costs[modelKey] || 0;

            state.operations.forEach(op => {
                costs[modelKey] += op.cost;
                total += op.cost;
            });
        });

        narrative += `\n## Cost Analysis\n`;
        Object.entries(costs).forEach(([model, cost]) => {
            const percentage = total > 0 ? ((cost / total) * 100).toFixed(1) : '0.0';
            narrative += `- ${model}: $${cost.toFixed(6)} (${percentage}%)\n`;
        });
        narrative += `- **Total Cost:** $${total.toFixed(6)} USD\n\n`;

        await FileUtils.writeFile(narrativePath, narrative);
    }

    private formatRound(roundNum: number, steps: any[], isConversation: boolean): string {
        let output = `#### Round ${roundNum}\n\n`;

        steps.forEach(step => {
            output += `**${step.agent}:**\n`;

            if (isConversation) {
                // For conversations, show full description as quote
                if (step.changes.description) {
                    output += `> ${step.changes.description}\n\n`;
                }

                // Only show code if it exists and looks intentional (not empty)
                if (step.changes.code && step.changes.code.trim().length > 10) {
                    output += `<details>\n<summary>Code snippet (click to expand)</summary>\n\n`;
                    output += '```typescript\n';
                    output += step.changes.code.substring(0, 500);
                    output += step.changes.code.length > 500 ? '\n// ... (truncated)' : '';
                    output += '\n```\n</details>\n\n';
                }
            } else {
                // For code sessions, show both description and code prominently
                if (step.changes.description) {
                    output += `${step.changes.description}\n\n`;
                }
                if (step.changes.code) {
                    output += '```typescript\n';
                    output += `// Location: ${step.changes.location}\n`;
                    output += step.changes.code + '\n';
                    output += '```\n\n';
                }
            }

            // Show reasoning in small text
            if (step.notes && step.notes !== step.changes.description) {
                output += `*Reasoning: ${step.notes}*\n\n`;
            }
        });

        output += `---\n\n`;
        return output;
    }

    private getRandomAgent(): BaseAgent | null {
        const agents = Array.from(this.agents.values());
        if (agents.length === 0) return null;
        return agents[Math.floor(Math.random() * agents.length)];
    }

    private getRandomAvailableAgent(availableAgents: string[]): BaseAgent | null {
        // Filter out agents who have reached their limit
        const activeCandidates = availableAgents.filter(name => {
            if (name === 'Orchestrator') return true;
            const agent = this.agents.get(name);
            return agent && agent.canProcess();
        });

        if (activeCandidates.length === 0) return null;

        const agentName = activeCandidates[Math.floor(Math.random() * activeCandidates.length)];
        const agent = this.agents.get(agentName);
        if (!agent) {
            console.error(`Agent not found: ${agentName}. Available agents: ${Array.from(this.agents.keys()).join(', ')}`);
            return null;
        }
        return agent;
    }

    /**
     * Get next agent in the fixed workflow order (when requireConsensus is false).
     * Returns null if workflow is complete.
     */
    private getNextAgentInWorkflow(currentAgentName: string, availableAgents: string[]): BaseAgent | null {
        const currentIndex = AGENT_WORKFLOW_ORDER.indexOf(currentAgentName);
        if (currentIndex === -1) {
            // Current agent not in workflow order, start from beginning
            for (const agentName of AGENT_WORKFLOW_ORDER) {
                if (availableAgents.includes(agentName)) {
                    const agent = this.agents.get(agentName);
                    if (agent && agent.canProcess()) {
                        return agent;
                    }
                }
            }
            return null;
        }

        // Find next agent in workflow order who can still process
        for (let i = currentIndex + 1; i < AGENT_WORKFLOW_ORDER.length; i++) {
            const agentName = AGENT_WORKFLOW_ORDER[i];
            if (availableAgents.includes(agentName)) {
                const agent = this.agents.get(agentName);
                if (agent && agent.canProcess()) {
                    console.log(`📋 Workflow: ${currentAgentName} → ${agentName} (step ${i + 1}/${AGENT_WORKFLOW_ORDER.length})`);
                    return agent;
                }
            }
        }

        // Reached end of workflow
        return null;
    }

    private async logCycle(cyclePath: string, message: string, data: any): Promise<void> {
        const entry = {
            timestamp: new Date().toISOString(),
            message,
            ...data
        };
        await FileUtils.appendToLog(cyclePath, entry);
    }

    private async updateCostSummary(): Promise<void> {
        const records = this.cycleCosts.map(cycle => {
            const agents = Array.from(this.agents.values());
            return agents.map(agent => {
                const state = agent.getState();
                const lastOp = state.operations[state.operations.length - 1];
                return {
                    timestamp: lastOp?.timestamp.toISOString(),
                    cycleId: cycle.cycle,
                    agent: agent.getName(),
                    model: agent.getModel(),
                    operation: lastOp?.operation || 'none',
                    inputTokens: lastOp?.inputTokens || 0,
                    outputTokens: lastOp?.outputTokens || 0,
                    cost: lastOp?.cost || 0,
                    cycleTotalUSD: cycle.total
                };
            });
        }).flat();

        await FileUtils.appendToCsv(this.config.costSummaryPath, records);
    }

    getCostSummary(): { thisRun: number; allTime: number; budget: number; estimatedRunsLeft: number } {
        const thisRunCost = this.cycleCosts.reduce((sum, c) => sum + c.total, 0);

        // Get all-time cost from agent states (persisted across runs)
        const allTimeCost = Array.from(this.agents.values())
            .reduce((sum, agent) => sum + agent.getState().totalCost, 0);

        const budget = 60; // $50-70, using $60 as midpoint
        const estimatedRunsLeft = Math.floor((budget - allTimeCost) / (thisRunCost || 0.01));

        return {
            thisRun: thisRunCost,
            allTime: allTimeCost,
            budget,
            estimatedRunsLeft: Math.max(0, estimatedRunsLeft)
        };
    }

    private async generateFinalSummary(): Promise<void> {
        const summary = Array.from(this.agents.values()).map(agent => {
            const state = agent.getState();
            return {
                agent: agent.getName(),
                totalCost: state.totalCost,
                totalOperations: state.operations.length,
                totalTokens: state.totalTokensUsed
            };
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await FileUtils.writeFile(
            `${this.config.logDirectory}/final_summary_${timestamp}.json`,
            JSON.stringify(summary, null, 2)
        );
    }
    private async runSimulationCycle(cyclePath: string, cycleId: string): Promise<void> {
        console.log(`Running simulation cycle ${cycleId}`);

        // Initial project file setup
        const projectFile: ProjectFile = {
            content: `// A TypeScript class for managing user preferences
    // with validation and type safety
    class UserPreferences {
        // TODO: Define user preference storage and validation
        // Needs to handle:
        // - Theme settings (light/dark)
        // - Notification preferences
        // - Privacy settings
        // Requirements TBD...
    }`,
            currentStage: 'initial_design',
            history: []
        };

        // Simulate agents in sequence: UX → Architect → Implementation → Guardian
        const agentSequence = [
            "UX Visionary",
            "System Architect",
            "Implementation Specialist",
            "Guardian"
        ];

        await this.logCycle(cyclePath, 'Starting simulation cycle', {
            cycleId,
            initialAgent: agentSequence[0]
        });

        let currentContent = projectFile.content;

        // Simulate each agent's contribution
        for (const agentName of agentSequence) {
            console.log(`Simulating ${agentName}...`);

            const simulatedResult = this.getSimulatedAgentResponse(agentName, currentContent);

            // Update project file history
            projectFile.history.push({
                agent: agentName,
                timestamp: new Date().toISOString(),
                action: 'review_and_modify',
                notes: simulatedResult.reasoning,
                changes: simulatedResult.changes
            });

            // Apply changes if any
            if (simulatedResult.changes.code) {
                currentContent = simulatedResult.changes.code;
                projectFile.content = currentContent;
            }

            await this.logCycle(cyclePath, 'Simulated processing step', {
                agent: agentName,
                currentState: projectFile,
                cost: 0 // No actual API call cost
            });
        }

        await this.logCycle(cyclePath, 'Simulation cycle complete', {
            finalState: projectFile
        });

        // Record a zero-cost cycle
        this.cycleCosts.push({ cycle: cycleId, total: 0, logPath: cyclePath });
    }

    private getSimulatedAgentResponse(agentName: string, currentContent: string): {
        changes: Changes;
        reasoning: string;
    } {
        // Predefined responses for simulation
        const responses: { [key: string]: { changes: Changes, reasoning: string } } = {
            "UX Visionary": {
                changes: {
                    description: "Defined user preferences structure with type safety for theme, notifications, and privacy settings",
                    code: `class UserPreferences {
        private _theme: 'light' | 'dark';
        private _notifications: {
            enabled: boolean;
            frequency: 'immediate' | 'daily' | 'weekly';
        };
        private _privacySettings: {
            shareDataWithThirdParties: boolean;
            anonymizeData: boolean;
        };
    
        constructor(initialSettings: {
            theme?: 'light' | 'dark';
            notifications?: {
                enabled?: boolean;
                frequency?: 'immediate' | 'daily' | 'weekly';
            };
            privacySettings?: {
                shareDataWithThirdParties?: boolean;
                anonymizeData?: boolean;
            };
        }) {
            this._theme = initialSettings.theme || 'light';
            this._notifications = {
                enabled: initialSettings.notifications?.enabled ?? true,
                frequency: initialSettings.notifications?.frequency || 'daily',
            };
            this._privacySettings = {
                shareDataWithThirdParties: initialSettings.privacySettings?.shareDataWithThirdParties ?? false,
                anonymizeData: initialSettings.privacySettings?.anonymizeData ?? true,
            };
        }
    
        get theme(): 'light' | 'dark' {
            return this._theme;
        }
    
        set theme(theme: 'light' | 'dark') {
            this._theme = theme;
        }
    
        get notifications() {
            return this._notifications;
        }
    
        set notifications(notifications: {
            enabled?: boolean;
            frequency?: 'immediate' | 'daily' | 'weekly';
        }) {
            this._notifications.enabled = notifications.enabled ?? this._notifications.enabled;
            this._notifications.frequency = notifications.frequency || this._notifications.frequency;
        }
    
        get privacySettings() {
            return this._privacySettings;
        }
    
        set privacySettings(privacySettings: {
            shareDataWithThirdParties?: boolean;
            anonymizeData?: boolean;
        }) {
            this._privacySettings.shareDataWithThirdParties = privacySettings.shareDataWithThirdParties ?? this._privacySettings.shareDataWithThirdParties;
            this._privacySettings.anonymizeData = privacySettings.anonymizeData ?? this._privacySettings.anonymizeData;
        }
    }`,
                    location: "UserPreferences class"
                },
                reasoning: "Created a strongly-typed UserPreferences class with default values and getters/setters"
            },
            "System Architect": {
                changes: {
                    description: "Refactored the UserPreferences class to use explicit types and improve maintainability",
                    code: `class UserPreferences {
        private _theme: 'light' | 'dark';
        private _notifications: Notifications;
        private _privacySettings: PrivacySettings;
    
        constructor(initialSettings: UserPreferencesSettings) {
            this._theme = initialSettings.theme ?? 'light';
            this._notifications = {
                enabled: initialSettings.notifications?.enabled ?? true,
                frequency: initialSettings.notifications?.frequency ?? 'daily',
            };
            this._privacySettings = {
                shareDataWithThirdParties: initialSettings.privacySettings?.shareDataWithThirdParties ?? false,
                anonymizeData: initialSettings.privacySettings?.anonymizeData ?? true,
            };
        }
    
        get theme(): 'light' | 'dark' {
            return this._theme;
        }
    
        set theme(theme: 'light' | 'dark') {
            this._theme = theme;
        }
    
        get notifications(): Notifications {
            return this._notifications;
        }
    
        set notifications(notifications: Partial<Notifications>) {
            this._notifications = { ...this._notifications, ...notifications };
        }
    
        get privacySettings(): PrivacySettings {
            return this._privacySettings;
        }
    
        set privacySettings(privacySettings: Partial<PrivacySettings>) {
            this._privacySettings = { ...this._privacySettings, ...privacySettings };
        }
    }
    
    type Notifications = {
        enabled: boolean;
        frequency: 'immediate' | 'daily' | 'weekly';
    };
    
    type PrivacySettings = {
        shareDataWithThirdParties: boolean;
        anonymizeData: boolean;
    };
    
    type UserPreferencesSettings = {
        theme?: 'light' | 'dark';
        notifications?: Partial<Notifications>;
        privacySettings?: Partial<PrivacySettings>;
    };`,
                    location: "UserPreferences class"
                },
                reasoning: "Extracted types for better maintainability and used the Partial utility type to make property updates more flexible"
            },
            "Implementation Specialist": {
                changes: {
                    description: "Refactored the initialization logic into separate methods for better maintainability",
                    code: `class UserPreferences {
        private _theme: 'light' | 'dark';
        private _notifications: Notifications;
        private _privacySettings: PrivacySettings;
    
        constructor(initialSettings: UserPreferencesSettings) {
            this._theme = initialSettings.theme ?? 'light';
            this._notifications = this.initializeNotifications(initialSettings.notifications);
            this._privacySettings = this.initializePrivacySettings(initialSettings.privacySettings);
        }
    
        private initializeNotifications(notifications?: Partial<Notifications>): Notifications {
            return {
                enabled: notifications?.enabled ?? true,
                frequency: notifications?.frequency ?? 'daily',
            };
        }
    
        private initializePrivacySettings(privacySettings?: Partial<PrivacySettings>): PrivacySettings {
            return {
                shareDataWithThirdParties: privacySettings?.shareDataWithThirdParties ?? false,
                anonymizeData: privacySettings?.anonymizeData ?? true,
            };
        }
    
        get theme(): 'light' | 'dark' {
            return this._theme;
        }
    
        set theme(theme: 'light' | 'dark') {
            this._theme = theme;
        }
    
        get notifications(): Notifications {
            return this._notifications;
        }
    
        set notifications(notifications: Partial<Notifications>) {
            this._notifications = { ...this._notifications, ...notifications };
        }
    
        get privacySettings(): PrivacySettings {
            return this._privacySettings;
        }
    
        set privacySettings(privacySettings: Partial<PrivacySettings>) {
            this._privacySettings = { ...this._privacySettings, ...privacySettings };
        }
    }
    
    type Notifications = {
        enabled: boolean;
        frequency: 'immediate' | 'daily' | 'weekly';
    };
    
    type PrivacySettings = {
        shareDataWithThirdParties: boolean;
        anonymizeData: boolean;
    };
    
    type UserPreferencesSettings = {
        theme?: 'light' | 'dark';
        notifications?: Partial<Notifications>;
        privacySettings?: Partial<PrivacySettings>;
    };`,
                    location: "UserPreferences class"
                },
                reasoning: "Added private initialization methods to make the constructor cleaner and more maintainable"
            },
            "Guardian": {
                changes: {
                    description: "Reviewed the implementation for security concerns and made no changes",
                    code: `class UserPreferences {
        private _theme: 'light' | 'dark';
        private _notifications: Notifications;
        private _privacySettings: PrivacySettings;
    
        constructor(initialSettings: UserPreferencesSettings) {
            this._theme = initialSettings.theme ?? 'light';
            this._notifications = this.initializeNotifications(initialSettings.notifications);
            this._privacySettings = this.initializePrivacySettings(initialSettings.privacySettings);
        }
    
        private initializeNotifications(notifications?: Partial<Notifications>): Notifications {
            return {
                enabled: notifications?.enabled ?? true,
                frequency: notifications?.frequency ?? 'daily',
            };
        }
    
        private initializePrivacySettings(privacySettings?: Partial<PrivacySettings>): PrivacySettings {
            return {
                shareDataWithThirdParties: privacySettings?.shareDataWithThirdParties ?? false,
                anonymizeData: privacySettings?.anonymizeData ?? true,
            };
        }
    
        get theme(): 'light' | 'dark' {
            return this._theme;
        }
    
        set theme(theme: 'light' | 'dark') {
            this._theme = theme;
        }
    
        get notifications(): Notifications {
            return this._notifications;
        }
    
        set notifications(notifications: Partial<Notifications>) {
            this._notifications = { ...this._notifications, ...notifications };
        }
    
        get privacySettings(): PrivacySettings {
            return this._privacySettings;
        }
    
        set privacySettings(privacySettings: Partial<PrivacySettings>) {
            this._privacySettings = { ...this._privacySettings, ...privacySettings };
        }
    }
    
    type Notifications = {
        enabled: boolean;
        frequency: 'immediate' | 'daily' | 'weekly';
    };
    
    type PrivacySettings = {
        shareDataWithThirdParties: boolean;
        anonymizeData: boolean;
    };
    
    type UserPreferencesSettings = {
        theme?: 'light' | 'dark';
        notifications?: Partial<Notifications>;
        privacySettings?: Partial<PrivacySettings>;
    };`,
                    location: "UserPreferences class"
                },
                reasoning: "The implementation includes good privacy practices with secure defaults (opt-out of data sharing, opt-in to anonymization)"
            }
        };

        return responses[agentName] || {
            changes: {
                description: "No changes made",
                code: currentContent,
                location: "N/A"
            },
            reasoning: "Agent not recognized"
        };
    }
}