export interface AgentMessage {
    value: number;
    debug: string;
    metadata?: any;
}

export interface Changes {
    description: string;    // Their prose about what changed
    code?: string;         // Actual TypeScript code
    location?: string;     // File/class/method being modified
}

export interface ProjectFile {
    content: string;
    currentStage: string;
    history: {
        agent: string;
        timestamp: string;
        action: string;
        notes: string;
        changes: Changes;
        code?: string;      // typescript code
        location?: string;  // file or class location of changes
    }[];
}

export interface AgentConfig {
    name: string;
    role: string;
    model: string;
    personality: string;
    version: string;
    taskFocus: string;
}

// In types.ts, modify ProcessResult:
export interface ProcessResult {
    value?: number;
    targetAgent: string;
    accepted: boolean;
    changes: Changes;
    reasoning: string;
    cost: number;
    tokens: {
        input: number;
        output: number;
    };
}
