# Orchestrator Handoff Design

**Goal**: Enable continuous self-improvement across multiple orchestrator instances without manual intervention.

**Status**: Design phase - not yet implemented

---

## Vision

```
Cycle 1: Team discusses what to build
         ↓
         Orchestrator decides changes are ready
         ↓
         Writes context file + spawns new orchestrator
         ↓
Cycle 2: New orchestrator reads context + continues discussion
         ↓
         Eventually: Apply code changes to disk
         ↓
         Restart with new code + continue
```

---

## Architecture

### 1. Context File (`data/state/orchestrator-context.json`)

**Purpose**: Durable state that survives orchestrator restarts

**Structure**:
```json
{
  "version": "v1.0",
  "runNumber": 3,
  "startedAt": "2026-01-06T12:00:00Z",
  "lastUpdated": "2026-01-06T12:05:00Z",

  "currentPhase": "discussion" | "code_review" | "apply_changes" | "testing",

  "discussionSummary": {
    "topic": "Implementing SharedMemoryCache for agent context",
    "keyDecisions": [
      "Use token-aware caching with 50k limit",
      "Add security classifications",
      "Implement priority-based pruning"
    ],
    "consensusReached": false,
    "consensusSignals": {
      "Alex": "building",
      "Sam": "building",
      "Morgan": "agree",
      "Jordan": "building",
      "Pierre": "agree"
    }
  },

  "codeChanges": [
    {
      "file": "src/memory-cache.ts",
      "action": "create",
      "content": "... full TypeScript code ...",
      "appliedAt": null,
      "validatedAt": null,
      "status": "pending" | "applied" | "validated" | "failed"
    }
  ],

  "agentStates": {
    "Alex": {
      "timesProcessed": 4,
      "totalCost": 0.05,
      "canProcess": true
    },
    "Sam": { ... },
    ...
  },

  "nextAction": {
    "type": "continue_discussion" | "apply_changes" | "restart_with_new_code" | "manual_review",
    "reason": "Consensus not yet reached, continue discussion",
    "targetAgent": "Jordan"
  },

  "history": [
    {
      "runNumber": 1,
      "phase": "discussion",
      "summary": "Initial brainstorming on context persistence",
      "cost": 0.15
    },
    {
      "runNumber": 2,
      "phase": "discussion",
      "summary": "Converged on SharedMemoryCache design",
      "cost": 0.18
    }
  ],

  "totalCost": 0.33,
  "humanNotes": "User wants to see this implemented before moving to next feature"
}
```

---

### 2. Orchestrator Lifecycle

#### Phase A: Startup

```typescript
async start() {
  // Check if context file exists
  const context = await this.loadContext();

  if (context) {
    // RESUMING from previous run
    console.log(`📖 Resuming run #${context.runNumber + 1}`);
    console.log(`   Last phase: ${context.currentPhase}`);
    console.log(`   Next action: ${context.nextAction.type}`);

    // Restore agent states
    this.restoreAgentStates(context.agentStates);

    // Continue based on nextAction
    await this.handleNextAction(context);
  } else {
    // FRESH START
    console.log(`🆕 Starting fresh run #1`);
    await this.initializeContext();
    await this.runCycle();
  }
}
```

#### Phase B: During Cycle

```typescript
async runCycle() {
  // ... existing cycle logic ...

  // After each agent processes:
  await this.updateContext({
    agentStates: this.getAgentStates(),
    discussionSummary: this.summarizeDiscussion(),
    consensusSignals: this.consensusSignals
  });

  // Check if we should hand off
  if (this.shouldHandOff()) {
    await this.prepareHandoff();
    return;
  }
}
```

#### Phase C: Handoff Decision

```typescript
shouldHandOff(): boolean {
  // Handoff when:
  // 1. Consensus reached (4/5 agents agree)
  // 2. All agents hit processing limit
  // 3. Code changes ready to apply
  // 4. Manual intervention needed

  if (this.consensusReached()) {
    return true;
  }

  if (this.allAgentsExhausted()) {
    return true;
  }

  if (this.codeReadyToApply()) {
    return true;
  }

  return false;
}
```

#### Phase D: Prepare Handoff

```typescript
async prepareHandoff() {
  console.log(`\n🔄 Preparing handoff to next orchestrator...`);

  // 1. Update context file with final state
  const context = await this.loadContext();
  context.currentPhase = this.determineNextPhase();
  context.nextAction = this.determineNextAction();
  context.runNumber += 1;
  await this.saveContext(context);

  // 2. Generate narrative summary
  await this.generateNarrativeSummary();

  // 3. Generate briefing for next orchestrator
  const briefing = this.generateBriefing(context);
  console.log('\n📋 Briefing for next orchestrator:');
  console.log(briefing);

  // 4. Spawn next orchestrator
  await this.spawnNextOrchestrator();

  // 5. Die gracefully
  console.log(`\n💀 Orchestrator #${context.runNumber - 1} shutting down...`);
  process.exit(0);
}
```

#### Phase E: Spawn Next Instance

```typescript
async spawnNextOrchestrator() {
  // Option A: External script keeps restarting (RECOMMENDED)
  // Just exit and let external loop call `npm start` again
  console.log(`\n🚀 External loop will spawn next orchestrator...`);

  // Option B: Self-spawn (more complex)
  // const { spawn } = require('child_process');
  // spawn('npm', ['start'], { detached: true, stdio: 'inherit' });
}
```

---

### 3. External Loop Script (`run-continuous.sh`)

**Purpose**: Keep orchestrator running across restarts

```bash
#!/bin/bash

# run-continuous.sh - Keeps SICLOPS running in continuous mode

MAX_RUNS=10  # Safety limit
RUN_COUNT=0

echo "🔁 Starting SICLOPS in continuous mode (max $MAX_RUNS runs)"

while [ $RUN_COUNT -lt $MAX_RUNS ]; do
  RUN_COUNT=$((RUN_COUNT + 1))
  echo ""
  echo "════════════════════════════════════════"
  echo "  RUN #$RUN_COUNT"
  echo "════════════════════════════════════════"

  npm start
  EXIT_CODE=$?

  # Check if context file exists
  if [ ! -f "data/state/orchestrator-context.json" ]; then
    echo "⚠️  No context file found - stopping"
    break
  fi

  # Check nextAction type
  NEXT_ACTION=$(jq -r '.nextAction.type' data/state/orchestrator-context.json)

  if [ "$NEXT_ACTION" = "manual_review" ]; then
    echo "🛑 Manual review required - stopping"
    break
  fi

  if [ "$NEXT_ACTION" = "apply_changes" ]; then
    echo "📝 Applying code changes..."
    # TODO: Call code application script
  fi

  echo ""
  echo "⏳ Waiting 2 seconds before next run..."
  sleep 2
done

echo ""
echo "✅ Continuous mode completed after $RUN_COUNT runs"
```

---

### 4. Briefing Generation

**Purpose**: Human-readable summary for next orchestrator (and for humans!)

```typescript
generateBriefing(context: OrchestratorContext): string {
  return `
BRIEFING FOR ORCHESTRATOR RUN #${context.runNumber}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PREVIOUS RUN SUMMARY:
${context.history[context.history.length - 1]?.summary || 'First run'}

CURRENT PHASE: ${context.currentPhase}

DISCUSSION TOPIC:
${context.discussionSummary.topic}

KEY DECISIONS SO FAR:
${context.discussionSummary.keyDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

CONSENSUS STATUS:
${Object.entries(context.discussionSummary.consensusSignals)
  .map(([agent, signal]) => `- ${agent}: ${signal}`)
  .join('\n')}

NEXT ACTION: ${context.nextAction.type}
Reason: ${context.nextAction.reason}

AGENT STATES:
${Object.entries(context.agentStates)
  .map(([name, state]) => `- ${name}: ${state.timesProcessed} turns, $${state.totalCost.toFixed(4)}`)
  .join('\n')}

TOTAL COST SO FAR: $${context.totalCost.toFixed(4)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}
```

---

### 5. Code Application (Future Phase)

**Purpose**: Apply agent-generated code changes to actual source files

```typescript
async applyCodeChanges(context: OrchestratorContext) {
  console.log(`\n📝 Applying ${context.codeChanges.length} code changes...`);

  for (const change of context.codeChanges) {
    if (change.status === 'applied') continue;

    try {
      // 1. Backup original file
      if (change.action !== 'create') {
        await this.backupFile(change.file);
      }

      // 2. Apply change
      await this.applyChange(change);

      // 3. Validate TypeScript compilation
      const valid = await this.validateTypeScript();
      if (!valid) {
        console.log(`❌ ${change.file} failed validation`);
        await this.restoreBackup(change.file);
        change.status = 'failed';
        continue;
      }

      // 4. Mark as applied
      change.status = 'applied';
      change.appliedAt = new Date().toISOString();
      console.log(`✅ ${change.file} applied successfully`);

    } catch (error) {
      console.log(`❌ Error applying ${change.file}:`, error);
      change.status = 'failed';
    }
  }

  // Save updated context
  await this.saveContext(context);
}

async validateTypeScript(): Promise<boolean> {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsc', '--noEmit']);
    proc.on('exit', (code) => resolve(code === 0));
  });
}
```

---

## User Experience Flow

### Scenario: Manual Start (User initiates)

```bash
$ npm start
```

**What happens**:
1. Orchestrator checks for `data/state/orchestrator-context.json`
2. If exists: "📖 Resuming run #3..."
3. If not: "🆕 Starting fresh run #1"
4. Loads agent states, continues discussion
5. **Same experience** whether user or orchestrator spawned it

### Scenario: Continuous Mode

```bash
$ ./run-continuous.sh
```

**What happens**:
1. Loop spawns orchestrator repeatedly
2. Each run continues from previous state
3. Stops when:
   - Max runs reached (safety)
   - Manual review needed
   - No more work to do

---

## Token Efficiency Strategy

### Problem
Currently: Claude Code reads all logs to understand context → burns through daily context limits

### Solution: Self-Documenting Context

**Instead of this**:
```
Claude Code: *reads 50KB of logs*
Claude Code: *reads agent histories*
Claude Code: *reads cycle logs*
Claude Code: "Okay, I see the team discussed X..."
```

**Do this**:
```
Orchestrator: *writes human-readable briefing to context file*
Claude Code: *reads 2KB briefing*
Claude Code: "Got it, continuing from X..."
```

**Key insight**: The orchestrator should write **summaries, not raw logs**, so Claude Code doesn't need to parse everything.

---

## Phased Implementation Plan

### Phase 1: Basic State Persistence (C - Minimal Version)
- [ ] Create `data/state/` directory
- [ ] Implement `loadContext()` and `saveContext()`
- [ ] Update context after each agent turn
- [ ] Generate briefing at end of cycle
- [ ] Manual restart: read context and continue

**Result**: User can manually stop/start and context persists

### Phase 2: Automated Handoff
- [ ] Implement `shouldHandOff()` decision logic
- [ ] Implement `prepareHandoff()` and `spawnNextOrchestrator()`
- [ ] Create `run-continuous.sh` external loop
- [ ] Test continuous mode with 3-5 runs

**Result**: Orchestrator can spawn next instance automatically

### Phase 3: Code Application
- [ ] Implement `applyCodeChanges()`
- [ ] Add file backup/restore
- [ ] Add TypeScript validation
- [ ] Add git commit before/after changes

**Result**: System can modify its own source code

### Phase 4: Production Hardening
- [ ] Add error recovery
- [ ] Add rollback mechanisms
- [ ] Add human approval gates
- [ ] Optimize for minimal token usage

---

## Open Questions

1. **Should we use Opus 4.5 for the Director/Orchestrator role?**
   - More expensive but better reasoning
   - Could help with deciding when to hand off
   - Could help with code review decisions

2. **How many agents should touch the code?**
   - Current: 5 agents all discuss together
   - Alternative: 1-2 agents do focused work, others review
   - Concern: Over-engineering from too many cooks

3. **What triggers code application?**
   - Consensus reached?
   - Explicit "ready to implement" signal?
   - Human approval?

4. **How do we prevent infinite loops?**
   - Max runs per topic?
   - Cost ceiling?
   - Require human check-in every N runs?

---

## Security Considerations

### Guardrails Already in Place
- API cost limits (finite budget)
- Processing limits per agent (6 turns max)
- Manual intervention possible (stop script)

### Additional Guardrails Needed
- Code review before application
- File operation restrictions (no deletion unless explicit)
- Rollback capability (git-based)
- Human approval for:
  - Deleting files
  - Modifying core orchestrator logic
  - Installing new dependencies

### Jordan's Role (Updated)
- Focus on **critical risks only** in MVP mode
- Don't over-engineer safety
- Log appropriately for human review
- Trust API cost guardrails
- Ensure code won't delete things or do dangerous operations

---

## Success Metrics

**Phase 1 Success**:
- Context persists across manual restarts ✓
- No duplicate work when resuming ✓
- Claude Code doesn't need to read full logs ✓

**Phase 2 Success**:
- 5+ continuous cycles without human intervention ✓
- Orchestrator spawns correctly each time ✓
- Costs remain reasonable (< $5 per 10 cycles) ✓

**Phase 3 Success**:
- Code changes applied to disk correctly ✓
- TypeScript compiles after changes ✓
- System continues working after self-modification ✓

---

## Next Steps

1. **Implement Phase 1** (minimal state persistence)
2. **Test with manual restarts**
3. **Iterate based on learnings**
4. **Decide on Opus 4.5 for orchestrator**
5. **Move to Phase 2 when stable**

---

*Last updated: 2026-01-06*
*Status: Design phase - ready for implementation*
