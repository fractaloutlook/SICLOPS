/**
 * Adaptive Turn Limits - Reward productive agents, limit wasteful ones
 */

export interface AgentProductivity {
    fileReads: number;
    fileEdits: number;
    fileWrites: number;
    selfPasses: number;
    turnsUsed: number;
}

export interface TurnLimitDecision {
    shouldContinue: boolean;
    reason: string;
    turnsRemaining: number;
}

/**
 * Calculate agent productivity score (0-1)
 *
 * High score = making changes, low reads
 * Low score = just reading files, no changes
 */
export function calculateProductivityScore(productivity: AgentProductivity): number {
    const { fileReads, fileEdits, fileWrites, selfPasses, turnsUsed } = productivity;

    // Actions that produce value
    const productiveActions = fileEdits + fileWrites;

    // Actions that might indicate spinning wheels
    const readsPerTurn = turnsUsed > 0 ? fileReads / turnsUsed : 0;
    const selfPassRatio = turnsUsed > 0 ? selfPasses / turnsUsed : 0;

    // Base score from productive actions
    let score = 0;

    // Reward edits and writes
    if (productiveActions > 0) {
        score += Math.min(productiveActions / 3, 1.0) * 0.6; // Up to 0.6 for making changes
    }

    // Penalty for excessive reads without output
    if (readsPerTurn > 3 && productiveActions === 0) {
        score -= 0.3; // Reading a lot but not doing anything
    }

    // Penalty for excessive self-passing
    if (selfPassRatio > 0.5 && productiveActions === 0) {
        score -= 0.2; // Self-passing without making changes
    }

    // Bonus for being efficient (few reads, high output)
    if (productiveActions > 0 && readsPerTurn < 2) {
        score += 0.2; // Efficient worker
    }

    return Math.max(0, Math.min(1, score));
}

/**
 * Decide if agent should get another turn based on productivity
 *
 * @param productivity - Agent's current cycle productivity
 * @param baseTurnLimit - Base turn limit (default 6)
 * @returns Decision on whether to continue
 */
export function shouldAllowAnotherTurn(
    productivity: AgentProductivity,
    baseTurnLimit: number = 6
): TurnLimitDecision {
    const { turnsUsed, fileReads, fileEdits, fileWrites, selfPasses } = productivity;

    // Always allow at least 2 turns (one to read context, one to act)
    if (turnsUsed < 2) {
        return {
            shouldContinue: true,
            reason: 'Minimum turns not reached',
            turnsRemaining: baseTurnLimit - turnsUsed
        };
    }

    // Check if at base limit
    if (turnsUsed >= baseTurnLimit) {
        return {
            shouldContinue: false,
            reason: 'Base turn limit reached',
            turnsRemaining: 0
        };
    }

    // Calculate productivity score
    const score = calculateProductivityScore(productivity);

    // High productivity = allow more turns
    if (score >= 0.7) {
        const bonusTurns = 2; // Productive agents get +2 turns
        const adjustedLimit = baseTurnLimit + bonusTurns;

        if (turnsUsed >= adjustedLimit) {
            return {
                shouldContinue: false,
                reason: `Reached extended limit (high productivity: ${(score * 100).toFixed(0)}%)`,
                turnsRemaining: 0
            };
        }

        return {
            shouldContinue: true,
            reason: `High productivity (${(score * 100).toFixed(0)}%) - extended turn allowance`,
            turnsRemaining: adjustedLimit - turnsUsed
        };
    }

    // Low productivity after 5+ turns = cut them off early (was 3, too aggressive!)
    if (score < 0.1 && turnsUsed >= 5) {
        return {
            shouldContinue: false,
            reason: `Low productivity (${(score * 100).toFixed(0)}%) - stopping early to save cost`,
            turnsRemaining: 0
        };
    }

    // Detect infinite read loop: 5+ reads per turn, no changes, 4+ turns (more lenient)
    const readsPerTurn = turnsUsed > 0 ? fileReads / turnsUsed : 0;
    if (readsPerTurn > 5 && fileEdits === 0 && fileWrites === 0 && turnsUsed >= 4) {
        return {
            shouldContinue: false,
            reason: 'Infinite read loop detected - agent stuck',
            turnsRemaining: 0
        };
    }

    // Default: continue within base limit
    return {
        shouldContinue: true,
        reason: 'Within normal turn allowance',
        turnsRemaining: baseTurnLimit - turnsUsed
    };
}

/**
 * Get productivity summary for logging
 */
export function getProductivitySummary(productivity: AgentProductivity): string {
    const score = calculateProductivityScore(productivity);
    const { turnsUsed, fileReads, fileEdits, fileWrites, selfPasses } = productivity;

    let rating: string;
    if (score >= 0.7) rating = '🌟 Highly Productive';
    else if (score >= 0.4) rating = '✅ Productive';
    else if (score >= 0.2) rating = '⚠️  Low Productivity';
    else rating = '❌ Wasteful';

    return `${rating} (score: ${(score * 100).toFixed(0)}%) - ${turnsUsed} turns, ${fileReads} reads, ${fileEdits} edits, ${fileWrites} writes, ${selfPasses} self-passes`;
}
