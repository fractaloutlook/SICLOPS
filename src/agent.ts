import { BaseAgent, AgentState } from './agent-base';
import { AgentConfig, ProcessResult, ProjectFile, FileWriteRequest, FileReadRequest, FileEditRequest } from './types';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'; // Import Google Generative AI
import { FileUtils } from './utils/file-utils';
import { retryWithBackoff } from './utils/error-recovery';
import { MODEL_COSTS, GEMINI_RATE_LIMIT_DELAY } from './config';

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
    returnForFix?: boolean;
}

export class Agent extends BaseAgent {
    private readonly apiClient: Anthropic | OpenAI | GoogleGenerativeAI;

    constructor(
        config: AgentConfig,
        logDirectory: string,
        apiClient: Anthropic | OpenAI | GoogleGenerativeAI
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
        // First, check if there's a ```json code block
        const jsonBlockMatch = response.match(/```json\s*\n([\s\S]*?)\n```/);
        if (jsonBlockMatch) {
            // Extract JSON from the code block
            response = jsonBlockMatch[1].trim();
        } else {
            // Remove any markdown code blocks that might be in explanations
            response = response.replace(/```typescript[\s\S]*?```/g, '') // Remove TypeScript blocks
                .replace(/```javascript[\s\S]*?```/g, '') // Remove JavaScript blocks
                .replace(/```[\s\S]*?```/g, ''); // Remove other code blocks
        }

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
        // Look for first { that's followed by a quote (JSON property name)
        let firstBrace = -1;
        for (let i = 0; i < response.length - 1; i++) {
            if (response[i] === '{') {
                // Check if next non-whitespace char is a quote (JSON property)
                let j = i + 1;
                while (j < response.length && /\s/.test(response[j])) j++;
                if (j < response.length && response[j] === '"') {
                    firstBrace = i;
                    break;
                }
            }
        }

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
        availableTargets: string[],
        summarizedOrchestratorHistory: string // New parameter for summarized history
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
            let response: ApiResponse = {} as ApiResponse; // Initialize response
            let tokens: { input: number; output: number; cacheWrite?: number; cacheRead?: number } = { input: 0, output: 0 }; // Initialize tokens
            let cost: number = 0; // Initialize cost

            // Use the provided summarized history instead of mapping the entire file.history
            const conversationHistoryForPrompt = summarizedOrchestratorHistory.length > 0
                ? `SUMMARIZED CONVERSATION SO FAR:\n${summarizedOrchestratorHistory}\n\n`
                : "You're first to speak.";

            const isConversation = file.content.includes('TEAM DISCUSSION');
            const requireConsensus = file.content.includes('Reach consensus');

            // 1. Construct STATIC System Prompt (Cached)
            // Includes Identity, Architecture, Workflow, Format
            const systemPrompt = `You are ${this.config.name}. skip_intro: true. ${this.config.personality}
            DO NOT introduce yourself in every message. We know who you are.
Your focus: ${this.config.taskFocus}

🏗️ WHAT YOU'RE BUILDING:
You're working on YOUR OWN multi-agent framework called SICLOPS (Self-Improving Collective).
This is self-improvement work - you ARE the product.

**Your System Architecture:**
- 5 specialized agents (you and 4 colleagues) working in a fixed workflow sequence
- Orchestrator (src/orchestrator.ts) coordinates your turns and handles file operations
- Each agent gets up to 30 turns per cycle (extended for collaboration)
- You can self-pass up to 3 times for multi-step work within a cycle
- All code changes are validated with TypeScript compilation before being saved

**Your Current Capabilities:**
- fileRead: Request to read any file (orchestrator provides content in your next turn)
  \`\`\`json
  {
    "fileRead": {
      "filePath": "REQUIRED: e.g., 'notes/${this.config.name.toLowerCase()}-notes.md'",
      "reason": "REQUIRED: Brief explanation why you need to read this file"
    },
    "targetAgent": "REQUIRED: Next agent or yourself",
    "reasoning": "REQUIRED: Why you're making this request and who should act next"
  }
  \`\`\`
- fileEdit: Make surgical line-by-line edits.
  \`\`\`json
  {
      "fileEdit": {
          "filePath": "src/example.ts",
          "reason": "Fixing typo",
          "edits": [
              { "find": "old code", "replace": "new code" }
          ]
      },
      "targetAgent": "Self/Next",
      "reasoning": "..."
  }
  \`\`\`
- fileWrite: Create brand new files (not for editing existing ones)
- Notebooks: Each agent has notes/*.md files to track observations across runs

**What You've Already Built:**
- SharedMemoryCache (src/memory/shared-cache.ts) - A 3-bucket LRU cache for sharing context
- State persistence (data/state/orchestrator-context.json) - Costs and progress saved across runs
- Agent notebooks system (notes/*.md) - For tracking ideas and reducing scope creep
- File operation infrastructure - Read/edit/write with validation

**Your Role in the Team:**
You're ${this.config.name} (${this.config.role}). ${this.config.personality}
Your focus: ${this.config.taskFocus}

**How Your System Runs:**
Your system is designed to run continuously in cycles, alternating between two stages:
1. **Discussion/Consensus Stage:** Decide what to implement next as a team
2. **Implementation Stage:** Write the code for what you decided

The code you're improving IS the framework you're running within. After each cycle, your changes are compiled into the framework before the next cycle runs. You're literally rebuilding yourself as you work.

**Important Context:**
- This is early POC - bugs and rough edges are expected
- Focus on getting features working first, robustness later
- No external users yet - you're building infrastructure for yourselves
- All 5 agents are Claude Sonnet 4.5 models (~$0.15-0.20 per cycle)
- You're improving your own ability to collaborate and maintain context

📓 YOUR NOTEBOOK: notes/${this.config.name.toLowerCase()}-notes.md
- Read it ONLY if you strictly need to refresh your memory (don't read every turn)
- Update it (fileEdit) with new learnings before passing on
- Log non-MVP ideas there instead of implementing them
- Review suggestions from other agents in their notebooks

📖 HOW FILE READING WORKS (SYNCHRONOUS):
File reading happens WITHIN your turn. You can request multiple files and they'll all be provided before you respond.
Example workflow:
1. Request fileRead for jordan-notes.md → Orchestrator immediately provides content
2. Process content, request fileRead for orchestrator.ts → Orchestrator immediately provides content
3. Process both files, make fileEdit with your changes → Pass to next agent
All of this happens in ONE turn! No self-passing needed for file reads.
Look for "📖 File content from..." in the File history section - it appears immediately after you request it.

⚠️ CRITICAL: EVERY TURN MUST PRODUCE ACTION
DO NOT just read files and pass without doing something productive!

**Required: After reading files, you MUST:**
- Make code changes (fileEdit or fileWrite), OR
- Update your notebook with observations (fileEdit on notes/*.md), OR
- Pass with explicit reasoning why NO action is needed this turn

**FORBIDDEN:**
❌ Reading files → passing → reading same files again → passing (INFINITE LOOP!)
❌ Self-passing more than once without making file changes
❌ Reading notebooks but not updating them with new information
❌ Saying "waiting for X" when YOU could do the work yourself

**Cost awareness:** Each turn costs ~$0.50-0.70. Make it count!

🔄 WHEN TO SELF-PASS:
- Use self-passing ONLY if you need to wait for fileEdit/fileWrite results to be validated
- For just reading files: NO self-pass needed (happens within same turn)
- Max 3 self-passes if you need multiple edit/write cycles

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
    "notes": "Additional context or considerations",
    "returnForFix": false, // OPTIONAL: Set to true to pass BACKWARDS for immediate bug fix (use sparingly!)
    ${requireConsensus ? '"consensus": "agree | building | disagree"' : ''}
}`;

            // 2. Construct DYNAMIC User Prompt (Uncached - changes every turn)
            const userPrompt = isConversation ?
                `DISCUSSION CONTEXT:
                ${file.content}

                ${conversationHistoryForPrompt}

                AVAILABLE team members (ONLY choose from this list): ${availableTargets.join(', ')}

                Your turn to contribute to the discussion!
                This is a DISCUSSION, not implementation. Share ideas, ${requireConsensus ? 'debate, challenge assumptions, point out flaws' : 'build on each other\'s ideas, work collaboratively'}.
                Remember to use fileRead on your notebook (notes/${this.config.name.toLowerCase()}-notes.md) ONLY if you need deep history (summarized context is usually enough).
                
                ${requireConsensus ? `CONSENSUS MECHANISM: Signal if you think the team has reached agreement and is ready to conclude:
                - "agree" = You think we've reached consensus and can move forward
                - "building" = Discussion is productive but not ready to conclude
                - "disagree" = Significant concerns remain, need more discussion

                Discussion concludes when 4 out of 5 team members signal "agree".` : `WORKFLOW: Each agent contributes their perspective, then passes to the next agent. Work through all team members sequentially.`}

                Respond with JSON.`
                :
                `Current file/Context:
                ${file.content}

                ${conversationHistoryForPrompt}

                Available team members to pass to: ${availableTargets.join(', ')}

                Based on your role and focus:
                1. Review the current state
                2. Make any necessary changes OR log them in your notebook if not MVP-critical
                3. Choose a team member to pass this to (can be yourself for multi-step work)
                Remember to use fileRead on your notebook (notes/${this.config.name.toLowerCase()}-notes.md) ONLY if you need deep history (summarized context is usually enough).

                ${file.content.includes('Current Task: Complete SharedMemoryCache Integration') ? `
                **Current Task: Complete SharedMemoryCache Integration**
                The cache exists but isn't connected to the orchestrator yet. You need to:
                1. Import SharedMemoryCache in orchestrator.ts
                2. Initialize it in the constructor
                3. Load cached decisions in loadContext()
                4. Store new decisions in updateContextAtEnd()
                ` : ''}

                **RETURN FOR FIX:**
                If you find a critical bug/issue that needs immediate fixing:
                - Set "returnForFix": true
                - Set "targetAgent" to who should fix it (usually the agent who wrote the code)
                - Explain the issue clearly in "reasoning"
                Example: Sam finds bug in Morgan's code → returnForFix=true, targetAgent="Morgan"
                After fix, workflow resumes normally from where it left off.
                
                Respond with JSON.`;

            if (this.apiClient instanceof Anthropic) {
                const anthropicClient = this.apiClient as Anthropic;

                // Log prompt size for debugging
                console.log(`   📊 Prompt size: System=${systemPrompt.length}, User=${userPrompt.length} chars`);

                // Show full prompt if environment variable is set
                if (process.env.SHOW_AGENT_PROMPTS === 'true') {
                    console.log(`\n${'='.repeat(80)}`);
                    console.log(`📝 PROMPT TO ${this.config.name.toUpperCase()}:`);
                    console.log(`${'='.repeat(80)}`);
                    console.log(`[SYSTEM PROMPT - CACHED]\n${systemPrompt}\n`);
                    console.log(`[USER PROMPT]\n${userPrompt}`);
                    console.log(`${'='.repeat(80)}\n`);
                }

                // Wrap API call with timeout
                const apiCallWithTimeout = () => {
                    return Promise.race([
                        anthropicClient.beta.promptCaching.messages.create({
                            model: this.config.model,
                            max_tokens: 8192,
                            system: [{
                                type: 'text',
                                text: systemPrompt,
                                cache_control: { type: 'ephemeral' } // Cache the static system prompt
                            }],
                            messages: [{
                                role: 'user',
                                content: userPrompt
                            }]
                        }),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error('API call timeout after 120s')), 120000)
                        )
                    ]);
                };

                const apiResponse = await retryWithBackoff(
                    apiCallWithTimeout as any, // Cast to any because wrapper type inference can be tricky
                    { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 },
                    `${this.config.name} API call`
                ) as any;

                if (!apiResponse.usage) {
                    throw new Error('No usage data in response');
                }

                // Extract granular usage stats for accurate costing
                const usage = apiResponse.usage as any;
                tokens = {
                    input: usage.input_tokens,
                    output: usage.output_tokens,
                    cacheWrite: usage.cache_creation_input_tokens || 0,
                    cacheRead: usage.cache_read_input_tokens || 0
                };

                cost = this.calculateClaudeCost(tokens);

                const textContent = apiResponse.content.find((block: any) => block.type === 'text');
                if (!textContent || !('text' in textContent)) {
                    throw new Error('No text content in response');
                }

                const cleanedText = this.cleanJsonResponse(textContent.text);
                try {
                    response = JSON.parse(cleanedText) as ApiResponse;
                } catch (parseError) {
                    await this.log('JSON parse error - raw response:', {
                        rawResponse: textContent.text,
                        cleanedResponse: cleanedText,
                        error: parseError instanceof Error ? parseError.message : 'Unknown error'
                    });
                    throw parseError;
                }

                // Log cache hit/miss for debugging
                if (tokens.cacheRead && tokens.cacheRead > 0) {
                    console.log(`   ⚡ Cache HIT! Read ${tokens.cacheRead} tokens (Saved $${((tokens.cacheRead / 1000000) * (3.00 - 0.30)).toFixed(4)})`);
                } else if (tokens.cacheWrite && tokens.cacheWrite > 0) {
                    console.log(`   💾 Cache WRITE! Wrote ${tokens.cacheWrite} tokens`);
                }

            } else if (this.apiClient instanceof GoogleGenerativeAI) {
                const googleClient = this.apiClient as GoogleGenerativeAI;
                const model = googleClient.getGenerativeModel({ model: this.config.model });

                // Gemini API handles system instructions via startChat system instruction parameter
                // or prepended to the first message. For simplicity, we'll prepend for now.
                const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

                try {
                    const apiResponse = await retryWithBackoff(
                        () => model.generateContent({
                            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
                        }),
                        { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 },
                        `${this.config.name} API call`
                    );

                    const geminiResponse = apiResponse.response;
                    const textContent = geminiResponse.text();

                    if (!geminiResponse.usageMetadata) {
                        // Some Gemini models/responses might not have usage data, warn but don't crash
                        console.warn('⚠️ No usage metadata in Gemini response (using estimates)');
                    }

                    tokens = {
                        input: geminiResponse.usageMetadata?.promptTokenCount || fullPrompt.length / 4, // Estimate if missing
                        output: geminiResponse.usageMetadata?.candidatesTokenCount || textContent.length / 4,
                        cacheWrite: 0,
                        cacheRead: 0
                    };

                    cost = this.calculateGeminiCost(tokens.input, tokens.output);
                    response = JSON.parse(this.cleanJsonResponse(textContent)) as ApiResponse;

                    // Throttling for Free Tier (15 RPM limit)
                    if (GEMINI_RATE_LIMIT_DELAY > 0) {
                        console.log(`   ⏳ Throttling Gemini request for ${GEMINI_RATE_LIMIT_DELAY}ms (Free Tier limit)...`);
                        await new Promise(resolve => setTimeout(resolve, GEMINI_RATE_LIMIT_DELAY));
                    }
                } catch (error: any) {
                    if (error.message && (error.message.includes('404') || error.message.includes('not found') || error.message.includes('not supported'))) {
                        throw new Error(`Invalid Gemini model "${this.config.model}" - please check src/config.ts. Original error: ${error.message}`);
                    }
                    throw error;
                }
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
                this.state.consecutiveSelfPasses = 0;
            }

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

            if (response.fileRead) this.trackFileRead();
            if (response.fileEdit) this.trackFileEdit();
            if (response.fileWrite) this.trackFileWrite();

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
                returnForFix: response.returnForFix,
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

    private calculateClaudeCost(tokens: { input: number; output: number; cacheWrite?: number; cacheRead?: number }): number {
        const inputStandard = tokens.input || 0;
        const output = tokens.output || 0;
        const cacheWrite = tokens.cacheWrite || 0;
        const cacheRead = tokens.cacheRead || 0;

        if (this.config.model.includes('haiku')) {
            return (inputStandard * (MODEL_COSTS.claude.haiku.input / 1000000)) +
                (output * (MODEL_COSTS.claude.haiku.output / 1000000));
        }
        if (this.config.model.includes('opus')) {
            return (inputStandard * (MODEL_COSTS.claude.opus.input / 1000000)) +
                (output * (MODEL_COSTS.claude.opus.output / 1000000));
        }

        // Sonnet 3.5 Pricing with Caching
        // Standard Input: $3.00 / 1M
        // Cache Write: $3.75 / 1M
        // Cache Read: $0.30 / 1M
        // Output: $15.00 / 1M

        const costStandard = inputStandard * (MODEL_COSTS.claude.sonnet.input / 1000000);
        const costOutput = output * (MODEL_COSTS.claude.sonnet.output / 1000000);
        const costCacheWrite = cacheWrite * 3.75 / 1000000;
        const costCacheRead = cacheRead * 0.30 / 1000000;

        return costStandard + costOutput + costCacheWrite + costCacheRead;
    }

    private calculateOpenAICost(inputTokens: number, outputTokens: number): number {
        if (this.config.model.includes('gpt-4o-mini')) {
            return (inputTokens * (MODEL_COSTS.openai.gpt4o_mini.input / 1000000)) +
                (outputTokens * (MODEL_COSTS.openai.gpt4o_mini.output / 1000000));
        }
        // Default to GPT-4o
        return (inputTokens * (MODEL_COSTS.openai.gpt4o.input / 1000000)) +
            (outputTokens * (MODEL_COSTS.openai.gpt4o.output / 1000000));
    }

    private calculateGeminiCost(inputTokens: number, outputTokens: number): number {
        const modelName = this.config.model;
        const geminiModelConfig = MODEL_COSTS.gemini[modelName as keyof typeof MODEL_COSTS.gemini]; // Type assertion
        if (geminiModelConfig) {
            return (inputTokens * (geminiModelConfig.input / 1000000)) +
                (outputTokens * (geminiModelConfig.output / 1000000));
        }
        console.warn(`[Agent] Unknown Gemini model "${modelName}" for cost calculation. Using default.`);
        // Fallback to a default if model not found in config
        return (inputTokens * (MODEL_COSTS.gemini['gemini-1.5-pro'].input / 1000000)) +
            (outputTokens * (MODEL_COSTS.gemini['gemini-1.5-pro'].output / 1000000));
    }
}

