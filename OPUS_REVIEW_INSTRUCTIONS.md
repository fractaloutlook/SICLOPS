# Code Review Instructions for Claude Opus 4.5

**Project:** SICLOPS (Self-Improving Collective of Language-Processing Systems)
**Review Date:** 2026-01-08
**Reviewer:** Claude Opus 4.5

---

## Executive Summary

This is a **multi-agent self-improvement framework** where 5 AI agents (Morgan, Sam, Jordan, Alex, Pierre) collaborate to improve their own codebase. The system runs in cycles, alternating between discussion and implementation phases.

**Current State:**
- Core framework is functional but agents struggle with file editing
- SharedMemoryCache was recently integrated (by Claude Sonnet 4.5)
- System has debugging/monitoring features but agents aren't using them effectively
- Cost per cycle: ~$1-2 with Sonnet agents

**Your Mission:**
Review the codebase for architectural issues, suggest improvements, and identify why agents are failing to edit files successfully.

---

## DO NOT Read These (Token Waste)

❌ **Skip these directories:**
- `data/logs/` - Cycle execution logs (very large, not needed)
- `data/state/` - Runtime state files
- `node_modules/` - Dependencies

❌ **Skip these files:**
- Any `*.log` files
- `package-lock.json`

---

## Files You SHOULD Read (Priority Order)

### **Critical Architecture (Read First)**

1. **src/orchestrator.ts** (1800+ lines)
   - Main orchestration logic
   - File operation handlers (`handleFileWrite`, `handleFileEdit`, `handleFileRead`)
   - **PROBLEM AREA:** File editing is failing - investigate why
   - Look for the "Content mismatch" error logic

2. **src/agent.ts** (600+ lines)
   - Agent prompting and response parsing
   - **PROBLEM AREA:** JSON parsing from agent responses
   - **PROBLEM AREA:** Agents see "code snippet (click to expand)" in their own history
   - Look at how file operations are requested

3. **src/agent-base.ts** (~150 lines)
   - Base agent class with state management
   - Recently added: productivity tracking for adaptive turn limits

4. **src/types.ts**
   - TypeScript interfaces for the entire system
   - Understanding this will clarify the data structures

### **Core Utilities**

5. **src/memory/shared-cache.ts** (~305 lines)
   - 3-bucket LRU cache (transient/decision/sensitive)
   - Recently integrated into orchestrator
   - Check if the integration makes sense

6. **src/utils/** (Read selectively)
   - `task-completion.ts` - Auto-detects when agents finish
   - `progress-dashboard.ts` - Visual feedback
   - `adaptive-limits.ts` - Productivity-based turn limits
   - `error-recovery.ts` - API retry logic
   - `file-utils.ts` - File I/O wrapper

### **Configuration**

7. **src/config.ts**
   - Agent personalities and roles
   - Workflow order: Morgan → Sam → Jordan → Alex → Pierre

8. **src/index.ts**
   - Entry point
   - CLI argument parsing

### **Documentation**

9. **docs/** (If they exist)
   - Any architectural documentation
   - Design decisions

10. **README.md**, **CHANGELOG.md**, **IMPROVEMENTS_SUMMARY.md**
   - Project overview and recent changes

---

## Key Questions to Answer

### **Architecture & Design**

1. **Is the orchestrator doing too much?**
   - Should file operations be extracted to a separate module?
   - Is the context management properly separated?

2. **Are the agent prompts effective?**
   - Do agents understand how file operations work?
   - Are examples clear enough?

3. **Is the SharedMemoryCache integration sensible?**
   - Does it actually help agents share context?
   - Is it being used at all?

4. **Workflow order (Morgan → Sam → Jordan → Alex → Pierre)**
   - Does this make sense given their roles?
   - Should it be configurable?

### **File Editing System (CRITICAL)**

5. **Why are file edits failing?**
   - The `oldContent` matching is too strict?
   - Agents are formatting their requests incorrectly?
   - Whitespace/line ending issues?

6. **Should we use a different edit approach?**
   - Line-by-line diffs instead of exact string matching?
   - Line numbers + new content only?
   - Traditional patch format?

7. **Why do agents see "code snippet (click to expand)"?**
   - This was supposedly fixed but it's still appearing
   - Where is markdown being rendered incorrectly?

### **Agent Behavior**

8. **Why are agents hallucinating success?**
   - They say they edited files but nothing happened
   - They don't adapt to failure messages
   - Is the prompt too permissive?

9. **Are agents getting stuck in loops?**
   - Reading same files repeatedly
   - Self-passing without making progress
   - Not responding to error feedback

10. **Is the adaptive turn limit system helping or hurting?**
    - Was recently set very aggressive (cut off at 3 turns)
    - Now more lenient (cut off at 5 turns, score <10%)
    - Is this the right approach?

### **Cost Optimization**

11. **Is $1-2 per cycle reasonable?**
    - All agents are Sonnet 4.5 (~$3/$15 per 1M tokens)
    - Are there opportunities to use Haiku for some operations?

12. **Token usage analysis**
    - Is the history being sent to agents bloated?
    - Should we summarize more aggressively?

### **Error Handling**

13. **Error recovery system**
    - Retries API calls with exponential backoff
    - Is this working? Over-retrying?

14. **TypeScript compilation validation**
    - Every file write/edit is validated with `tsc --noEmit`
    - Is this too slow? Too strict?

---

## What We Need From You

### **Priority 1: Fix File Editing**

The agents **cannot edit files**. Every edit fails with "Content mismatch". This is the #1 blocker.

**Please:**
1. Identify why the exact string matching is failing
2. Suggest a more robust edit system
3. Propose specific code changes to fix this

### **Priority 2: Agent Prompt Improvements**

Agents are not behaving rationally:
- Hallucinating success when they fail
- Not adapting to error messages
- Getting stuck in read loops

**Please:**
1. Review the agent prompts (in `src/agent.ts`)
2. Suggest improvements to make agents more responsive to failures
3. Recommend better examples/instructions

### **Priority 3: Architecture Review**

**Please:**
1. Identify design flaws in the orchestrator
2. Suggest refactorings for better maintainability
3. Point out any obvious bugs or anti-patterns

### **Priority 4: Cost Optimization**

**Please:**
1. Identify token waste opportunities
2. Suggest where Haiku could replace Sonnet
3. Recommend context management improvements

---

## Specific Areas of Concern

### **File Edit Handler** (`src/orchestrator.ts:1059-1149`)

```typescript
private async handleFileEdit(fileEdit: FileEditRequest, agentName: string): Promise<{ success: boolean; error?: string }> {
    // ...
    for (const edit of fileEdit.edits) {
        // Verify old content matches (safety check)
        const actualOldContent = lines.slice(edit.lineStart - 1, edit.lineEnd).join('\n');
        if (actualOldContent.trim() !== edit.oldContent.trim()) {
            console.error(`   ❌ Edit verification failed at lines ${edit.lineStart}-${edit.lineEnd}`);
            return {
                success: false,
                error: `Content mismatch at lines ${edit.lineStart}-${edit.lineEnd}. File may have changed.`
            };
        }
        // ...
    }
}
```

**Problem:** This is failing for EVERY edit. Why? Is the agent's `oldContent` formatted wrong? Line ending issues?

### **Agent Response Parsing** (`src/agent.ts:187-229`)

The JSON parsing uses brace counting instead of regex (to avoid grabbing extra text). Is this reliable?

### **History Display** (`src/orchestrator.ts:1008`)

```typescript
notes: `📖 File content from ${result.fileRead.filePath} (${lineCount} lines):\n\n${readResult.content}`,
```

Supposedly this was fixed to not use triple backticks, but agents still see "code snippet (click to expand)". Why?

---

## Output Format

Please structure your review as:

```markdown
# OPUS 4.5 Code Review - SICLOPS

## Executive Summary
[High-level assessment]

## Critical Issues (Must Fix)
### 1. [Issue Name]
**Severity:** Critical/High/Medium/Low
**Location:** file.ts:line
**Problem:** [Description]
**Impact:** [What breaks]
**Solution:** [Specific code changes or approach]

## Architecture Recommendations
### [Area]
**Current State:** [What it does now]
**Problems:** [Issues identified]
**Recommendation:** [What to change]
**Benefits:** [Why this helps]

## Code Quality Issues
[List of bugs, anti-patterns, etc.]

## Optimization Opportunities
[Cost savings, performance improvements]

## Positive Observations
[What's working well - be honest!]

## Implementation Plan
1. [Fix X]
2. [Refactor Y]
3. [Optimize Z]
```

---

## Context You Should Know

1. **This is a POC** - Don't over-engineer. Suggest practical fixes, not perfect solutions.

2. **The agents are building themselves** - They're literally modifying their own framework code. This is experimental.

3. **Cost matters** - At $1-2 per cycle, wasted cycles add up quickly.

4. **The human user is technical** - You can suggest complex fixes. They understand TypeScript and system architecture.

5. **Recent changes** (last 24 hours):
   - Removed dramatic agent personalities
   - Made file reading synchronous (no more multi-turn reads)
   - Added self-passing mechanism (up to 3 times)
   - Added adaptive turn limits (cut off wasteful agents)
   - Integrated SharedMemoryCache
   - Added progress dashboard, task completion detection, error recovery

6. **The file editing system is BROKEN** - This is not a small bug. It's preventing all agent work.

---

## Final Notes

**Be brutally honest.** If the architecture is fundamentally flawed, say so. If the agent prompts are ineffective, explain why. If the file editing system needs to be completely redesigned, tell us.

**Focus on actionable fixes.** We don't need theoretical discussions - we need specific code changes that will make agents functional.

**Prioritize the file editing issue.** Until agents can edit files, nothing else matters.

---

**Thank you for your review!** Your fresh perspective as the top-tier model will help identify issues we've been too close to see.
