import { BaseAgent, AgentState } from './agent-base';
import { AgentConfig, ProcessResult, ProjectFile } from './types';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { FileUtils } from './utils/file-utils';

interface ApiResponse {
    changes: {
        description: string;
        code?: string;
        location?: string;
    };
    targetAgent: string
    reasoning: string;
    notes: string;
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

    private cleanJsonResponse(response: string): string {
        // Remove markdown code blocks if present
        response = response.replace(/```json\n/g, '')
                          .replace(/```\n/g, '')
                          .replace(/```/g, '');
        // Clean up any leading/trailing whitespace
        response = response.trim();

        // Try to find JSON object boundaries and extract just the JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            response = jsonMatch[0];
        }

        return response;
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

                const prompt = `You are ${this.config.name}. ${this.config.personality}
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
            
            await this.log('Processed file', {
                stage: file.currentStage,
                changes: response.changes,
                target: response.targetAgent,
                reasoning: response.reasoning,
                notes: response.notes
            });

            return {
                accepted: true,
                targetAgent: response.targetAgent,
                reasoning: response.reasoning,
                changes: response.changes,
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
            // Claude 3.5 Haiku: $1/$5 per million tokens (2025 pricing)
            return (inputTokens * 0.000001) + (outputTokens * 0.000005);
        }
        // Claude 3.5 Sonnet: $3/$15 per million tokens (2025 pricing)
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
// - 3.5 Haiku: $1/$5 per million tokens
// - 3.5 Sonnet: $3/$15 per million tokens
// - Opus 4.5: $5/$25 per million tokens
//
// OpenAI:
// - GPT-4o: $2.50/$10 per million tokens
// - GPT-4o mini: $0.15/$0.60 per million tokens

