# Logging & Agent Passing Improvements

**Date:** 2026-01-13

## Logging Improvements Implemented

### 1. Human-Readable Decision Loading

**Before:**
```
[SharedMemoryCache] STORE: decision_1768327236591_0.6912154030750328 | Bucket: decision | Tokens: 43
[SharedMemoryCache] STORE: decision_1768327236591_0.716089517452235 | Bucket: decision | Tokens: 43
```

**After:**
```
📋 Loading 6 previous decisions:
   Jordan (building): Completed security review of config.ts. API key handling follows standard practices for POC stage...
   Alex (building): Morgan's header comment implementation is clear and useful. I've reviewed it from a UX perspective...
   Pierre (building): Scope review complete. The config.ts header comment task is done - Morgan implemented it...
```

### 2. Optional Full Prompt Display

Add to your `.env` file:
```bash
SHOW_AGENT_PROMPTS=true
```

Now you'll see:
```
================================================================================
📝 PROMPT TO MORGAN:
================================================================================
[Full prompt content here - minus personality which is in config]
================================================================================
```

**Use cases:**
- Debug when agents go off-track
- Understand what context they're receiving
- Verify prompts are correctly formed

**Token cost:** ZERO! This is console-only, not logged to disk.

### 3. SharedMemoryCache Verbosity

The cryptic cache logs are now SILENT by default. They only appear if you set:
```bash
VERBOSE_CACHE_LOGGING=true
```

## Agent Architecture Clarification

**Question:** "I'm still not sure if you just have one claude sonnet going or what, now"

**Answer:** Each agent is a **separate Claude Sonnet 4.5 API call**:

```
Morgan's turn  → API call #1 to Claude (with Morgan's personality)
Sam's turn     → API call #2 to Claude (with Sam's personality)
Jordan's turn  → API call #3 to Claude (with Jordan's personality)
Alex's turn    → API call #4 to Claude (with Alex's personality)
Pierre's turn  → API call #5 to Claude (with Pierre's personality)
```

**They are NOT:**
- One Claude pretending to be 5 agents
- Sharing memory within a single conversation
- Aware of each other's "thoughts"

**They ARE:**
- 5 independent API calls
- Each sees the full history but processes independently
- Communication happens through the ProjectFile history

**Token costs:** Each agent pays for input (history + prompt) + output (their response).

---

## Strategic Agent Passing System (TO BE IMPLEMENTED)

### Current Problem

**In consensus mode, passing is currently random:** The orchestrator picks randomly from available agents, which leads to:
- Inefficient token usage (random agents jumping in unnecessarily)
- No strategic flow
- Agents can't "wrap up" when agreement is reached

### Requirements for Strategic Passing

#### 1. Agents Choose Their Target

Instead of orchestrator picking randomly, **agents explicitly choose** who should go next:

```json
{
  "targetAgent": "Jordan",
  "reasoning": "Jordan should review the security implications of this caching design"
}
```

#### 2. Agents Know Turn Availability

Prompt should include turn counts:
```
AVAILABLE AGENTS (turns remaining):
- Morgan: 2/3 turns remaining
- Sam: 1/3 turns remaining
- Jordan: 3/3 turns remaining
- Alex: 2/3 turns remaining
- Pierre: 0/3 turns remaining (exhausted - available next round)
```

#### 3. "Pass to Orchestrator" Option

When stuck or done, agents can end the round early:

```json
{
  "targetAgent": "Orchestrator",
  "reasoning": "Pierre and I are in agreement, but Morgan/Sam disagree. They're both out of turns. Let's end this round and start fresh."
}
```

This signals: "I think we should move to the next round now."

#### 4. Strategic Patterns Enabled

**Pattern A: Two Agents Debating**
- Morgan and Sam disagree (5 turns combined)
- Others wait while they hash it out
- When resolved, pass to Jordan for tiebreak
- Saves tokens from unnecessary participation

**Pattern B: Quick Consensus**
- First 3 agents agree
- Last 2 agents see agreement, add brief +1s
- Final agent passes to Orchestrator to end round early
- No need to burn all turns when consensus is clear

**Pattern C: Deadlock Handling**
- 3 agents exhausted, no consensus
- Remaining 2 agents recognize deadlock
- Pass to Orchestrator to end round
- Next round starts with fresh turns

### Implementation Plan (Not Yet Done)

**Step 1:** Update prompt to show turn availability
**Step 2:** Add "Orchestrator" as valid target agent option
**Step 3:** Handle Orchestrator target → end round early
**Step 4:** Remove random agent selection in consensus mode
**Step 5:** Add strategic passing guidance to prompts

**Estimated effort:** 2-3 hours of careful implementation + testing

**Risk:** Agents might abuse early-exit, need guardrails

---

## Claude Skills Question

**Question:** "Is consensus voting a known 'Claude Skill'? Should we use skills more?"

### What Are Claude Skills?

Claude Code (the CLI) has a "Skills" system - structured workflows that can be invoked with `/skillname`. They're essentially pre-packaged prompts with specific behaviors.

**Examples:**
- `/commit` - structured git commit workflow
- `/review-pr` - code review workflow
- `/pdf` - PDF analysis workflow

### Should You Use Skills Here?

**My recommendation: NO for multi-agent debate, YES for deterministic tasks.**

**Don't use skills for:**
- ❌ Consensus voting (too rigid, kills creativity)
- ❌ Open-ended discussion (skills constrain natural flow)
- ❌ Agent-to-agent communication (needs flexibility)

**DO use skills/scripts for:**
- ✅ TypeScript compilation checks (tsCompileTest.bat)
- ✅ Multi-cycle runs (runMultipleCycles.bat)
- ✅ Git operations (commit/push workflows)
- ✅ Test execution (automated validation)

### Why Not Skills for Consensus?

Consensus voting benefits from **emergent behavior** - agents developing their own debate patterns. Skills would force them into rigid templates and kill that emergence.

**Better approach:** Give agents:
1. Clear rules (must reach 4/5 agree)
2. Turn limits (can't talk forever)
3. Strategic options (pass to Orchestrator to end round)
4. Freedom to develop debate strategies organically

---

## Token Savings Analysis

### Bat Files vs Direct Commands

**Scenario:** Check TypeScript compilation 10 times in a session

**Direct bash commands:**
- Command generation: 50 tokens × 10 = 500 tokens
- Output parsing: 200 tokens × 10 = 2000 tokens
- **Total: 2500 tokens**

**Using tsCompileTest.bat:**
- Command generation: 10 tokens × 10 = 100 tokens
- Output parsing: 50 tokens × 10 = 500 tokens
- **Total: 600 tokens**
- **Savings: 1900 tokens (~$0.006)**

**Over 100 runs: $0.60 saved**

### Strategic Passing vs Random

**Random passing (current):**
- Average 15 turns per round (agents jump in unnecessarily)
- ~25k tokens per round
- **Cost per round: ~$0.75**

**Strategic passing (proposed):**
- Average 8-10 turns per round (focused discussion)
- ~15k tokens per round
- **Cost per round: ~$0.45**
- **Savings: 40% per discussion round**

**Over 20 discussion rounds: ~$6 saved**

---

## Next Steps

1. ✅ **Done:** Human-readable decision loading
2. ✅ **Done:** Optional prompt display (SHOW_AGENT_PROMPTS)
3. ✅ **Done:** Silent SharedMemoryCache by default
4. ⏳ **To Do:** Implement strategic agent passing
5. ⏳ **To Do:** Add turn count visibility in prompts
6. ⏳ **To Do:** Test consensus with new passing system

**Ready to implement strategic passing?** Let me know and I'll build it out properly with tests.
