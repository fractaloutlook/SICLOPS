# Harness Fix Summary - Run #48 Hallucination Issue

**Date:** 2026-01-13
**Issue:** Agents rubber-stamped work they didn't do, wasting $0.27 and tokens

## Root Cause

The orchestrator's `generateImplementationPrompt()` method (lines 625-705) was **hardcoded** to always say:

```
IMPLEMENTATION TASK: Shared Memory Cache
CONSENSUS REACHED ✅
Your team has agreed on the design for SharedMemoryCache. Now it's time to implement it!
```

This caused a loop:
1. **Run #47**: Agents implement SharedMemoryCache (real work done ✅)
2. **Run #48**: Same hardcoded prompt given again → agents see everything's done → rubber-stamp and hallucinate approval ❌
3. **Run #49 would have been**: Same thing again...

## What Was Fixed

### 1. Added Implementation Detection (orchestrator.ts:977-996)

Now checks if SharedMemoryCache is already implemented before entering implementation mode:

```typescript
// Check if SharedMemoryCache is already implemented
let sharedCacheExists = false;
let sharedCacheTestExists = false;
try {
    await FileUtils.readFile('src/memory/shared-cache.ts');
    sharedCacheExists = true;
} catch (e) { }
// ... check for test files too
```

### 2. Reset Consensus When Implementation Complete (orchestrator.ts:998-1007)

```typescript
if (context && this.hasConsensus(context) && sharedCacheExists && sharedCacheTestExists) {
    // SharedMemoryCache already implemented - reset consensus and start new discussion
    console.log(`\n🎉 SharedMemoryCache implementation complete! Resetting consensus for next feature...\n`);

    context.discussionSummary.consensusReached = false;
    context.discussionSummary.consensusSignals = {};
    context.currentPhase = 'discussion';
    await this.saveContext(context);
}
```

### 3. Updated Discussion Mode Prompt (orchestrator.ts:1010-1052)

Now shows completed features and suggests what to build NEXT:

```
TEAM DISCUSSION: What to Build NEXT

COMPLETED FEATURES:
- ✅ SharedMemoryCache - three-bucket LRU cache with tests

SUGGESTED NEXT FEATURES (pick ONE):
- Enhanced state serialization
- Agent handoff protocol
- Code validation pipeline
- Error recovery system
- Fix/improve existing features (e.g., make SharedMemoryCache tests actually run)
```

## What Will Happen Next Run

The agents will now see:
- SharedMemoryCache is marked as ✅ COMPLETE
- Prompt asks "What to build NEXT?"
- Suggests fixing the Jest test file as one option
- No more infinite loops of the same task

## Remaining Issue: Jest Test File

The agents created `src/memory/__tests__/shared-cache.test.ts` which uses Jest syntax but:
- Project doesn't have Jest installed
- Test file won't compile or run
- Agents should discover this and either:
  - Install Jest
  - Or convert to simple ts-node format

This is now a valid **next task** for them to tackle.

## Summary

**Before:** Orchestrator gave same hardcoded task repeatedly → token waste
**After:** Orchestrator detects completion → resets to discussion mode → asks what's NEXT

The agents weren't hallucinating - **the harness was lying to them**. Now fixed.
