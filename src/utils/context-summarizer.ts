/**
 * Context Summarization - Prevent unbounded growth of orchestrator-context.json
 */

import { OrchestratorContext } from '../types';

const MAX_HISTORY_ENTRIES = 20; // Keep last 20 cycles in detail
const MAX_KEY_DECISIONS = 15;   // Keep last 15 key decisions

/**
 * Summarize old history entries to prevent context bloat
 */
export function summarizeContext(context: OrchestratorContext): OrchestratorContext {
    const summarized = { ...context };

    // Trim history if too long
    if (summarized.history.length > MAX_HISTORY_ENTRIES) {
        const toRemove = summarized.history.length - MAX_HISTORY_ENTRIES;
        const oldEntries = summarized.history.slice(0, toRemove);
        const recentEntries = summarized.history.slice(toRemove);

        // Create summary of removed entries
        const oldSummary = {
            runNumber: 0,
            phase: 'archived',
            summary: `[Archived ${toRemove} old cycle(s): runs ${oldEntries[0]?.runNumber}-${oldEntries[oldEntries.length - 1]?.runNumber}]`,
            cost: oldEntries.reduce((sum, e) => sum + (e.cost || 0), 0),
            timestamp: oldEntries[0]?.timestamp || new Date().toISOString()
        };

        summarized.history = [oldSummary, ...recentEntries];
    }

    // Trim key decisions if too many
    if (summarized.discussionSummary.keyDecisions.length > MAX_KEY_DECISIONS) {
        summarized.discussionSummary.keyDecisions =
            summarized.discussionSummary.keyDecisions.slice(-MAX_KEY_DECISIONS);
    }

    // CRITICAL: Prevent token burn by pruning codeChanges content
    // Keep last 10 changes, and truncate their content
    if (summarized.codeChanges && summarized.codeChanges.length > 0) {
        // Keep last 10 changes
        const MAX_CODE_CHANGES = 10;
        if (summarized.codeChanges.length > MAX_CODE_CHANGES) {
            summarized.codeChanges = summarized.codeChanges.slice(-MAX_CODE_CHANGES);
        }

        // Truncate content of remaining changes
        summarized.codeChanges = summarized.codeChanges.map(change => ({
            ...change,
            content: change.content.length > 500
                ? change.content.substring(0, 500) + '\n... (truncated for context size)'
                : change.content
        }));
    }

    return summarized;
}

/**
 * Estimate context size in tokens (rough approximation)
 */
export function estimateContextTokens(context: OrchestratorContext): number {
    const jsonString = JSON.stringify(context);
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(jsonString.length / 4);
}

/**
 * Check if context needs summarization
 */
export function needsSummarization(context: OrchestratorContext): boolean {
    return context.history.length > MAX_HISTORY_ENTRIES ||
        context.discussionSummary.keyDecisions.length > MAX_KEY_DECISIONS;
}

/**
 * Get context health metrics
 */
export function getContextHealth(context: OrchestratorContext): {
    historySize: number;
    decisionsSize: number;
    estimatedTokens: number;
    needsSummarization: boolean;
} {
    return {
        historySize: context.history.length,
        decisionsSize: context.discussionSummary.keyDecisions.length,
        estimatedTokens: estimateContextTokens(context),
        needsSummarization: needsSummarization(context)
    };
}
