import { BaseAgent, AgentState } from './agent-base';
import { AgentConfig, ProcessResult, ProjectFile, FileWriteRequest, FileReadRequest, FileEditRequest } from './types';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { FileUtils } from './utils/file-utils';

interface ApiResponse {
    changes: {
        description: string;
        code?: string;
        location?: string;
    };
    fileRead?: FileReadRequest;
    fileEdit?: FileEditRequest;
    fileWrite?: FileWriteRequest;
    targetAgent: string
    reasoning: string;
    notes: string;
    consensus?: 'agree' | 'building' | 'disagree';
}

export class Agent extends BaseAgent {
    private readonly apiClient: Anthropic | OpenAI;
    
    constructor(
        config: AgentConfig,
        logDirectory: string,
        apiClient: Anthropic | OpenAI
    ) {
        super(config, logDirectory);
        this.apiClient = apiClient;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.logPath = `${logDirectory}/agents/${timestamp}_${this.config.name.toLowerCase().replace(/\s+/g, '_')}.log`;
    }

    getName(): string {
        return this.config.name;
    }

    getModel(): string {
        return this.config.model;
    }

    getState(): AgentState {
        return { ...this.state };
    }

    /**
     * Attempts to recover truncated JSON by finding the last valid JSON structure
     */
    private attemptJsonRecovery(truncatedJson: string): string {
        // Strategy: Find the last position where we have a complete, valid JSON property
        // Work backwards from the end to find safe truncation points

        let bestRecovery = truncatedJson;

        // Try to find patterns like: "key": "value",\n or "key": value,\n
        // These are safe places to truncate
        const safePatterns = [
            /,\s*$/,          // Ends with comma (safe to remove last incomplete property)
            /\},\s*$/,        // Ends with },
            /\],\s*$/,        // Ends with ],
            /"\s*,\s*$/,      // Ends with string and comma
            /\d+\s*,\s*$/,    // Ends with number and comma
            /true\s*,\s*$/,   // Ends with true and comma
            /false\s*,\s*$/,  // Ends with false and comma
            /null\s*,\s*$/    // Ends with null and comma
        ];

        // Work backwards to find a safe truncation point
        for (let cutoff = truncatedJson.length; cutoff > 0; cutoff -= 50) {
            const candidate = truncatedJson.substring(0, cutoff);

            // Check if this ends with a safe pattern
            for (const pattern of safePatterns) {
                if (pattern.test(candidate)) {
                    // Remove trailing comma if present
                    bestRecovery = candidate.replace(/,\s*$/, '');
                    console.warn(`[Agent] Found safe truncation point at ${cutoff} chars`);

                    // Close any open structures
                    return this.closeOpenStructures(bestRecovery);
                }
            }
        }

        // Fallback: just try to close structures
        console.warn(`[Agent] No safe truncation point found, attempting to close structures`);
        return this.closeOpenStructures(truncatedJson);
    }

    /**
     * Closes any open braces/brackets in JSON
     */
    private closeOpenStructures(json: string, depth: number = 0): string {
        // Prevent infinite recursion
        if (depth > 3) {
            console.error(`[Agent] Truncation recovery failed after ${depth} attempts, giving up`);
            return '{}'; // Return minimal valid JSON
        }

        let result = json;

        // Count open braces and brackets
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;

        for (const char of result) {
            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
                if (char === '[') bracketCount++;
                if (char === ']') bracketCount--;
            }
        }

        // If we're mid-string, truncate to last complete property
        if (inString) {
            // Find last comma or opening brace - safer truncation points
            let lastComma = result.lastIndexOf(',');
            let lastBrace = result.lastIndexOf('{');
            let truncatePoint = Math.max(lastComma, lastBrace);

            if (truncatePoint > 0) {
                result = result.substring(0, truncatePoint + 1);
                console.warn(`[Agent] Truncated at position ${truncatePoint}, depth ${depth}`);
                // Recurse with depth limit
                return this.closeOpenStructures(result, depth + 1);
            } else {
                // Can't find safe point, return minimal JSON
                console.error(`[Agent] No safe truncation point found`);
                return '{}';
            }
        }

        // Close any unclosed structures
        while (bracketCount > 0) {
            result += ']';
            bracketCount--;
        }
        while (braceCount > 0) {
            result += '}';
            braceCount--;
        }

        return result;
    }

    private cleanJsonResponse(response: string): string {
        // Remove markdown code blocks if present
        const originalResponse = response;
        response = response.replace(/```json\n/g, '')
                          .replace(/```\n/g, '')
                          .replace(/```/g, '');
        // Clean up any leading/trailing whitespace
        response = response.trim();

        // Detect if response looks truncated (starts with { but doesn't end with })
        const startsWithBrace = response.startsWith('{');
        const endsWithBrace = response.trimEnd().endsWith('}');

        if (startsWithBrace && !endsWithBrace) {
            // Response is likely truncated - try to salvage it
            console.warn(`[Agent:${this.config.name}] Response appears truncated (${response.length} chars). Attempting recovery...`);

            // Try to close the JSON by counting braces/quotes
            response = this.attemptJsonRecovery(response);
        }

        // Try to find JSON object boundaries and extract just the JSON
        // Use brace counting instead of greedy regex to handle text after JSON
        const firstBrace = response.indexOf('{');
        if (firstBrace !== -1) {
            let braceCount = 0;
            let inString = false;
            let escapeNext = false;
            let jsonEnd = -1;

            for (let i = firstBrace; i < response.length; i++) {
                const char = response[i];

                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }

                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }

                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{') braceCount++;
                    if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            jsonEnd = i + 1;
                            break;
                        }
                    }
                }
            }

            if (jsonEnd !== -1) {
                response = response.substring(firstBrace, jsonEnd);
            }
        }

        // Fix common JSON issues: escape unescaped newlines and tabs in string values
        // This is a rough fix - find strings and escape control characters in them
        try {
            // Try to parse first - if it works, return as-is
            JSON.parse(response);
            return response;
        } catch (e) {
            // If parsing fails, try to fix control characters
            // Replace literal newlines and tabs within quoted strings
            response = response.replace(/"([^"]*?)"/g, (match, content) => {
                const escaped = content
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t');
                return `"${escaped}"`;
            });
            return response;
        }
    }

    async processFile(
        file: ProjectFile,
        availableTargets: string[]
    ): Promise<ProcessResult> {
        if (!this.canProcess()) {
            await this.log('Refusing to process - limit reached', {
                timesProcessed: this.state.timesProcessed,
                stage: file.currentStage
            });
            return {
                accepted: false,
                targetAgent: availableTargets[0], // Must pass to someone
                reasoning: 'Processing limit reached',
                changes: {
                    description: '',
                    code: undefined,
                    location: undefined
                },
                cost: 0,
                tokens: { input: 0, output: 0 }
            };
        }

        try {
            let response: ApiResponse;
            let tokens: { input: number; output: number };
            let cost: number;

            const historyText = file.history
                .map(h => {
                    const changes = typeof h.changes === 'string' 
                        ? h.changes 
                        : h.changes.description + (h.changes.code ? '\nCode:\n' + h.changes.code : '');
                    return `${h.agent}: ${h.action}\n${h.notes}${changes ? '\nChanges made:\n' + changes : ''}`;
                })
                .join('\n\n');

            // Check if this is a conversation vs code task
            const isConversation = file.content.includes('TEAM DISCUSSION');
            const requireConsensus = file.content.includes('Reach consensus');

            const prompt = isConversation ?
                `You are ${this.config.name}. ${this.config.personality}
                Your focus: ${this.config.taskFocus}

                DISCUSSION CONTEXT:
                ${file.content}

                CONVERSATION SO FAR:
                ${historyText || "You're first to speak."}

                AVAILABLE team members (ONLY choose from this list): ${availableTargets.join(', ')}

                Your turn to contribute to the discussion!

                🏗️ WHAT YOU'RE BUILDING:
                You're working on YOUR OWN multi-agent framework called SICLOPS (Self-Improving Collective).
                This is self-improvement work - you ARE the product.

                **Your System:**
                - 5 specialized agents working together in a fixed workflow
                - Orchestrator coordinates turns and handles file operations
                - You're all Claude Sonnet 4.5 models (~$0.15-0.20 per cycle)
                - Building features to improve your own collaboration and memory

                **Your Role:**
                You're ${this.config.name} (${this.config.role}). ${this.config.personality}

                **Context:**
                - This is early POC - bugs expected, focus on working features first
                - No external users - building infrastructure for yourselves
                - You're improving your ability to share context and collaborate

                📓 YOUR NOTEBOOK: notes/${this.config.name.toLowerCase()}-notes.md
                - Read it at start of turn (fileRead) to see your previous thoughts
                - Update it with new observations (fileEdit) before passing on
                - Log future ideas there instead of debating them now
                - Only discuss MVP-critical items in conversation

                📖 HOW FILE READING WORKS (SYNCHRONOUS):
                File reading happens WITHIN your turn. Request multiple files if needed - they're all provided immediately.
                Look for "📖 File content from..." in the "CONVERSATION SO FAR" section.

                🔄 SELF-PASSING: You can pass to yourself up to 3 times if needed.
                Note: File reads don't require self-passing (they happen within same turn).

                IMPORTANT: This is a DISCUSSION, not implementation. Share ideas, ${requireConsensus ? 'debate, challenge assumptions, point out flaws' : 'build on each other\'s ideas, work collaboratively'}. Reference other team members' points. Be direct and CONCISE (under 300 words). DO NOT write implementation code - just talk about what you think should be built and why.

                ${requireConsensus ? `CONSENSUS MECHANISM: Signal if you think the team has reached agreement and is ready to conclude:
                - "agree" = You think we've reached consensus and can move forward
                - "building" = Discussion is productive but not ready to conclude
                - "disagree" = Significant concerns remain, need more discussion

                Discussion concludes when 4 out of 5 team members signal "agree".` : `WORKFLOW: Each agent contributes their perspective, then passes to the next agent. Work through all team members sequentially.`}

                Respond with ONLY a JSON object in this format:
                {
                    "changes": {
                        "description": "Your thoughts and contribution. Be direct. ${requireConsensus ? 'Challenge ideas when needed.' : 'Build on ideas.'} Reference specific points others made. NO CODE - just discussion!",
                        "code": "",
                        "location": "discussion"
                    },
                    "targetAgent": "REQUIRED: Choose ONLY from available list above: ${availableTargets.join(', ')}",
                    "reasoning": "Brief note on who should speak next and why",
                    "notes": "Additional thoughts"${requireConsensus ? ',\n                    "consensus": "agree | building | disagree"' : ''}
                }`
                :
                `You are ${this.config.name}. ${this.config.personality}
                Your focus: ${this.config.taskFocus}

                Current file:
                ${file.content}

                File history:
                ${historyText}

                Available team members to pass to: ${availableTargets.join(', ')}

                🏗️ WHAT YOU'RE BUILDING:
                You're working on YOUR OWN multi-agent framework called SICLOPS (Self-Improving Collective).
                This is self-improvement work - you ARE the product.

                **Your System Architecture:**
                - 5 specialized agents (you and 4 colleagues) working in a fixed workflow sequence
                - Orchestrator (src/orchestrator.ts) coordinates your turns and handles file operations
                - Each agent gets up to 6 turns per cycle before being rate-limited
                - You can self-pass up to 3 times for multi-step work within a cycle
                - All code changes are validated with TypeScript compilation before being saved

                **Your Current Capabilities:**
                - fileRead: Request to read any file (orchestrator provides content in your next turn)
                - fileEdit: Make surgical line-by-line edits to existing files
                - fileWrite: Create brand new files (not for editing existing ones)
                - Notebooks: Each agent has notes/*.md files to track observations across runs

                **What You've Already Built:**
                - SharedMemoryCache (src/memory/shared-cache.ts) - A 3-bucket LRU cache for sharing context
                - State persistence (data/state/orchestrator-context.json) - Costs and progress saved across runs
                - Agent notebooks system (notes/*.md) - For tracking ideas and reducing scope creep
                - File operation infrastructure - Read/edit/write with validation

                **Current Task: Complete SharedMemoryCache Integration**
                The cache exists but isn't connected to the orchestrator yet. You need to:
                1. Import SharedMemoryCache in orchestrator.ts
                2. Initialize it in the constructor
                3. Load cached decisions in loadContext()
                4. Store new decisions in updateContextAtEnd()
                This will let you (agents) remember important context across runs instead of starting fresh each time.

                **Your Role in the Team:**
                You're ${this.config.name} (${this.config.role}). ${this.config.personality}
                Your focus: ${this.config.taskFocus}

                **Important Context:**
                - This is early POC - bugs and rough edges are expected
                - Focus on getting features working first, robustness later
                - No external users yet - you're building infrastructure for yourselves
                - All 5 agents are Claude Sonnet 4.5 models (~$0.15-0.20 per cycle)
                - You're improving your own ability to collaborate and maintain context

                📓 YOUR NOTEBOOK: notes/${this.config.name.toLowerCase()}-notes.md
                - Read it first (fileRead) to see your previous observations
                - Update it (fileEdit) with new learnings before passing on
                - Log non-MVP ideas there instead of implementing them
                - Review suggestions from other agents in their notebooks

                📖 HOW FILE READING WORKS (SYNCHRONOUS):
                File reading happens WITHIN your turn. You can request multiple files and they'll all be provided before you respond.

                Example workflow:
                1. Request fileRead for jordan-notes.md
                   → Orchestrator immediately provides content
                2. Process content, request fileRead for orchestrator.ts
                   → Orchestrator immediately provides content
                3. Process both files, make fileEdit with your changes
                   → Pass to next agent

                All of this happens in ONE turn! No self-passing needed for file reads.
                Look for "📖 File content from..." in the File history section - it appears immediately after you request it.

                🔄 WHEN TO SELF-PASS:
                - Use self-passing ONLY if you need to wait for fileEdit/fileWrite results to be validated
                - For just reading files: NO self-pass needed (happens within same turn)
                - Max 3 self-passes if you need multiple edit/write cycles

                Based on your role and focus:
                1. Review the current state
                2. Make any necessary changes OR log them in your notebook if not MVP-critical
                3. Choose a team member to pass this to (can be yourself for multi-step work)

                CRITICAL: Keep responses CONCISE - focus on ONE specific thing. Use file operations (fileRead, fileEdit, fileWrite) instead of embedding large code blocks.
                You MUST respond with ONLY a valid JSON object.
                IMPORTANT: Ensure all newlines in code are properly escaped as \\n for valid JSON.
                Format:
                {
                    "changes": {
                        "description": "Brief description of changes made",
                        "code": "REQUIRED: Complete TypeScript implementation code that can be directly used. Escape all newlines as \\\\n",
                        "location": "REQUIRED: Specific file/class/method where this code belongs"
                    },
                    "targetAgent": "REQUIRED: Name of the team member who should receive this next (choose from available list)",
                    "reasoning": "REQUIRED: Brief explanation of why you made these changes and why you chose this target agent",
                    "notes": "Additional context or considerations"
                }`;

            if (this.apiClient instanceof Anthropic) {
                const apiResponse = await this.apiClient.messages.create({
                    model: this.config.model,
                    max_tokens: 8192,  // Increased to prevent truncation of long responses
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                });
                
                if (!apiResponse.usage) {
                    throw new Error('No usage data in response');
                }

                tokens = {
                    input: apiResponse.usage.input_tokens,
                    output: apiResponse.usage.output_tokens
                };
                
                cost = this.calculateClaudeCost(tokens.input, tokens.output);
                
                const textContent = apiResponse.content.find(block => block.type === 'text');
                if (!textContent || !('text' in textContent)) {
                    throw new Error('No text content in response');
                }

                const cleanedText = this.cleanJsonResponse(textContent.text);
                try {
                    response = JSON.parse(cleanedText) as ApiResponse;
                } catch (parseError) {
                    // Log the actual response for debugging
                    await this.log('JSON parse error - raw response:', {
                        rawResponse: textContent.text,
                        cleanedResponse: cleanedText,
                        error: parseError instanceof Error ? parseError.message : 'Unknown error'
                    });
                    throw parseError;
                }

                
            } else {
                const apiResponse = await (this.apiClient as OpenAI).chat.completions.create({
                    model: this.config.model,
                    messages: [{
                        role: 'system',
                        content: `You are ${this.config.name}. ${this.config.personality}\nYour focus: ${this.config.taskFocus}`
                    }, {
                        role: 'user',
                        content: prompt
                    }]
                });

                if (!apiResponse.usage || !apiResponse.choices[0]?.message?.content) {
                    throw new Error('Invalid API response structure');
                }

                tokens = {
                    input: apiResponse.usage.prompt_tokens,
                    output: apiResponse.usage.completion_tokens
                };
                
                cost = this.calculateOpenAICost(tokens.input, tokens.output);
                response = JSON.parse(this.cleanJsonResponse(apiResponse.choices[0].message.content)) as ApiResponse;
            }

            await this.updateState('process_file', tokens.input, tokens.output, cost);

            // Validate target agent
            let targetAgent = response.targetAgent;

            // Allow self-passing up to 3 times for multi-step work
            if (targetAgent === this.config.name) {
                if (this.state.consecutiveSelfPasses < 3) {
                    this.state.consecutiveSelfPasses++;
                    console.log(`[Agent:${this.config.name}] Self-passing for multi-step work (${this.state.consecutiveSelfPasses}/3)`);
                } else {
                    // Limit reached, must pass to someone else
                    const othersAvailable = availableTargets.filter(t => t !== this.config.name);
                    if (othersAvailable.length > 0) {
                        targetAgent = othersAvailable[0];
                        console.warn(`[Agent:${this.config.name}] Self-pass limit reached (3/3), must pass to ${targetAgent}`);
                    } else {
                        console.warn(`[Agent:${this.config.name}] No other agents available, forced self-pass`);
                    }
                    this.state.consecutiveSelfPasses = 0; // Reset counter
                }
            } else {
                // Passing to someone else, reset counter
                this.state.consecutiveSelfPasses = 0;
            }

            // Validate target exists in available list
            if (!targetAgent || !availableTargets.includes(targetAgent)) {
                console.warn(`[Agent:${this.config.name}] Invalid target "${targetAgent}", defaulting to ${availableTargets[0]}`);
                targetAgent = availableTargets[0];
            }

            await this.log('Processed file', {
                stage: file.currentStage,
                changes: response.changes,
                target: targetAgent,
                reasoning: response.reasoning,
                notes: response.notes,
                consensus: response.consensus,
                fileRead: response.fileRead,
                fileEdit: response.fileEdit,
                fileWrite: response.fileWrite
            });

            return {
                accepted: true,
                targetAgent: targetAgent,
                reasoning: response.reasoning,
                changes: response.changes,
                fileRead: response.fileRead,
                fileEdit: response.fileEdit,
                fileWrite: response.fileWrite,
                notes: response.notes,
                consensus: response.consensus,
                cost,
                tokens
            };

        } catch (error) {
            await this.log('Error processing file', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stage: file.currentStage
            });
            throw error;
        }
    }

    private calculateClaudeCost(inputTokens: number, outputTokens: number): number {
        if (this.config.model.includes('haiku')) {
            // Claude Haiku (3.5/4.5): $1/$5 per million tokens
            return (inputTokens * 0.000001) + (outputTokens * 0.000005);
        }
        // Claude Sonnet (3.5/4.5): $3/$15 per million tokens
        return (inputTokens * 0.000003) + (outputTokens * 0.000015);
    }

    private calculateOpenAICost(inputTokens: number, outputTokens: number): number {
        // GPT-4o mini: $0.15/$0.60 per million tokens
        return (inputTokens * 0.00000015) + (outputTokens * 0.0000006);
    }
}

// 2025 Pricing Reference:
//
// Claude:
// - Haiku 3.5/4.5: $1/$5 per million tokens
// - Sonnet 3.5/4.5: $3/$15 per million tokens
// - Opus 4.5: $5/$25 per million tokens
//
// OpenAI:
// - GPT-4o: $2.50/$10 per million tokens
// - GPT-4o mini: $0.15/$0.60 per million tokens

