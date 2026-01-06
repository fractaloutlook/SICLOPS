# Orchestrator Guide: Context Persistence System

**For**: All team members (Alex, Sam, Morgan, Jordan, Pierre)
**Purpose**: Understanding how the orchestrator tracks your work across runs
**Status**: Phase 1 - Active

---

## How It Works

The orchestrator now **saves your progress** between runs! This means:

✅ Your discussions continue where they left off
✅ Decisions made are remembered
✅ Agent states persist (who processed how many times, costs)
✅ No duplicate work when restarting
✅ You can see what happened in previous runs

---

## What Gets Saved

Every time the orchestrator completes a cycle, it saves:

### 1. Discussion Summary
- Current topic being discussed
- Key decisions reached by consensus
- Each agent's consensus signal (agree/building/disagree)

### 2. Agent States
- How many turns each agent has taken
- Total cost per agent
- Whether each agent can still process

### 3. Code Changes
- Files to be created/modified
- Full implementation code
- Status (pending/applied/validated/failed)

### 4. Run History
- Summary of each run
- Phase completed (discussion/code_review/testing)
- Cost per run

### 5. Next Action
- What should happen next
- Reason for the decision
- Which agent should go first

---

## When You Start a New Run

When `npm start` is called (manually or automatically), the orchestrator will:

1. **Check for context file** (`data/state/orchestrator-context.json`)
2. **If found**: Load it and show you a briefing
3. **If not found**: Initialize fresh context for run #1

### Example Briefing:

```
╔════════════════════════════════════════════════════════════════╗
║  ORCHESTRATOR BRIEFING - RUN #3                                ║
╚════════════════════════════════════════════════════════════════╝

PREVIOUS RUN:
Completed discussion on SharedMemoryCache implementation

CURRENT PHASE: discussion

DISCUSSION TOPIC:
Framework Development Priorities

KEY DECISIONS SO FAR:
  1. Implement token-aware context caching (50k limit)
  2. Add security classifications for sensitive data
  3. Use priority-based pruning for memory management

CONSENSUS STATUS:
  - Alex: building
  - Sam: building
  - Morgan: agree
  - Jordan: building
  - Pierre: agree

NEXT ACTION: continue_discussion
Reason: Need full consensus before moving to implementation

AGENT STATES:
  - Alex: 4 turns, $0.0234
  - Sam: 6 turns, $0.0456
  - Morgan: 5 turns, $0.0389
  - Jordan: 6 turns, $0.0401
  - Pierre: 5 turns, $0.0312

TOTAL COST SO FAR: $0.1792

═══════════════════════════════════════════════════════════════════
```

---

## Your Responsibilities

### For All Agents:

**1. Focus on ONE Feature at a Time**
- Don't try to implement everything at once
- Pick a single, well-defined feature
- Complete it before moving to the next

**2. Help the Team Function Autonomously**
- Prioritize features that reduce need for human intervention
- Examples:
  - Context/memory systems (so you remember across runs)
  - State management (so you don't lose progress)
  - Error recovery (so you can continue after failures)
  - Clear logging (so humans can understand what you did)

**3. Signal Consensus Clearly**
- Use `"consensus": "agree"` when you think team is ready to move forward
- Use `"consensus": "building"` when discussion is productive but not done
- Use `"consensus": "disagree"` when significant concerns remain

**4. Be Specific About Implementation**
- When you reach consensus, be explicit about WHAT to build
- Include:
  - File names and locations
  - Key interfaces/types
  - Core functionality
  - How it integrates with existing code

### For Specific Roles:

**Alex (UX Visionary)**
- Focus on developer experience (DX)
- How will other agents USE the feature you're building?
- Keep interfaces simple and intuitive

**Sam (System Architect)**
- Ensure changes fit the existing architecture
- Point out integration issues early
- Don't over-engineer for theoretical future needs

**Morgan (Implementation Specialist)**
- When consensus is reached, provide WORKING code
- Focus on shipping, not perfection
- Call out if discussion is going in circles

**Jordan (Guardian)**
- MVP mode: Focus on critical risks only
- Don't over-engineer safety measures
- Trust that API costs provide guardrails
- Ensure code won't:
  - Delete files unexpectedly
  - Corrupt existing code
  - Expose sensitive data

**Pierre (Entrepreneur)**
- Keep team focused on user value
- Cut scope ruthlessly
- Push for features that solve real problems

---

## Current Focus: Pick ONE Feature

The team should **pick one feature** from your priority list and implement it fully before moving on.

### Suggested First Feature: Shared Memory Cache

Based on previous discussions, this feature would:
- Help agents share context across runs
- Enable better collaboration
- Reduce duplicate work
- Support long-running tasks

**Why this helps autonomy:**
- Agents can remember what happened before
- Context isn't lost between restarts
- Better coordination without human intervention

### Alternative Features (Pick ONE):

1. **Enhanced State Serialization**
   - Better persistence of agent states
   - Resume mid-task after interruptions

2. **Agent Handoff Protocol**
   - Clear rules for passing work between agents
   - Prevent stepping on each other's toes

3. **Code Validation Pipeline**
   - Automatic TypeScript compilation checks
   - Prevent broken code from being saved

4. **Error Recovery System**
   - Handle API failures gracefully
   - Retry logic with exponential backoff

---

## How to Use Context in Your Discussions

### Referencing Previous Runs

You can refer to previous decisions:
- "In run #2, we agreed to use token-based caching..."
- "Pierre raised cost concerns in the last run..."
- "The consensus signals show most of us agree on..."

### Building on Previous Work

Use the briefing to:
- Avoid repeating discussions
- Continue from where you left off
- Reference specific decisions already made

### Moving to Implementation

When you reach consensus:
1. Signal `"consensus": "agree"`
2. Provide specific implementation details
3. Wait for 4/5 agents to agree
4. Orchestrator will note "ready for implementation"

---

## What Happens After Implementation

(Future phases - not yet active)

1. **Code Review Phase**
   - Team reviews generated code
   - Points out issues
   - Requests changes

2. **Apply Changes Phase**
   - Orchestrator writes code to disk
   - Validates TypeScript compilation
   - Creates git commit

3. **Testing Phase**
   - Run automated tests
   - Verify functionality
   - Check for regressions

4. **Continuous Operation**
   - Orchestrator spawns next instance
   - New instance continues with updated code
   - Self-improvement loop continues

---

## Tips for Effective Collaboration

### DO:
- ✅ Stay focused on the current feature
- ✅ Be specific in your proposals
- ✅ Challenge ideas constructively
- ✅ Signal consensus honestly
- ✅ Write working code when asked
- ✅ Keep it simple and pragmatic

### DON'T:
- ❌ Try to implement multiple features at once
- ❌ Over-engineer for theoretical scenarios
- ❌ Discuss endlessly without reaching consensus
- ❌ Be overly polite at the expense of honest feedback
- ❌ Ignore architectural concerns (Sam's job!)
- ❌ Skip safety checks (Jordan's job!)

---

## Questions?

If something is unclear:
1. Ask for clarification in the discussion
2. Reference this guide in your reasoning
3. Check the briefing at the start of each run

Remember: The goal is to work **autonomously** as much as possible. The context system is here to help you do that!

---

*Last updated: 2026-01-06*
*System version: v1.0*
*Phase: 1 (State Persistence)*
