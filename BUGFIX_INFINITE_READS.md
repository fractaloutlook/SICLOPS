# Bug Fix: Infinite Read Loop

## Issue Discovered

**Date:** 2026-01-08
**Cycle:** 2026-01-08T06-23-53-802Z_cycle_001.log
**Agent:** Jordan (but could happen to any agent)

### Symptoms:
```
Turns: 4  │  Reads: 15  │  Edits: 0  │  Writes: 0  │  Errors: 0
Cost: $2.7820
Actions Taken: No significant actions this cycle
```

Jordan spent **$2.78** doing absolutely nothing except reading files repeatedly.

## Root Cause

Agents didn't understand that **every turn must produce output**. They would:

1. Read notes file
2. Read source files (orchestrator.ts, etc.)
3. Pass to next agent or self-pass
4. Get turn back
5. Read the SAME files again
6. Repeat infinitely

**Jordan's Notes:**
```markdown
**Status:** Proposed, waiting for Morgan to review and apply on next pass
```

Jordan wrote this in notes but then kept getting turns and just... read files over and over instead of either:
- Making the changes himself
- Updating notes with why he's blocked
- Passing with clear reasoning

## Cost Impact

- Each turn: ~$0.50-0.70
- Jordan's wasted turns: 4+ reads without action
- Total waste: **$2.78**
- Could have implemented entire feature with that cost!

## Fix Applied

**File:** `src/agent.ts` (lines 446-460)

Added explicit instructions:

```typescript
⚠️ CRITICAL: EVERY TURN MUST PRODUCE ACTION
DO NOT just read files and pass without doing something productive!

**Required: After reading files, you MUST:**
- Make code changes (fileEdit or fileWrite), OR
- Update your notebook with observations (fileEdit on notes/*.md), OR
- Pass with explicit reasoning why NO action is needed this turn

**FORBIDDEN:**
❌ Reading files → passing → reading same files again → passing (INFINITE LOOP!)
❌ Self-passing more than once without making file changes
❌ Reading notebooks but not updating them with new information
❌ Saying "waiting for X" when YOU could do the work yourself

**Cost awareness:** Each turn costs ~$0.50-0.70. Make it count!
```

## Expected Behavior After Fix

Agents will now:
- ✅ Read files once, then take action
- ✅ Update their notebooks if they have observations
- ✅ Make code changes if they see something to fix
- ✅ Pass with clear reasoning if truly no action needed
- ❌ **NOT** read the same files repeatedly without doing anything

## Testing Recommendation

Watch the next cycle for:
1. File read count should be reasonable (3-5 per agent, not 15)
2. Edits/writes should happen if agents see changes needed
3. Cost per turn should result in actual progress
4. No agent should self-pass more than 2 times without file changes

## Related Improvements

This fix works together with the task completion detection - if agents are just reading files without making changes, the completion detector will notice and stop the cycle early.

## Prevention

This won't happen again because:
1. Explicit cost warnings in prompts
2. Clear "FORBIDDEN" patterns listed
3. Required actions after file reads
4. Task completion detection catches infinite loops

---

**Bottom Line:** Agents were wasting money reading files in loops. Now they know every turn must produce something valuable.
