import { BaseAgent, AgentState } from './agent-base';
import { AgentConfig, ProcessResult, ProjectFile, FileWriteRequest } from './types';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { FileUtils } from './utils/file-utils';

interface ApiResponse {
    changes: {
        description: string;
        code?: string;
        location?: string;
    };
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
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            response = jsonMatch[0];
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

            const prompt = isConversation ?
                `You are ${this.config.name}. ${this.config.personality}
                Your focus: ${this.config.taskFocus}

                DISCUSSION CONTEXT:
                ${file.content}

                CONVERSATION SO FAR:
                ${historyText || "You're first to speak."}

                AVAILABLE team members (ONLY choose from this list): ${availableTargets.join(', ')}

                Your turn to contribute to the discussion!

                IMPORTANT: This is a DISCUSSION, not implementation. Share ideas, debate, challenge assumptions, point out flaws. Reference other team members' points. Be direct - you don't need to praise everyone. Disagree when you disagree. DO NOT write implementation code - just talk about what you think should be built and why.

                CONSENSUS MECHANISM: Signal if you think the team has reached agreement and is ready to conclude:
                - "agree" = You think we've reached consensus and can move forward
                - "building" = Discussion is productive but not ready to conclude
                - "disagree" = Significant concerns remain, need more discussion

                Discussion concludes when 4 out of 5 team members signal "agree".

                Respond with ONLY a JSON object in this format:
                {
                    "changes": {
                        "description": "Your thoughts and contribution. Be direct. Challenge ideas when needed. Reference specific points others made. NO CODE - just discussion!",
                        "code": "",
                        "location": "discussion"
                    },
                    "targetAgent": "REQUIRED: Choose ONLY from available list above: ${availableTargets.join(', ')}",
                    "reasoning": "Brief note on who should speak next and why",
                    "notes": "Additional thoughts",
                    "consensus": "agree | building | disagree"
                }`
                :
                `You are ${this.config.name}. ${this.config.personality}
                Your focus: ${this.config.taskFocus}

                Current file:
                ${file.content}

                File history:
                ${historyText}

                Available team members to pass to: ${availableTargets.join(', ')}

                Based on your role and focus:
                1. Review the current state
                2. Make any necessary changes
                3. Choose a team member to pass this to

                You MUST respond with ONLY a valid JSON object. You MUST include actual implementation code in the "code" field, not just descriptions.
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
                    max_tokens: 4096,  // Increased for code generation
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
            
            // Validate target agent - if undefined or not in available list, pick first available
            let targetAgent = response.targetAgent;
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
                fileWrite: response.fileWrite
            });

            return {
                accepted: true,
                targetAgent: targetAgent,
                reasoning: response.reasoning,
                changes: response.changes,
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

