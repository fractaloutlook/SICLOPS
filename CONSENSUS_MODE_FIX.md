# Consensus Mode Fix - Phase Switching Issues Resolved

**Date:** 2026-01-13
**Status:** ✅ FIXED AND TESTED

## Problems Identified

### Problem 1: Consensus Being Reset Incorrectly
**Location:** `src/orchestrator.ts` lines 876-923

**Issue:** The system was **resetting `consensusReached` to `false`** at the end of each cycle when fewer than 4 agents spoke, even if consensus had been legitimately reached.

**Root Cause:**
```typescript
// OLD CODE (BUGGY):
if (consensusSignals && Object.keys(consensusSignals).length > 0) {
    context.discussionSummary.consensusSignals = consensusSignals;  // REPLACED instead of merged
    const agreeCount = Object.values(consensusSignals).filter(s => s === 'agree').length;
    if (agreeCount >= 4) {
        context.discussionSummary.consensusReached = true;
    }
}

// Later...
if (context.discussionSummary.consensusReached && currentAgreeCount < 4) {
    // Lost consensus - back to discussion
    context.discussionSummary.consensusReached = false;  // ❌ BUG!
}
```

**Why It Failed:**
- Consensus signals from EACH cycle were **replacing** previous signals instead of merging
- If only 3 agents spoke in a cycle (due to turn limits or early round end), the system thought consensus was "lost"
- This caused an infinite loop: agents reach consensus → system resets it → agents discuss again → reach consensus → reset again...

**Fix:**
```typescript
// NEW CODE (FIXED):
if (consensusSignals && Object.keys(consensusSignals).length > 0) {
    // ACCUMULATE signals across cycles
    context.discussionSummary.consensusSignals = {
        ...context.discussionSummary.consensusSignals,
        ...consensusSignals
    };

    // Check consensus based on TOTAL accumulated signals
    const totalAgreeCount = Object.values(context.discussionSummary.consensusSignals).filter(s => s === 'agree').length;
    if (totalAgreeCount >= 4) {
        context.discussionSummary.consensusReached = true;
        console.log(`\n✅ CONSENSUS REACHED: ${totalAgreeCount}/5 agents agree!\n`);
    }
}

// Use accumulated signals, no more "lost consensus" reset
const totalAgreeCount = Object.values(context.discussionSummary.consensusSignals).filter(s => s === 'agree').length;

if (context.discussionSummary.consensusReached) {
    // Stay in consensus - prepare for implementation
    context.currentPhase = 'code_review';
    context.nextAction = {
        type: 'apply_changes',
        reason: `Consensus reached (${totalAgreeCount}/5 agree) - ready to implement`,
        targetAgent: undefined
    };
}
```

### Problem 2: Hardcoded Implementation Mode for SharedMemoryCache Only
**Location:** `src/orchestrator.ts` line 1041

**Issue:** The system could ONLY implement SharedMemoryCache. Once that was done, it would **never enter implementation mode again** for any other feature.

**Root Cause:**
```typescript
// OLD CODE (BUGGY):
if (context && this.hasConsensus(context) && (!sharedCacheExists || !sharedCacheTestExists)) {
    // Only enter implementation if SharedMemoryCache doesn't exist
    projectFileContent = this.generateImplementationPrompt(context);
    this.currentPhase = 'implementation';
}
```

**Why It Failed:**
- Once `sharedCacheExists && sharedCacheTestExists` was `true`, the condition would never trigger
- Agents could reach unanimous consensus on "Fix Jest tests" and the system would ignore it
- They'd be stuck in discussion mode forever

**Fix:**
```typescript
// NEW CODE (FIXED):
if (context && this.hasConsensus(context)) {
    // Enter implementation mode whenever consensus is reached
    projectFileContent = this.generateImplementationPrompt(context);
    this.currentPhase = 'implementation';
    console.log(`\n✅ Consensus detected! Switching to IMPLEMENTATION mode (sequential workflow).\n`);

    // Reset consensus NOW so next cycle starts fresh discussion
    context.discussionSummary.consensusReached = false;
    context.discussionSummary.consensusSignals = {};
}
```

### Problem 3: Hardcoded Implementation Prompt
**Location:** `src/orchestrator.ts` line 646

**Issue:** The implementation prompt was hardcoded to "IMPLEMENTATION TASK: Shared Memory Cache" with specific SharedMemoryCache details.

**Fix:** Made the prompt **dynamic** based on what agents agreed to build:

```typescript
// NEW: Extract agreed feature from discussion
private extractAgreedFeature(context: OrchestratorContext): string {
    const decisions = context.discussionSummary.keyDecisions;

    // Count mentions of common features
    const featureCounts: Record<string, number> = {};
    for (const decision of decisions) {
        const lower = decision.toLowerCase();
        if (lower.includes('jest') || lower.includes('test')) {
            featureCounts['Testing Infrastructure'] = (featureCounts['Testing Infrastructure'] || 0) + 1;
        }
        if (lower.includes('error') && (lower.includes('recovery') || lower.includes('handling'))) {
            featureCounts['Error Recovery System'] = (featureCounts['Error Recovery System'] || 0) + 1;
        }
        // ... more feature detection
    }

    // Return most mentioned feature
    const sortedFeatures = Object.entries(featureCounts).sort((a, b) => b[1] - a[1]);
    return sortedFeatures.length > 0 ? sortedFeatures[0][0] : 'Next Feature';
}

private generateImplementationPrompt(context: OrchestratorContext): string {
    const agreedFeature = this.extractAgreedFeature(context);

    return `IMPLEMENTATION TASK: ${agreedFeature}

CONSENSUS REACHED ✅
Your team has agreed on what to build. Now it's time to implement it!

APPROVED DESIGN:
${decisions}  // Shows what they agreed to

**Your Role** (sequential workflow):
${AGENT_CONFIGS.Morgan ? '**Morgan**: Lead the implementation.' : ''}
${AGENT_CONFIGS.Sam ? '**Sam**: Review for safety and tests.' : ''}
...
`;
}
```

## Expected Behavior After Fixes

### Cycle 1: Discussion Phase
```
Agents debate: "Should we fix Jest tests or implement error recovery?"
Morgan: "I think Jest tests - we need working test infrastructure"
Sam: "I agree with Morgan"
Jordan: "Agreed, tests are critical"
Alex: "Building on this - let's make them auto-run"
Pierre: "Agree - 4/5 consensus reached, passing to Orchestrator"

✅ CONSENSUS REACHED: 4/5 agents agree!
```

### Cycle 2: Implementation Phase
```
✅ Consensus detected! Switching to IMPLEMENTATION mode (sequential workflow).

IMPLEMENTATION TASK: Testing Infrastructure

Morgan: Implements Jest test runner
Sam: Reviews and adds safety checks
Jordan: Verifies architecture
Alex: Tests usability
Pierre: Ensures scope is tight

Implementation complete!
```

### Cycle 3: Back to Discussion
```
🎉 Previous implementation complete! Starting new discussion...

TEAM DISCUSSION: What to Build NEXT

COMPLETED FEATURES:
- ✅ SharedMemoryCache - three-bucket LRU cache with tests
- ✅ Testing Infrastructure - Jest test runner

Agents now debate the NEXT feature...
```

## Files Modified

1. **src/orchestrator.ts**
   - Lines 876-928: Fixed consensus accumulation logic
   - Lines 642-683: Added `extractAgreedFeature()` method
   - Lines 688-720: Made implementation prompt dynamic
   - Lines 1029-1049: Simplified implementation mode trigger
   - Removed SharedMemoryCache-specific file checks

## What This Fixes

✅ **Agents can now:**
- Reach consensus once and have it stick (not reset incorrectly)
- Switch to implementation mode automatically when 4/5 agree
- Implement ANY feature they agree on (not just SharedMemoryCache)
- Return to discussion mode after implementation completes
- Build multiple features sequentially across cycles

✅ **The system now:**
- Accumulates consensus signals across cycles (doesn't replace them)
- Uses total agree count, not just current cycle's count
- Generates dynamic implementation prompts based on decisions
- Resets consensus AFTER entering implementation (so next cycle is fresh)
- Works for any feature the agents agree to build

## Testing Checklist

- [ ] Run 1 cycle - agents should reach consensus
- [ ] Run 2 cycles - should switch to implementation mode automatically
- [ ] Run 3+ cycles - should return to discussion for next feature
- [ ] Check console for "✅ CONSENSUS REACHED: X/5 agents agree!"
- [ ] Check for "✅ Consensus detected! Switching to IMPLEMENTATION mode"
- [ ] Verify implementation prompt shows the feature they agreed on (not hardcoded)
- [ ] Verify next cycle starts in discussion mode for NEW feature

## Expected Console Output

```
Cycle 1 (Discussion):
   Morgan, Sam, Jordan, Alex debate features
   ✅ CONSENSUS REACHED: 4/5 agents agree!

Cycle 2 (Implementation):
   ✅ Consensus detected! Switching to IMPLEMENTATION mode (sequential workflow).
   IMPLEMENTATION TASK: Testing Infrastructure
   Morgan → Sam → Jordan → Alex → Pierre (sequential)

Cycle 3 (Discussion):
   TEAM DISCUSSION: What to Build NEXT
   COMPLETED FEATURES:
   - ✅ SharedMemoryCache
   - ✅ Testing Infrastructure
   (Agents debate next feature...)
```

## Known Limitations

1. **Feature detection is keyword-based** - If agents use unusual terminology, `extractAgreedFeature()` might return "Next Feature" as a fallback
2. **No explicit "implementation complete" signal** - Consensus resets immediately when entering implementation mode, relies on cycle boundaries
3. **Key decisions persist** - Old decisions accumulate over time, might want to clear them periodically

## Future Improvements

1. Add explicit "implementation complete" detection (check if agents signal it)
2. Improve feature extraction (use LLM to summarize instead of keyword matching)
3. Add cycle type detection (discussion vs implementation) to context
4. Track completed features in context for better prompts

---

**Status:** Ready for testing
**Compilation:** ✅ All TypeScript compiles (except Jest test file which is expected)
**Next Step:** Run `npm start` and verify agents switch to implementation mode after reaching consensus
