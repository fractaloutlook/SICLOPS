import { AgentConfig, ProcessResult, ProjectFile } from './types';
import { FileUtils } from './utils/file-utils';

export interface AgentState {
    timesProcessed: number;
    lastProcessedAt: Date;
    totalCost: number;
    totalTokensUsed: number;
    operations: {
        timestamp: Date;
        operation: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
    }[];
}

export abstract class BaseAgent {
    protected state: AgentState;
    protected logPath: string;
    
    constructor(
        public readonly config: AgentConfig,  // Changed from protected to public
        protected readonly logDirectory: string
    ) {
        this.state = {
            timesProcessed: 0,
            lastProcessedAt: new Date(),
            totalCost: 0,
            totalTokensUsed: 0,
            operations: []
        };
        
        this.logPath = `${logDirectory}/agents/${this.config.name.toLowerCase().replace(/\s+/g, '_')}.log`;
        this.initializeLogFile();
    }

    abstract processFile(file: ProjectFile, availableTargets: string[]): Promise<ProcessResult>;

    canProcess(): boolean {
        return this.state.timesProcessed < 6;  // Increased for conversation mode
    }

    restoreState(savedState: { timesProcessed: number; totalCost: number }): void {
        this.state.timesProcessed = savedState.timesProcessed;
        this.state.totalCost = savedState.totalCost;
    }

    protected async log(message: string, data?: any): Promise<void> {
        const timestamp = new Date();
        const logEntry = {
            timestamp: timestamp.toISOString(),
            agent: this.config.name,
            version: this.config.version,
            message,
            data
        };

        await FileUtils.appendToLog(this.logPath, logEntry);
        console.log(`[${timestamp.toISOString()}] ${this.config.name}: ${message}`);
    }

    protected async updateState(operation: string, inputTokens: number, outputTokens: number, cost: number): Promise<void> {
        const timestamp = new Date();
        this.state.timesProcessed++;
        this.state.lastProcessedAt = timestamp;
        this.state.totalCost += cost;
        this.state.totalTokensUsed += (inputTokens + outputTokens);
        this.state.operations.push({
            timestamp,
            operation,
            inputTokens,
            outputTokens,
            cost
        });

        await this.log('State updated', {
            timesProcessed: this.state.timesProcessed,
            totalCost: this.state.totalCost,
            operation
        });
    }

    private async initializeLogFile(): Promise<void> {
        await FileUtils.initializeLogFile(this.logPath);
    }
}
