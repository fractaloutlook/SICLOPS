# SICLOPS System Capabilities

**Last Updated:** 2026-01-10
**Purpose:** Catalog of features available to the agent team

---

## File Operations

### Read Files
- **Action:** `fileRead`
- **What:** Request any file's contents
- **Response:** File content displayed with line numbers
- **Example:**
  ```json
  {
    "fileRead": {
      "action": "read_file",
      "filePath": "src/config.ts",
      "reason": "Need to see current agent configurations"
    },
    "target": "Sam",
    "reasoning": "Reading config before proposing changes"
  }
  ```

### Edit Files (Pattern Matching)
- **Action:** `fileEdit`
- **What:** Find exact string patterns and replace them
- **Must be unique:** Pattern must appear only once in file
- **Auto-validates:** TypeScript compilation after every edit
- **Example:**
  ```json
  {
    "fileEdit": {
      "action": "edit_file",
      "filePath": "src/config.ts",
      "edits": [{
        "find": "role: 'Lead Developer'",
        "replace": "role: 'System Architect'"
      }],
      "reason": "Update Morgan's role description"
    },
    "target": "Jordan",
    "reasoning": "Role updated, Jordan please review"
  }
  ```

### Write New Files
- **Action:** `fileWrite`
- **What:** Create brand new files
- **Use for:** Tests, new modules, documentation
- **Auto-validates:** TypeScript compilation
- **Example:**
  ```json
  {
    "fileWrite": {
      "action": "write_file",
      "filePath": "tests/test-cache.ts",
      "content": "import { SharedMemoryCache } from '../src/memory/shared-cache';\n...",
      "reason": "Create test suite for SharedMemoryCache"
    },
    "target": "Sam",
    "reasoning": "Tests written, Sam please review"
  }
  ```

---

## Memory & Context

### Agent Notebooks
- **Files:** `notes/{agent-name}-notes.md`
- **Purpose:** Track observations, ideas, TODOs across runs
- **Lifecycle:** Persists across all runs
- **Usage:**
  - Read your notebook at start of turn (fileRead)
  - Update it before passing (fileEdit)
  - Review others' notebooks for coordination
- **Example keys:**
  ```markdown
  ## Morgan's Notebook

  ### TODO
  - [ ] Add validation to SharedMemoryCache.store()
  - [ ] Write integration tests

  ### Observations
  - Cache works but no agent-facing API yet
  - Need to expose store/retrieve to agents
  ```

### Context Persistence
- **File:** `data/state/orchestrator-context.json`
- **Contains:**
  - Previous runs' key decisions
  - Agent states (turn counts, costs)
  - Current phase (discussion vs implementation)
  - Consensus signals
- **Managed by:** Orchestrator (you see it in briefings)
- **Size:** Can grow large (~50k tokens) - gets auto-summarized

### SharedMemoryCache ✅ FULLY INTEGRATED
- **File:** `src/memory/shared-cache.ts`
- **Status:** Built, tested, and integrated into orchestrator
- **What it does:**
  - Three-bucket LRU cache (transient/decision/sensitive)
  - Stores decisions across runs
  - Token-aware eviction (50k total, 5k sensitive)
  - TTL-based expiration (1h/24h/7d per bucket)
- **Current usage:** Orchestrator loads cached decisions on startup, stores new decisions after each cycle
- **Test Coverage:** Comprehensive test suite at `src/memory/__tests__/shared-cache.test.ts`
- **Usage Example:**
  ```typescript
  // Store a decision
  cache.store('decision_key', 'We agreed to use LRU eviction', 'decision', 'Team consensus');
  
  // Retrieve it later
  const decision = cache.retrieve('decision_key');
  
  // Check stats
  const stats = cache.getStats();
  console.log(`Cache has ${stats.totalEntries} entries using ${stats.totalTokens} tokens`);
  ```
- **Read the code:** See comprehensive JSDoc in the file

---

## Team Structure

### Current Team (5 agents)
1. **Morgan** - Lead implementer, writes code
2. **Sam** - System architect, types/structure
3. **Jordan** - Security & ethics guardian
4. **Alex** - UX specialist
5. **Pierre** - Scope keeper, prevents feature creep

### Workflow
- **Order:** Morgan → Sam → Jordan → Alex → Pierre
- **Self-passing:** Can pass to yourself up to 3 times for multi-step work
- **Turn limit:** 6 turns per agent per cycle (adaptive based on productivity)

### Consensus Mode (if enabled)
- **Threshold:** 4/5 agents must signal "agree"
- **Signals:** agree | building | disagree
- **Transitions:** Discussion → Implementation when consensus reached

---

## Development Features

### Testing Infrastructure
- **Test Framework:** Vitest (configured)
- **Test Location:** `src/**/__tests__/*.test.ts`
- **Run Command:** `npm test` or `npx vitest`
- **Features:**
  - Fast execution with native ESM support
  - Jest-compatible API (describe, test, expect, beforeEach, etc.)
  - Built-in mocking with vi.spyOn(), vi.useFakeTimers()
  - Coverage reports available
- **Example Test Structure:**
  ```typescript
  import { describe, test, expect, beforeEach } from 'vitest';
  
  describe('MyFeature', () => {
    beforeEach(() => {
      // Setup before each test
    });
    
    test('should do something', () => {
      expect(result).toBe(expected);
    });
  });
  ```

### TypeScript Validation
- **Automatic:** Every fileWrite and fileEdit
- **Command:** `npx tsc --noEmit`
- **Timeout:** 30 seconds
- **On failure:**
  - Changes NOT applied
  - Failed file saved to `.failed.{timestamp}.ts`
  - Error message shown to next agent

### Cost Tracking
- **Per-agent:** Costs and token usage tracked individually
- **Persistent:** Survives across runs
- **Models:** Sonnet 4.5 (~$0.15-0.20 per cycle)
- **Output:** `data/summaries/costs_summary.csv`

### Version System
- **Format:** `v0.1.MMDDYY.HHMMSS`
- **Example:** `v0.1.011026.143522`

---

## What You Can Change

See `docs/AGENT_GUIDE.md` for details on:
- Modifying agent roles & personalities
- Adding new team members
- Changing models (sonnet/haiku/opus)
- Altering orchestrator behavior
