# SICLOPS Agent Guide: How to Modify the System

**Audience:** AI agents working on SICLOPS
**Purpose:** Document what you can change and how to change it safely

---

## Core Principle

**You can modify your own framework.** This is self-improvement code. The system you're running in IS the system you're building.

**After each cycle:**
- Your changes are compiled (TypeScript validation)
- If valid, they become part of the framework
- Next cycle runs with your modifications

**This means you're literally rebuilding yourself as you work.**

---

## What You Can Change

### 1. Agent Roles & Personalities

**File:** `src/config.ts`

**What's changeable:**
```typescript
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  Morgan: {
    name: 'Morgan',
    role: 'Lead Developer',        // ← YOU CAN CHANGE THIS
    personality: 'Direct, ...',    // ← AND THIS
    taskFocus: 'Writing code...',  // ← AND THIS
    model: 'claude-sonnet-4-5-20241022',  // ← AND THIS (see models below)
    version: generateVersion()
  },
  // ... other agents
};
```

**Models available:**
- `claude-sonnet-4-5-20241022` - Best balance ($3/$15 per 1M tokens)
- `claude-3-5-haiku-20241022` - Faster, cheaper ($1/$5 per 1M tokens)
- `claude-opus-4-5-20251101` - Highest capability ($5/$25 per 1M tokens)
- `gpt-4o-mini` - OpenAI option ($0.15/$0.60 per 1M tokens)

**Example change:**
```typescript
// Morgan decides to specialize further
Morgan: {
  name: 'Morgan',
  role: 'Infrastructure Specialist',
  personality: 'Pragmatic, focused on robustness over features',
  taskFocus: 'System reliability, caching, state management',
  model: 'claude-sonnet-4-5-20241022',
  version: generateVersion()
}
```

**When to change roles:**
- Team agrees current role descriptions aren't working
- Need specialization (e.g., separate "Tester" from "Guardian")
- Want to experiment with different personalities

**How to propose:**
1. Discuss in team meeting (reach consensus)
2. One agent does the fileEdit
3. Next cycle runs with new role

---

### 2. Team Composition

**File:** `src/config.ts`

**You can:**
- Add new agents
- Remove agents (if team agrees they're redundant)
- Change the workflow order

**Adding a new agent:**
```typescript
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // ... existing agents ...

  Riley: {
    name: 'Riley',
    role: 'Test Engineer',
    personality: 'Methodical, focused on breaking things to make them stronger',
    taskFocus: 'Writing tests, finding edge cases, validating functionality',
    model: 'claude-3-5-haiku-20241022',  // Cheaper model for testing
    version: generateVersion()
  }
};

// Update workflow order
export const AGENT_WORKFLOW_ORDER = ['Morgan', 'Sam', 'Jordan', 'Alex', 'Riley', 'Pierre'];
```

**Don't forget:**
- Add agent to `AGENT_WORKFLOW_ORDER`
- Create their notebook: `notes/riley-notes.md`

---

### 3. Orchestrator Behavior

**File:** `src/orchestrator.ts` (1900+ lines)

**⚠️ WARNING:** This is your execution engine. Changes here affect how cycles run.

**What's safe to change:**
- Turn limits (currently 6 per agent)
- Consensus threshold (currently 4/5)
- File operation behavior
- How context is summarized
- Cost tracking details

**What's risky:**
- The main `runCycle()` loop
- Agent initialization
- State persistence logic

**Recommendation:**
- Read orchestrator.ts thoroughly first
- Make small, incremental changes
- Test after each change
- Have Jordan review for unintended consequences

---

### 4. Agent Prompts (Advanced)

**Files:**
- `src/orchestrator.ts` - Implementation prompt (lines ~508-651)
- `src/orchestrator.ts` - Discussion prompt (lines ~869-920)

**Currently:** Prompts are hardcoded in orchestrator

**You could:**
- Extract prompts to separate files (`prompts/implementation.txt`)
- Make prompts configurable per agent
- Add dynamic sections based on context

**Why you might:**
- Current prompts are too verbose (waste tokens)
- Need agent-specific instructions
- Want to experiment with different prompt styles

---

### 5. System Features

**You can build new features:**
- New file operation types
- Better caching mechanisms
- Smarter context summarization
- Git integration improvements
- Test runners
- Documentation generators

**Process:**
1. Team discusses and reaches consensus
2. Morgan implements
3. Sam reviews architecture
4. Jordan checks security
5. Alex validates UX
6. Pierre ensures scope is controlled
7. Test thoroughly
8. Update docs/SYSTEM_CAPABILITIES.md

---

### 6. Agent Handoff Protocol

To ensure clear communication and maintain workflow, all agent turns **must** specify a `targetAgent` and `reasoning` in the JSON output.

**`targetAgent` field:**
- **Purpose:** Specifies which agent will receive the turn next.
- **Valid Values:**
    - Any agent name from `AGENT_WORKFLOW_ORDER` (e.g., "Morgan", "Sam", "Jordan", "Alex", "Pierre").
    - "Orchestrator" to signal the end of the current round of implementation. This is typically used when the agreed-upon task is complete.
- **Validation:** The system validates that the `targetAgent` is a recognized agent in the workflow or "Orchestrator". An invalid name will result in the turn defaulting to the next agent in `AGENT_WORKFLOW_ORDER`.

**`reasoning` field:**
- **Purpose:** A brief, clear explanation of why you made the changes in your turn and why you are passing to the chosen `targetAgent`.
- **Requirement:** This field is mandatory for every turn.

**Example:**
```json
{
  "fileEdit": { /* ... */ },
  "targetAgent": "Sam",
  "reasoning": "Implemented the core logic for X. Passing to Sam for test review."
}
```
---

## How to Make Changes Safely

### Step 1: Read First
```json
{
  "fileRead": {
    "filePath": "src/config.ts",
    "reason": "Need to see current configuration before proposing changes"
  },
  "targetAgent": "Self/Next",
  "reasoning": "Reading file to understand current state."
}
```

### Step 2: Discuss
- Don't make changes unilaterally (unless minor)
- Major changes need team consensus
- Document reasoning in your notebook

### Step 3: Edit Carefully
```json
{
  "fileEdit": {
    "filePath": "src/config.ts",
    "edits": [{
      "find": "role: 'Lead Developer'",
      "replace": "role: 'Infrastructure Specialist'"
    }],
    "reason": "Refining Morgan's focus based on team discussion"
  },
  "targetAgent": "Jordan",
  "reasoning": "Updated config. Jordan, please review the change for correctness."
}
```

### Step 4: Validate
- TypeScript validation happens automatically
- If it fails, error shown to next agent
- Fix and retry

### Step 5: Test
- Write tests for new features
- Run existing tests to ensure nothing broke
- Document what changed

---

## Change Guidelines

### ✅ DO
- Discuss major changes first
- Make one change at a time
- Update documentation when adding features
- Write tests for new functionality
- Log your reasoning in notebooks

### ❌ DON'T
- Change multiple files simultaneously (hard to debug failures)
- Make breaking changes without team agreement
- Skip TypeScript validation
- Modify orchestrator.ts without understanding it fully
- Add features without updating docs/SYSTEM_CAPABILITIES.md

---

## Examples of Past Changes

### Role Refinement
```
Team decided Morgan's "Lead Developer" was too generic.
Changed to "Infrastructure Specialist" to reflect actual work.
```

### Adding Haiku for Cost Savings
```
Realized some tasks don't need Sonnet.
Changed Pierre to claude-3-5-haiku (scope-keeping is simpler).
Saved ~40% on Pierre's turns.
```

### Tightening Turn Limits
```
Agents were wasting turns reading files repeatedly.
Changed turn limit from 10 → 6.
Added adaptive productivity tracking.
```

---

## Your Mission

**Build a great personal assistant framework for a single user.**

That's it. Everything else serves that goal.

**You improve the harness so you can better serve the mission.**

- Add features that help you assist better
- Remove cruft that slows you down
- Refine your roles to match actual work patterns
- Experiment with team composition
- Optimize costs without sacrificing capability

**The framework is yours. Own it. Evolve it. Make it great.**
