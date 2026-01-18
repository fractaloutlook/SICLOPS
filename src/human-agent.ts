import { BaseAgent, AgentState } from './agent-base';
import { AgentConfig, ProcessResult, ProjectFile } from './types';
import * as readline from 'readline';

export class HumanAgent extends BaseAgent {
    constructor(config: AgentConfig, logDirectory: string) {
        super(config, logDirectory);
        this.logPath = `${logDirectory}/agents/${new Date().toISOString().replace(/[:.]/g, '-')}_human.log`;
    }

    getName(): string {
        return this.config.name;
    }

    getModel(): string {
        return 'human';
    }

    getState(): AgentState {
        return { ...this.state };
    }

    async processFile(
        file: ProjectFile,
        availableTargets: string[],
        summarizedOrchestratorHistory: string
    ): Promise<ProcessResult> {
        console.log(`\n\n👤 IT'S YOUR TURN, ${this.config.name.toUpperCase()}!`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Current context has been logged to history.');
        console.log('Use JSON format if you want to perform file operations, or just type text to give detailed feedback.');
        console.log('Available targets:', availableTargets.join(', '));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const userInput = await this.promptUser('> ');

        // Try to parse as JSON first (power user mode)
        let response: any;
        try {
            response = JSON.parse(userInput);
        } catch (e: any) {
            // Treat as simple text feedback
            response = {
                targetAgent: availableTargets[0], // Default to first available
                reasoning: userInput,
                changes: {
                    description: "Human provided feedback",
                    code: undefined,
                    location: undefined
                },
                notes: userInput
            };
        }

        // Ensure target agent is valid
        if (!response.targetAgent || !availableTargets.includes(response.targetAgent)) {
            console.log(`⚠️  Target agent "${response.targetAgent}" invalid/missing. Defaulting to ${availableTargets[0]}`);
            response.targetAgent = availableTargets[0];
        }

        await this.log('Processed file (Human)', {
            input: userInput,
            parsed: response
        });

        // Track stats (free for humans)
        await this.updateState('process_file', 0, 0, 0);

        return {
            accepted: true,
            targetAgent: response.targetAgent,
            reasoning: response.reasoning,
            changes: response.changes,
            fileRead: response.fileRead,
            fileEdit: response.fileEdit,
            fileWrite: response.fileWrite,
            notes: response.notes,
            cost: 0,
            tokens: { input: 0, output: 0 }
        };
    }

    private promptUser(query: string): Promise<string> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question(query, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }
}
