/**
 * Task Completion Detection
 * Determines if agents have successfully completed their current task
 */

import { ProjectFile } from '../types';

export interface TaskCompletionResult {
    isComplete: boolean;
    reason: string;
    confidence: number; // 0-1
}

export function detectTaskCompletion(
    projectFile: ProjectFile,
    cycleCount: number
): TaskCompletionResult {
    const history = projectFile.history;
    const recentHistory = history.slice(-10); // Last 10 actions

    // Check for explicit completion signals
    const completionKeywords = [
        'task complete',
        'integration complete',
        'successfully integrated',
        'verified working',
        'tests passing',
        'ready to use',
        'implementation finished'
    ];

    let completionSignals = 0;
    for (const entry of recentHistory) {
        const text = (entry.notes + entry.changes.description).toLowerCase();
        if (completionKeywords.some(kw => text.includes(kw))) {
            completionSignals++;
        }
    }

    // Check if agents are just passing without doing work
    const lastFiveActions = history.slice(-5);
    const hasFileOperations = lastFiveActions.some(entry =>
        entry.action === 'file_write_success' ||
        entry.action === 'file_edit_success'
    );

    // If no file operations in last 5 actions and multiple completion signals
    if (!hasFileOperations && completionSignals >= 2) {
        return {
            isComplete: true,
            reason: `Agents signaled completion ${completionSignals} times with no new code changes`,
            confidence: 0.8
        };
    }

    // Check if agents are stuck in a loop (same errors repeating)
    const recentErrors = recentHistory
        .filter(e => e.action.includes('failed'))
        .map(e => e.notes);

    if (recentErrors.length >= 3) {
        const sameError = recentErrors.slice(-3).every(err => err === recentErrors[recentErrors.length - 1]);
        if (sameError) {
            return {
                isComplete: true,
                reason: 'Agents stuck in error loop - manual intervention needed',
                confidence: 0.9
            };
        }
    }

    // Check for successful compilation after file changes
    const hasSuccessfulChanges = recentHistory.some(e =>
        e.action === 'file_write_success' || e.action === 'file_edit_success'
    );

    const hasRecentDiscussion = recentHistory.some(e =>
        e.notes.includes('looks good') ||
        e.notes.includes('verified') ||
        e.notes.includes('tested')
    );

    if (hasSuccessfulChanges && hasRecentDiscussion && completionSignals >= 1) {
        return {
            isComplete: true,
            reason: 'Code changes successful and verified by team',
            confidence: 0.7
        };
    }

    // If we've gone 3+ cycles with no progress, consider stopping
    if (cycleCount >= 3 && !hasFileOperations) {
        return {
            isComplete: true,
            reason: `${cycleCount} cycles with no code changes - likely complete or stuck`,
            confidence: 0.6
        };
    }

    return {
        isComplete: false,
        reason: 'Task still in progress',
        confidence: 0.0
    };
}

export function shouldContinueNextCycle(
    completionResult: TaskCompletionResult,
    maxCycles: number,
    currentCycle: number
): boolean {
    // Always stop at max cycles
    if (currentCycle >= maxCycles) {
        return false;
    }

    // Stop if high confidence completion
    if (completionResult.isComplete && completionResult.confidence >= 0.7) {
        return false;
    }

    // Continue if task not complete
    return !completionResult.isComplete;
}
