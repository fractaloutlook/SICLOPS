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

    resetTurnsForNewCycle(): void {
        this.state.timesProcessed = 0;
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

        // More informative console output
        let consoleMessage = message;
        if (message === 'State updated' && data) {
            consoleMessage = `Turn ${data.timesProcessed}/6 | Cost $${data.totalCost.toFixed(4)}`;
        } else if (message === 'Processed file' && data) {
            // First print the summary of what they said
            const summary = this.extractMiniSummary(data);
            if (summary) {
                console.log(`[${timestamp.toISOString()}] ${this.config.name}: ${summary}`);
            }

            // Then print the action (who they're passing to)
            const hasFileOps = data.fileRead || data.fileEdit || data.fileWrite;
            const fileOpType = data.fileRead ? '📖 READ' : data.fileEdit ? '✏️ EDIT' : data.fileWrite ? '📝 WRITE' : '';
            const consensus = data.consensus ? ` | ${data.consensus}` : '';
            consoleMessage = hasFileOps ? `${fileOpType} → ${data.target}${consensus}` : `💬 → ${data.target}${consensus}`;
        }

        console.log(`[${timestamp.toISOString()}] ${this.config.name}: ${consoleMessage}`);
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

    /**
     * Extract a mini-summary from agent's response for console display.
     * Tries to get first meaningful sentence, max 80 chars.
     */
    private extractMiniSummary(data: any): string | null {
        // Try notes first (usually has the main point)
        if (data.notes && typeof data.notes === 'string' && data.notes.length > 15) {
            return this.truncateSummary(data.notes);
        }

        // Try reasoning
        if (data.reasoning && typeof data.reasoning === 'string' && data.reasoning.length > 15) {
            return this.truncateSummary(data.reasoning);
        }

        // Try changes.description
        if (data.changes?.description && typeof data.changes.description === 'string' && data.changes.description.length > 15) {
            return this.truncateSummary(data.changes.description);
        }

        return null;
    }

    private truncateSummary(text: string): string {
        // Remove markdown, excessive whitespace, newlines
        let cleaned = text
            .replace(/[*_`#]/g, '')
            .replace(/\n+/g, ' ')
            .trim();

        // Get first sentence or first 80 chars
        const firstSentence = cleaned.split(/[.!?]\s/)[0];
        const truncated = firstSentence.substring(0, 80);

        // Add ellipsis if truncated
        return truncated.length < firstSentence.length ? truncated + '...' : truncated;
    }

    private async initializeLogFile(): Promise<void> {
        await FileUtils.initializeLogFile(this.logPath);
    }
}
