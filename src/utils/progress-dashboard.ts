/**
 * Progress Dashboard - Visual feedback during agent cycles
 */

import { ProjectFile } from '../types';

export interface CycleProgress {
    cycle: number;
    agentTurns: number;
    fileReads: number;
    fileEdits: number;
    fileWrites: number;
    errors: number;
    cost: number;
}

export function displayProgressDashboard(progress: CycleProgress): void {
    const width = 60;
    const bar = '━'.repeat(width);

    console.log(`\n┏${bar}┓`);
    console.log(`┃ 📊 CYCLE ${progress.cycle} PROGRESS${' '.repeat(width - 21)}┃`);
    console.log(`┣${bar}┫`);
    console.log(`┃ Agent Turns:    ${String(progress.agentTurns).padEnd(width - 18)} ┃`);
    console.log(`┃ File Reads:     ${String(progress.fileReads).padEnd(width - 18)} ┃`);
    console.log(`┃ File Edits:     ${String(progress.fileEdits).padEnd(width - 18)} ┃`);
    console.log(`┃ File Writes:    ${String(progress.fileWrites).padEnd(width - 18)} ┃`);
    console.log(`┃ Errors:         ${String(progress.errors).padEnd(width - 18)} ┃`);
    console.log(`┃ Cost This Cycle: $${progress.cost.toFixed(4).padEnd(width - 19)}┃`);
    console.log(`┗${bar}┛\n`);
}

export function extractProgressFromHistory(projectFile: ProjectFile, cost: number): CycleProgress {
    const history = projectFile.history;

    return {
        cycle: 0, // Set by caller
        agentTurns: history.filter(h => h.action === 'review_and_modify').length,
        fileReads: history.filter(h => h.action === 'file_read_success').length,
        fileEdits: history.filter(h => h.action === 'file_edit_success').length,
        fileWrites: history.filter(h => h.action === 'file_write_success').length,
        errors: history.filter(h => h.action.includes('failed')).length,
        cost
    };
}

export function displayCycleSummary(
    cycleNumber: number,
    progress: CycleProgress,
    keyActions: string[]
): void {
    console.log(`\n╔${'═'.repeat(78)}╗`);
    console.log(`║ 🎯 CYCLE ${cycleNumber} SUMMARY${' '.repeat(78 - 20)}║`);
    console.log(`╠${'═'.repeat(78)}╣`);

    console.log(`║ ${' '.repeat(77)}║`);
    console.log(`║ Actions Taken:${' '.repeat(63)}║`);

    if (keyActions.length === 0) {
        console.log(`║   • No significant actions this cycle${' '.repeat(40)}║`);
    } else {
        keyActions.slice(0, 5).forEach(action => {
            const truncated = action.length > 72 ? action.substring(0, 69) + '...' : action;
            console.log(`║   • ${truncated}${' '.repeat(74 - truncated.length)}║`);
        });
    }

    console.log(`║ ${' '.repeat(77)}║`);
    console.log(`║ Statistics:${' '.repeat(66)}║`);
    console.log(`║   Turns: ${progress.agentTurns}  │  Reads: ${progress.fileReads}  │  Edits: ${progress.fileEdits}  │  Writes: ${progress.fileWrites}  │  Errors: ${progress.errors}${' '.repeat(10)}║`);
    console.log(`║   Cost: $${progress.cost.toFixed(4)}${' '.repeat(64)}║`);
    console.log(`║ ${' '.repeat(77)}║`);
    console.log(`╚${'═'.repeat(78)}╝\n`);
}

export function extractKeyActions(projectFile: ProjectFile): string[] {
    const actions: string[] = [];

    for (const entry of projectFile.history) {
        if (entry.action === 'file_write_success') {
            actions.push(`✅ Created ${entry.changes.location}`);
        } else if (entry.action === 'file_edit_success') {
            actions.push(`✏️  Edited ${entry.changes.location}`);
        } else if (entry.action.includes('failed')) {
            actions.push(`❌ Failed: ${entry.changes.location}`);
        }
    }

    return actions;
}
