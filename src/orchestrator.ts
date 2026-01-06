import { Agent } from './agent';
import { FileUtils } from './utils/file-utils';
import { AGENT_CONFIGS, API_KEYS } from './config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AgentConfig, ProjectFile, Changes, OrchestratorContext, FileWriteRequest, CodeChange } from './types';
import { generateVersion } from './utils/version-utils';

interface OrchestratorConfig {
    maxCycles: number;
    logDirectory: string;
    costSummaryPath: string;
    simulationMode?: boolean;
    conversationMode?: boolean;  // NEW: For team discussions
}

export class Orchestrator {
    private agents: Map<string, Agent>;
    private anthropicClient: Anthropic;
    private openaiClient: OpenAI;
    private cycleCount: number = 0;
    private cycleCosts: Array<{cycle: string, total: number, logPath: string}> = [];

    constructor(private config: OrchestratorConfig) {
        this.anthropicClient = new Anthropic({ apiKey: API_KEYS.anthropic });
        this.openaiClient = new OpenAI({ apiKey: API_KEYS.openai });
        this.agents = new Map<string, Agent>();
        this.initializeAgents();
    }

    private initializeAgents(): void {
        for (const [key, agentConfig] of Object.entries(AGENT_CONFIGS)) {
            if (key === 'orchestrator') continue;

            const client = agentConfig.model.startsWith('claude')
                ? this.anthropicClient
                : this.openaiClient;

            this.agents.set(
                agentConfig.name,
                new Agent(agentConfig, this.config.logDirectory, client)
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CONTEXT MANAGEMENT (Phase 1: State Persistence)
    // ═══════════════════════════════════════════════════════════════

    private getContextPath(): string {
        return `${this.config.logDirectory}/../state/orchestrator-context.json`;
    }

    async loadContext(): Promise<OrchestratorContext | null> {
        try {
            const contextPath = this.getContextPath();
            const content = await FileUtils.readFile(contextPath);
            const context = JSON.parse(content) as OrchestratorContext;
            console.log(`📖 Loaded context from run #${context.runNumber}`);
            return context;
        } catch (error) {
            // No context file exists - this is a fresh start
            return null;
        }
    }

    async saveContext(context: OrchestratorContext): Promise<void> {
        const contextPath = this.getContextPath();
        await FileUtils.ensureDir(`${this.config.logDirectory}/../state`);
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
            humanNotes: ''
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
${lastRun ? lastRun.summary : 'This is the first run'}

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
     * Handles file write requests from agents, including TypeScript validation
     */
    private async handleFileWrite(fileWrite: FileWriteRequest, agentName: string): Promise<void> {
        console.log(`\n📝 ${agentName} requesting file write: ${fileWrite.filePath}`);
        console.log(`   Reason: ${fileWrite.reason}`);

        const context = await this.loadContext();
        if (!context) {
            console.error('❌ No context loaded, cannot track code changes');
            return;
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

        try {
            // Step 1: Write to temporary location for validation
            const tempPath = `${fileWrite.filePath}.tmp`;
            await FileUtils.ensureDir(fileWrite.filePath.substring(0, fileWrite.filePath.lastIndexOf('/')));
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

            } catch (compileError: any) {
                // Compilation failed
                const errorMsg = compileError.stderr || compileError.stdout || compileError.message;
                console.error(`   ❌ TypeScript compilation failed:`);
                console.error(`   ${errorMsg.substring(0, 500)}`);

                codeChange.status = 'failed';
                codeChange.validationError = errorMsg;

                // Clean up temp file
                try {
                    const fs = await import('fs/promises');
                    await fs.unlink(tempPath);
                } catch {}

                console.log(`   ⚠️  File NOT saved due to compilation errors`);
            }

        } catch (error: any) {
            console.error(`   ❌ Error handling file write: ${error.message}`);
            codeChange.status = 'failed';
            codeChange.validationError = error.message;
        }

        // Track in context
        context.codeChanges.push(codeChange);
        await this.saveContext(context);

        console.log(`   📊 Status: ${codeChange.status}\n`);
    }

    /**
     * Check if file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            const fs = await import('fs/promises');
            await fs.access(filePath);
            return true;
        } catch {
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

        // 4 out of 5 is consensus
        if (agreeCount >= 4) return true;

        // Alternative: If we have 3 agrees and 1 "building" (not blocking), consider it effective consensus
        const buildingCount = Object.values(signals).filter(s => s === 'building').length;
        if (agreeCount >= 3 && buildingCount >= 1 && signals && Object.keys(signals).length >= 4) {
            return true;
        }

        return false;
    }

    /**
     * Generates implementation-focused prompt with design decisions from discussion.
     */
    private generateImplementationPrompt(context: OrchestratorContext): string {
        const decisions = context.discussionSummary.keyDecisions.length > 0
            ? context.discussionSummary.keyDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
            : 'See discussion summary below.';

        return `IMPLEMENTATION TASK: Shared Memory Cache

You are part of a self-improving AI team building a virtual assistant framework.

CONSENSUS REACHED ✅
Your team has agreed on the design for SharedMemoryCache. Now it's time to implement it!

APPROVED DESIGN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**Feature**: Shared Memory Cache (Three-Bucket LRU)

**Purpose**: Help agents share context across runs, token-aware caching, prevent memory overflow

**Core Design**:
- Three classification buckets: transient / decision / sensitive
- LRU (Least Recently Used) eviction within each bucket
- TTL (Time To Live) per bucket type
- Optional reason field for observability (write-time documentation only)
- 50k token hard cap total
- Sensitive bucket gets 10% of cache (~5k tokens), never auto-evicts
- Aggressive eviction logging from day one

**Technical Details**:
- File location: src/memory/shared-cache.ts
- Interface: SharedMemoryCache class
- Methods needed:
  - store(key, value, bucket, reason?)
  - retrieve(key)
  - evict(key)
  - getStats()
- Instrumentation: log every write, access, eviction event

**Implementation Timeline**:
- Core LRU logic: 2-3 days
- Eviction logging: included from start
- Integration: ready for use in next discussion cycle

**Key Constraints** (DO NOT violate):
1. Reason field is documentation-only, NEVER use for eviction logic
2. If iteration needed, tune heuristics first (TTLs, access weights)
3. Don't over-engineer - this is MVP, ship fast
4. Must be usable by agents in their NEXT discussion

**Your Role**:
${AGENT_CONFIGS.Morgan ? '**Morgan**: You own the core implementation. Build working code.' : ''}
${AGENT_CONFIGS.Sam ? '**Sam**: Review for safety, ensure logging is observable.' : ''}
${AGENT_CONFIGS.Jordan ? '**Jordan**: Verify guardrails (reason field read-only, no policy matrix creep).' : ''}
${AGENT_CONFIGS.Alex ? '**Alex**: Check DX - will agents actually USE this easily?' : ''}
${AGENT_CONFIGS.Pierre ? '**Pierre**: Keep scope tight, ensure we ship something usable.' : ''}

IMMEDIATE GOAL:
Write the TypeScript code for SharedMemoryCache. Make it:
- ✅ TypeScript-clean (will be compiled before use)
- ✅ Documented (inline comments for key decisions)
- ✅ Usable in next cycle (simple API)
- ✅ Observable (logs everything)

**⚠️ CRITICAL: HOW TO WRITE CODE TO DISK ⚠️**

DO NOT embed code in "changes.code" - it will be truncated and cause JSON parse errors!

REQUIRED: Use the "fileWrite" capability for ALL code implementations:

\`\`\`json
{
  "fileWrite": {
    "action": "write_file",
    "filePath": "src/memory/shared-cache.ts",
    "content": "<your full TypeScript code here>",
    "reason": "Initial implementation of SharedMemoryCache"
  },
  "target": "Sam",
  "reasoning": "I've implemented the core cache. Sam, please review for safety.",
  "consensus": "building"
}
\`\`\`

**DO NOT include a "changes" field when writing code files.**
**Use ONLY "fileWrite" for TypeScript implementations.**

**What happens when you use fileWrite:**
1. ✅ No JSON truncation (content can be any size)
2. ✅ Automatic TypeScript validation (\`tsc --noEmit\`)
3. ✅ Only saved if compilation succeeds
4. ✅ Errors shown immediately if code is invalid
5. ✅ Tracked in context for next run

**If you want to discuss/review without writing:**
- Set "fileWrite": null
- Use "reasoning" and "notes" to explain your thoughts
- Signal "consensus": "building" to continue discussion

When implementation is complete and validated, signal consensus="agree".

Reference: docs/ORCHESTRATOR_GUIDE.md for context system details.`;
    }

    // ═══════════════════════════════════════════════════════════════

    async runCycles(): Promise<void> {
        // Check for existing context
        const context = await this.loadContext();

        if (context) {
            // Resuming from previous run
            console.log(this.generateBriefing(context));
            console.log(`\n🔄 Resuming from run #${context.runNumber}...\n`);

            // Restore agent states
            for (const [agentName, state] of Object.entries(context.agentStates)) {
                const agent = this.agents.get(agentName);
                if (agent) {
                    // Restore agent state here if needed
                    // For now, agents will start fresh but context is preserved
                }
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
            await this.runCycle();
            this.cycleCount++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await this.generateFinalSummary();
        await this.generateNarrativeSummary();

        // Update context with final state
        await this.updateContextAtEnd();
    }

    private async updateContextAtEnd(consensusSignals?: Record<string, string>): Promise<void> {
        const context = await this.loadContext();
        if (!context) return;

        // Capture agent states
        const agentStates: Record<string, any> = {};
        for (const [name, agent] of this.agents.entries()) {
            const state = agent.getState();
            agentStates[name] = {
                timesProcessed: state.timesProcessed,
                totalCost: state.totalCost,
                canProcess: agent.canProcess()
            };
        }

        // Calculate total cost
        const totalCost = this.cycleCosts.reduce((sum, c) => sum + c.total, 0);

        // Update consensus signals if provided
        if (consensusSignals && Object.keys(consensusSignals).length > 0) {
            context.discussionSummary.consensusSignals = consensusSignals;

            // Check if consensus was reached
            const agreeCount = Object.values(consensusSignals).filter(s => s === 'agree').length;
            if (agreeCount >= 4) {
                context.discussionSummary.consensusReached = true;
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

        // Update context
        context.agentStates = agentStates;
        context.totalCost += totalCost;
        context.lastUpdated = new Date().toISOString();

        await this.saveContext(context);
        console.log(`\n💾 Saved context for run #${context.runNumber}`);
    }

    private async runCycle(): Promise<void> {

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const cycleId = `cycle_${String(this.cycleCount + 1).padStart(3, '0')}`;
        const cyclePath = `${this.config.logDirectory}/cycles/${timestamp}_${cycleId}.log`;

        await FileUtils.initializeLogFile(cyclePath);

        // Check if we have consensus from previous run and should switch to implementation mode
        const context = await this.loadContext();
        let projectFileContent: string;
        let projectStage: string;

        if (context && this.hasConsensus(context)) {
            // Implementation mode - consensus reached, time to code!
            projectFileContent = this.generateImplementationPrompt(context);
            projectStage = 'implementation';
            console.log(`\n✅ Consensus detected! Switching to IMPLEMENTATION mode.\n`);

            // Update context to reflect phase change
            await this.updateContext({ currentPhase: 'code_review' });
        } else {
            // Discussion mode - still deciding what to build
            projectFileContent = `TEAM DISCUSSION: Pick ONE Feature to Implement

You are part of a self-improving AI team building a virtual assistant framework.

CURRENT SYSTEM:
- Built in TypeScript with Claude/OpenAI API
- Multi-agent orchestration with cost tracking
- Context persistence across runs (NEW!)
- Consensus-based decision making

NEW CAPABILITY:
The orchestrator now saves your progress between runs! Check docs/ORCHESTRATOR_GUIDE.md for details.
Your discussions continue where they left off. No more starting from scratch!

YOUR HUMAN USER:
- Values shipping features over endless discussion
- Wants you to work autonomously (less human intervention)
- Prefers robust, simple solutions over over-engineered ones

YOUR TASK:
Pick ONE feature to implement fully. Choose something that helps you:
1. Function longer without human intervention
2. Maintain context across restarts
3. Coordinate better as a team
4. Recover from errors gracefully

SUGGESTED FIRST FEATURE:
Based on previous discussions, consider: **Shared Memory Cache**
- Helps agents share context across runs
- Token-aware caching (prevent memory overflow)
- Priority-based pruning (keep important stuff)
- Security classifications (protect sensitive data)

OTHER OPTIONS (pick ONE):
- Enhanced state serialization
- Agent handoff protocol (prevent stepping on toes)
- Code validation pipeline (catch errors before applying)
- Error recovery system (retry with backoff)

DISCUSSION GOALS:
1. Debate which ONE feature to build first
2. Reach consensus (4/5 agents agree)
3. Define SPECIFIC implementation details
4. Be ready to write actual working code

IMPORTANT:
- Focus on ONE feature only
- Don't over-engineer (Jordan: MVP mode!)
- Be direct, challenge ideas, disagree when needed
- Signal consensus honestly: agree/building/disagree

Reference: See docs/ORCHESTRATOR_GUIDE.md for how the context system works.`;
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
            return;
        }

        // Start with Alex (UX Visionary)
        let currentAgent = this.agents.get("Alex");
        if (!currentAgent) {
            throw new Error('Could not find initial agent');
        }

        // Track consensus signals
        const consensusSignals: Record<string, string> = {};

        await this.logCycle(cyclePath, 'Starting cycle', {
            cycleId,
            initialAgent: currentAgent.getName()
        });

        const cycleCost = { cycle: cycleId, total: 0, logPath: cyclePath };

        while (true) {
            // Check for consensus (4 out of 5 agents agree)
            const agreeCount = Object.values(consensusSignals).filter(s => s === 'agree').length;
            const totalAgents = this.agents.size;
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

            const availableTargets = Array.from(this.agents.values())
                .filter(a => a.canProcess())
                .map(a => a.getName());

            if (availableTargets.length === 0) {
                await this.logCycle(cyclePath, 'Cycle complete - no available targets', {
                    finalState: projectFile,
                    consensusSignals,
                    finalAgreeCount: agreeCount
                });
                console.log(`\nDiscussion ended. Final consensus: ${agreeCount}/${totalAgents} agents agree.`);
                break;
            }

            const result = await currentAgent.processFile(projectFile, availableTargets);
            cycleCost.total += result.cost;

            if (!result.accepted) {
                const newTarget = this.getRandomAvailableAgent(availableTargets);
                if (!newTarget) break;
                currentAgent = newTarget;
                continue;
            }

            // Track consensus signal
            if (result.consensus) {
                consensusSignals[currentAgent.getName()] = result.consensus;
                console.log(`  ${currentAgent.getName()}: ${result.consensus}`);
            }

            // Update project file history
            projectFile.history.push({
                agent: currentAgent.getName(),
                timestamp: new Date().toISOString(),
                action: 'review_and_modify',
                notes: result.reasoning,
                changes: result.changes || { description: '', location: '' }
            });

            // Apply changes if any
            if (result.changes) {
                projectFile.content = result.changes.code || projectFile.content;
            }

            // Handle file write requests
            if (result.fileWrite) {
                await this.handleFileWrite(result.fileWrite, currentAgent.getName());
            }

            // Get next agent
            const nextAgent = this.agents.get(result.targetAgent);
            if (!nextAgent) {
                await this.logCycle(cyclePath, 'Invalid target agent selected', {
                    requestedAgent: result.targetAgent,
                    availableAgents: Array.from(this.agents.keys()),
                    availableTargets
                });
                console.log(`⚠️  ${currentAgent.getName()} selected unavailable agent "${result.targetAgent}". Picking random available agent.`);
                const fallbackAgent = this.getRandomAvailableAgent(availableTargets);
                if (!fallbackAgent) break;
                currentAgent = fallbackAgent;
                continue;
            }

            // Check if the target agent can still process
            if (!nextAgent.canProcess()) {
                console.log(`⚠️  ${result.targetAgent} has hit processing limit. Picking different agent.`);
                const fallbackAgent = this.getRandomAvailableAgent(availableTargets);
                if (!fallbackAgent) break;
                currentAgent = fallbackAgent;
                continue;
            }

            currentAgent = nextAgent;

            await this.logCycle(cyclePath, 'Processing step', {
                agent: currentAgent.getName(),
                currentState: projectFile,
                cost: result.cost
            });
        }

        this.cycleCosts.push(cycleCost);
        await this.updateCostSummary();

        // Save consensus signals to context
        if (Object.keys(consensusSignals).length > 0) {
            await this.updateContextAtEnd(consensusSignals);
        }
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
            const percentage = total > 0 ? ((cost/total)*100).toFixed(1) : '0.0';
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

    private getRandomAgent(): Agent | null {
        const agents = Array.from(this.agents.values());
        if (agents.length === 0) return null;
        return agents[Math.floor(Math.random() * agents.length)];
    }

    private getRandomAvailableAgent(availableAgents: string[]): Agent | null {
        if (availableAgents.length === 0) return null;
        const agentName = availableAgents[Math.floor(Math.random() * availableAgents.length)];
        const agent = this.agents.get(agentName);
        if (!agent) {
            console.error(`Agent not found: ${agentName}. Available agents: ${Array.from(this.agents.keys()).join(', ')}`);
            return null;
        }
        return agent;
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
        const responses: {[key: string]: {changes: Changes, reasoning: string}} = {
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