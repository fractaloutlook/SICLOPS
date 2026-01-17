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

export interface ConversationResponse {
    thinking: string;      // Private reasoning before speaking
    notesOnOthers?: Record<string, string>;  // Quick reactions to others
    response: string;      // Public statement to the team
    referencingAgents?: string[];  // Who they're responding to
    consensusSignal: 'agree' | 'building' | 'concerned';  // Consensus state
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
    changes?: Changes;  // Optional for conversation mode
    fileRead?: FileReadRequest;  // Agent can request to read a file
    fileEdit?: FileEditRequest;  // Agent can request surgical edits to existing file
    fileWrite?: FileWriteRequest;  // Agent can request to write entire file (new files only)
    reasoning: string;
    notes?: string;  // Additional context from agent
    consensus?: 'agree' | 'building' | 'disagree';  // Consensus signal
    conversation?: ConversationResponse;  // For conversation mode
    returnForFix?: boolean;  // Signal to pass backwards for immediate bug fix (use sparingly!)
    cost: number;
    tokens: {
        input: number;
        output: number;
    };
}

export interface FileReadRequest {
    action: 'read_file';
    filePath: string;
    reason: string;
}

export interface FileEditRequest {
    action: 'edit_file';
    filePath: string;
    edits: Array<{
        // Pattern matching approach (like Claude Code)
        // Find a unique string in the file and replace it
        find: string;     // Exact string to find (must be unique in file)
        replace: string;  // What to replace it with
    }>;
    reason: string;
}

export interface FileWriteRequest {
    action: 'write_file';
    filePath: string;
    content: string;
    reason: string;
}

export interface CodeChange {
    file: string;
    action: 'create' | 'edit' | 'delete';
    content: string;
    appliedAt: string | null;
    validatedAt: string | null;
    status: 'pending' | 'applied' | 'validated' | 'failed';
    validationError?: string;
}

export interface OrchestratorContext {
    version: string;
    runNumber: number;
    startedAt: string;
    lastUpdated: string;
    currentPhase: 'discussion' | 'code_review' | 'apply_changes' | 'testing';
    discussionSummary: {
        topic: string;
        keyDecisions: string[];
        consensusReached: boolean;
        consensusSignals: Record<string, string>;
    };
    codeChanges: CodeChange[];
    agentStates: Record<string, {
        timesProcessed: number;
        totalCost: number;
        canProcess: boolean;
    }>;
    nextAction: {
        type: 'continue_discussion' | 'apply_changes' | 'restart_with_new_code' | 'manual_review';
        reason: string;
        targetAgent?: string;
    };
    history: Array<{
        runNumber: number;
        phase: string;
        summary: string;
        cost: number;
        timestamp: string;
    }>;
    summarizedHistory: string; // Add this line
    totalCost: number;
    humanNotes: string;
}
