import { BaseAgent, AgentState, ProcessResult } from './agent-base';
import { AgentConfig } from './types';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { FileUtils } from './utils/file-utils';

interface ApiResponse {
    newValue: number;
    chosenTarget: string;
    reasoning: string;
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
    }

    getState(): AgentState {
        return { ...this.state };
    }
    
    getName(): string {
        return this.config.name;
    }

    getModel(): string {
        return this.config.model;
    }

    async processValue(
        value: number,
        availableTargets: string[]
    ): Promise<ProcessResult> {
        if (!this.canProcess()) {
            await this.log('Refusing processing - limit reached', {
                timesProcessed: this.state.timesProcessed,
                value
            });
            return {
                value,
                accepted: false,
                reason: 'Processing limit reached',
                cost: 0,
                tokens: { input: 0, output: 0 }
            };
        }

        const targetChoices = availableTargets
            .map(t => `"${t}"`)
            .join(', ');

        try {
            let response: ApiResponse;
            let tokens: { input: number; output: number };
            let cost: number;

            if (this.apiClient instanceof Anthropic) {
                const apiResponse = await this.apiClient.messages.create({
                    model: this.config.model,
                    max_tokens: 150,
                    messages: [{
                        role: 'user',
                        content: `You are ${this.config.name}. ${this.config.personality}
                                Current value: ${value}
                                Available targets to pass to: ${targetChoices}
                                
                                1. Add 1 to the value
                                2. Choose one target randomly from the available list
                                
                                Respond in JSON format only:
                                {
                                    "newValue": number,
                                    "chosenTarget": string,
                                    "reasoning": string
                                }`
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
                
                response = JSON.parse(textContent.text) as ApiResponse;
                
            } else {
                const apiResponse = await (this.apiClient as OpenAI).chat.completions.create({
                    model: this.config.model,
                    messages: [{
                        role: 'system',
                        content: `You are ${this.config.name}. ${this.config.personality}`
                    }, {
                        role: 'user',
                        content: `Current value: ${value}
                                Available targets to pass to: ${targetChoices}
                                
                                1. Add 1 to the value
                                2. Choose one target randomly from the available list
                                
                                Respond in JSON format only:
                                {
                                    "newValue": number,
                                    "chosenTarget": string,
                                    "reasoning": string
                                }`
                    }]
                });

                // Safe checks for OpenAI response
                if (!apiResponse.usage || !apiResponse.choices[0]?.message?.content) {
                    throw new Error('Invalid API response structure');
                }

                tokens = {
                    input: apiResponse.usage.prompt_tokens,
                    output: apiResponse.usage.completion_tokens
                };
                
                cost = this.calculateOpenAICost(tokens.input, tokens.output);

                const content = apiResponse.choices[0].message.content;
                response = JSON.parse(content) as ApiResponse;
            }

            await this.updateState('process_value', tokens.input, tokens.output, cost);
            
            // Log the full context of what's happening
            await this.log('Processed value', {
                input: value,
                output: response.newValue,
                target: response.chosenTarget,
                reasoning: response.reasoning,
                availableTargets
            });

            return {
                value: response.newValue,
                accepted: true,
                targetAgent: response.chosenTarget,
                cost,
                tokens
            };

        } catch (error) {
            await this.log('Error processing value', {
                error: error instanceof Error ? error.message : 'Unknown error',
                value,
                availableTargets
            });
            throw error;
        }
    }

    private calculateClaudeCost(inputTokens: number, outputTokens: number): number {
        // Claude-3.5 prices (adjust as needed)
        if (this.config.model.includes('claude-3-haiku')) {
            return (inputTokens * 0.000003/*0.000000015*/) + (outputTokens * 0.000003/*0.000000055*/);
        }
        // Claude-3.5 Sonnet prices
        return (inputTokens * 0.000003/*0.000000025*/) + (outputTokens * 0.000003/*0.000000075*/);
    }

    private calculateOpenAICost(inputTokens: number, outputTokens: number): number {
        // GPT-4o-mini pricing (adjust as needed)

        // gpt-4o-mini
        // $0.150 / 1M input tokens
        // $0.075 / 1M input tokens with Batch API
        // $0.075 / 1M cached** input tokens
        // $0.600 / 1M output tokens
        // $0.300 / 1M output tokens with Batch API

        // 0.00000015 in 0.0000006 out
        return (inputTokens * 0.00000015) + (outputTokens * 0.0000006);
    }
}


/*

Claude 3.5 Sonnet

$3 / MTok
Input

$3.75 / MTok
Prompt caching write

$0.30 / MTok
Prompt caching read

$15 / MTok
Output

/////////////////////////////////////////////////////////////

Claude 3.5 Haiku

$1 / MTok
Input

$1.25 / MTok
Prompt caching write

$0.10 / MTok
Prompt caching read

$5 / MTok
Output

/////////////////////////////////////////////////////////////

Claude 3 Opus
Powerful model for complex tasks
200K context window
50% discount with the Batches API*

$15 / MTok
Input

$18.75 / MTok
Prompt caching write

$1.50 / MTok
Prompt caching read

$75 / MTok
Output

/////////////////////////////////////////////////////////////

Claude 3 Haiku

$0.25 / MTok
Input

$0.30 / MTok
Prompt caching write

$0.03 / MTok
Prompt caching read

$1.25 / MTok
Output

Claude 3 Sonnet
Balance of speed, cost, and performance
200K context window

$3 / MTok
Input

$15 / MTok
Output

*/