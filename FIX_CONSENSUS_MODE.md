# Fix: Consensus Mode for Discussion Phase

**Date:** 2026-01-13
**Issue:** Agents were running in sequential mode (1-5 linear) instead of consensus mode (debate/vote)

## Root Cause

The config had `requireConsensus: false` hardcoded (index.ts:36), which forced sequential workflow for ALL phases:
- Discussion phase: Should use consensus (debate, vote)
- Implementation phase: Should use sequential (Morgan → Sam → Jordan → Alex → Pierre)

But it was ALWAYS sequential, so agents never debated or voted.

## The Fix

### 1. Added Phase Tracking (orchestrator.ts:62)

```typescript
private currentPhase: 'discussion' | 'implementation' = 'discussion';
```

### 2. Created Helper Method (orchestrator.ts:88-96)

```typescript
/**
 * Determine if we should use consensus mode based on current phase.
 * - Discussion phase: Use consensus (debate, vote)
 * - Implementation phase: Use sequential workflow
 */
private shouldUseConsensus(): boolean {
    return this.currentPhase === 'discussion';
}
```

### 3. Replaced All requireConsensus Checks

**Before:**
```typescript
if (this.config.requireConsensus !== false) {
    // Consensus logic
}
```

**After:**
```typescript
if (this.shouldUseConsensus()) {
    // Consensus logic - now phase-aware!
}
```

### 4. Set Phase When Switching Modes

**Entering Implementation (orchestrator.ts:1025):**
```typescript
this.currentPhase = 'implementation';  // Switch to sequential mode
console.log(`\n✅ Consensus detected! Switching to IMPLEMENTATION mode (sequential workflow).\n`);
```

**Entering Discussion (orchestrator.ts:1038):**
```typescript
this.currentPhase = 'discussion';  // Ensure we're in discussion mode
```

## What Will Happen Now

### Discussion Phase (New Feature)
- **Mode:** Consensus
- **Workflow:** Random agent starts, all can speak
- **Agent behavior:** Debate, vote, signal agree/disagree/building
- **Prompt says:** "Reach consensus (4/5 agents agree)"
- **Prompt says:** "Signal consensus honestly: agree/building/disagree"

### Implementation Phase (After Consensus)
- **Mode:** Sequential
- **Workflow:** Morgan → Sam → Jordan → Alex → Pierre
- **Agent behavior:** Each builds on previous work
- **Prompt says:** "Each agent contributes their perspective in sequence"
- **Prompt says:** "Work sequentially: each agent reviews and passes to next"

## Expected Behavior on Next Run

**Cycle 1-2 (Discussion):**
- Agents will debate which feature to build next
- Random speaking order
- Can pass to any agent
- Must reach 4/5 agree for consensus
- Should see: "Alex agrees", "Morgan is building", "Sam disagrees", etc.

**Cycle 3+ (Implementation - if consensus reached):**
- Fixed workflow: Morgan → Sam → Jordan → Alex → Pierre
- Each agent builds on previous work
- No voting, just sequential collaboration

## Bonus Fix: Bat File Encoding

Also removed emoji characters from `runMultipleCycles.bat` that were causing display issues in Windows CMD:
- ╔══╗ → ======
- ⚠️ → WARNING
- ✅ → (removed)
- ⏸️ → (removed)

Now displays cleanly in all Windows terminals.

## Testing

To verify the fix works:
```bash
npm start
# or
runMultipleCycles.bat 3
```

You should see:
1. Agents debating/voting on features (not just passing 1-5)
2. Consensus signals in their responses
3. Clean terminal output without weird characters
