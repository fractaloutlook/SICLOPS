/**
 * Git Auto-Commit - Automatically commit successful code changes
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitResult {
    success: boolean;
    commitHash?: string;
    message: string;
}

/**
 * Check if we're in a git repository
 */
async function isGitRepo(): Promise<boolean> {
    try {
        await execAsync('git rev-parse --git-dir');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if there are any changes to commit
 */
async function hasChanges(): Promise<boolean> {
    try {
        const { stdout } = await execAsync('git status --porcelain');
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Auto-commit code changes after a successful cycle
 */
export async function autoCommitCycle(
    cycleNumber: number,
    filesChanged: string[],
    summary: string
): Promise<CommitResult> {
    // Check if git is available
    if (!(await isGitRepo())) {
        return {
            success: false,
            message: 'Not a git repository - skipping auto-commit'
        };
    }

    // Check if there are changes
    if (!(await hasChanges())) {
        return {
            success: true,
            message: 'No changes to commit'
        };
    }

    try {
        // Stage all changes
        await execAsync('git add .');

        // Create commit message
        const commitMsg = `🤖 Cycle ${cycleNumber}: ${summary}

Files changed:
${filesChanged.map(f => `- ${f}`).join('\n')}

Auto-committed by SICLOPS multi-agent system`;

        // Commit
        const { stdout } = await execAsync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

        // Get commit hash
        const { stdout: hash } = await execAsync('git rev-parse --short HEAD');

        return {
            success: true,
            commitHash: hash.trim(),
            message: `Committed as ${hash.trim()}`
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Commit failed: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Extract list of files changed from project history
 */
export function extractChangedFiles(history: any[]): string[] {
    const files = new Set<string>();

    for (const entry of history) {
        if (entry.action === 'file_write_success' ||
            entry.action === 'file_edit_success') {
            files.add(entry.changes.location);
        }
    }

    return Array.from(files);
}

/**
 * Generate a brief summary of what was accomplished
 */
export function generateCycleSummary(history: any[]): string {
    const writes = history.filter(e => e.action === 'file_write_success').length;
    const edits = history.filter(e => e.action === 'file_edit_success').length;
    const reads = history.filter(e => e.action === 'file_read_success').length;

    const parts: string[] = [];
    if (writes > 0) parts.push(`${writes} file${writes > 1 ? 's' : ''} created`);
    if (edits > 0) parts.push(`${edits} file${edits > 1 ? 's' : ''} edited`);
    if (reads > 0) parts.push(`${reads} file${reads > 1 ? 's' : ''} read`);

    return parts.join(', ') || 'No changes';
}
