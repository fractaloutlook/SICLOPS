# Tool Usage Guide for SICLOPS

## New Command-Line Tools

### 1. TypeScript Compilation Check (`tsCompileTest.bat`)

Quick TypeScript validation without generating files.

**Usage:**
```bash
# Check entire project
tsCompileTest.bat

# Check specific file
tsCompileTest.bat src/agent.ts
tsCompileTest.bat src/orchestrator.ts
```

**Output:**
- ✅ Success: "TypeScript compilation successful - no errors found"
- ❌ Failure: Shows TypeScript errors

### 2. Multi-Cycle Runner (`runMultipleCycles.bat`)

Run multiple agent cycles with automatic summary generation.

**Usage:**
```bash
# Run 3 cycles (default)
runMultipleCycles.bat

# Run 10 cycles
runMultipleCycles.bat 10

# Run 5 cycles with comment
runMultipleCycles.bat 5 "Focus on testing SharedMemoryCache"
```

**What it does:**
- Runs N consecutive cycles
- Logs each cycle individually (as normal)
- Creates a top-level summary: `data/logs/multi-cycle-summary-YYYYMMDD-HHMMSS.md`
- Shows start/end times and status of each cycle
- Pauses 2 seconds between cycles

### 3. NPM Start with Cycle Count

You can now specify cycles directly via npm:

**Usage:**
```bash
# Run 1 cycle (default)
npm start

# Run 5 cycles
npm start -- --cycles 5
npm start -- -c 5

# Run 3 cycles with comment
npm start -- -c 3 --comment "Test the new feature"
```

**Note:** The `--` after `npm start` is required to pass arguments through to the script.

## Token Savings with Bat Files

**Question:** Do .bat files reduce token usage?

**Answer:** YES! Significantly.

### Token Cost Comparison:

**Using Bash directly:**
```
Prompt: "Check TypeScript compilation"
Command: npx tsc --noEmit 2>&1 | grep "error" | head -20
Tokens: ~50-100 for command + 200-1000 for output = 250-1100 total
```

**Using .bat file:**
```
Prompt: "Check TypeScript compilation"
Command: ./tsCompileTest.bat
Tokens: ~10 for command + 50-200 for output = 60-210 total
```

**Savings:** 60-80% reduction in tokens for repeated tasks!

### When to Use Bat Files:

✅ **Use bat files for:**
- Repeated operations (TypeScript checks, testing, building)
- Multi-step workflows (run → test → commit)
- Complex commands with many flags
- Tasks you do 3+ times per session

❌ **Don't use bat files for:**
- One-off exploratory commands
- Dynamic commands with changing parameters
- Simple single commands (like `ls` or `cat`)

## PowerShell vs CMD for Claude Code

**Question:** Does running Claude Code from PowerShell help?

**Answer:** Not really. The Bash tool spawns processes independently regardless of the parent shell. However:

- **PowerShell**: Better tab-completion, modern scripting
- **CMD**: More compatible with legacy .bat files
- **For Claude**: Makes no difference - I spawn fresh bash/cmd processes

## Linux Server Integration

Your Linux server (2 vCPU, 12GB RAM) could be useful for:

1. **Always-on agent services** - Background agents that monitor/respond
2. **SpaceTimeDB hosting** - Central database for agent state
3. **Test environment** - Run integration tests without affecting dev machine
4. **Git server** - Local git hosting for agent experiments
5. **MCP server hosting** - Run MCP servers for agent access

### Potential Architecture:

```
┌─────────────────────────────────────────┐
│ Your Dev Machine (Windows)              │
│  - SICLOPS orchestrator                 │
│  - Local development                    │
│  - Agent code execution                 │
└─────────────────┬───────────────────────┘
                  │
                  ↓ API calls / DB queries
┌─────────────────────────────────────────┐
│ Linux Server (Always-On)                │
│  - SpaceTimeDB (user state, history)   │
│  - MCP servers (persistent tools)       │
│  - Long-running agent services          │
│  - Integration test suite               │
└─────────────────────────────────────────┘
```

This way agents can:
- Store long-term memory in SpaceTimeDB
- Access persistent tools via MCP
- Run background tasks on the server
- Your dev machine stays clean for active work

---

**TIP:** Create more .bat files as you find repeated patterns. They're cheap to make and save lots of tokens over time!
