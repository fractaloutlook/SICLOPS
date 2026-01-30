# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SICLOPS (Self-Improving Collective)** is an experimental multi-agent system where specialized AI agents collaborate on code development tasks. The system orchestrates agent interactions, tracks costs, and generates detailed logs of the development process.

This is a research/experimental project focused on testing agent interaction patterns. The current implementation is intentionally verbose and conversational to evaluate collaboration dynamics before optimizing for efficiency.

### Agent Team
- **Morgan** (Implementation Specialist): Core code implementation
- **Sam** (System Architect/QA): Architecture, safety, and test coverage
- **Jordan** (Security Guardian): Security review, guardrails, best practices
- **Alex** (UX Visionary): Developer experience, API design, documentation
- **Pierre** (Scope/ROI): Scope management, shipping priorities, integration
- **Tim** (Human Agent): Human-in-the-loop for command approval and oversight

## Development Commands

### Running the Application
```bash
npm start                    # Run with defaults (discussion mode)
npm start -- -c 5            # Run 5 cycles
npm start -- -noTim          # No human agent (auto-approve commands)
npm start -- -noHuman        # Fully autonomous mode
```
Runs the orchestrator which executes development cycles with the configured agents.

### TypeScript Compilation
```bash
npx tsc --noEmit             # Type-check only (what agents use)
npx tsc                      # Compile to dist/ (rarely needed)
```
Note: The project runs via `ts-node` — the `dist/` folder is NOT used at runtime. Do NOT rely on compiled JS in dist/.

### Tests
```bash
npx jest                     # Run all tests
npx jest --config jest.config.js path/to/test.ts  # Run specific test
```
Agents run tests internally via `runCycleTests()` in `src/utils/simple-test.ts`, which calls `npx jest` directly.

### Environment Setup
Create a `.env` file with:
```
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

## Architecture

### Core Components

**Orchestrator (`src/orchestrator.ts`)**
- Central coordinator that manages agent lifecycle and interactions
- Runs development cycles alternating between discussion and implementation phases
- Enforces phase rules: code edits blocked during discussion (notebooks always allowed)
- Tracks costs per cycle and generates summaries (JSON, CSV, and narrative)
- Persists state to `data/state/orchestrator-context.json` across runs
- Agent Handoff Protocol validates delegation targets via `isValidAgentName()`

**Agent System (`src/agent.ts`, `src/agent-base.ts`)**
- Each agent has a specific role, personality, and task focus (defined in `src/config.ts`)
- Agents process `ProjectFile` objects containing code and history
- Each agent gets up to 30 turns per cycle, with up to 3 self-passes for multi-step work
- Agents return structured JSON responses with changes, reasoning, and target agent
- Agent notebook contents are auto-injected into system prompts at spin-up
- Each API call is currently **stateless** — agents do not maintain conversation history between turns

**Type System (`src/types.ts`)**
- `ProjectFile`: Contains current code content, stage, and full history
- `Changes`: Separates prose descriptions from actual code changes
- `ProcessResult`: Agent response structure including changes, target, reasoning, and cost/token metrics

**Validation Pipeline (`src/validation/path-validator.ts`)**
- PathValidator enforces file access rules: allowed directories, extensions, sensitive files
- `src/utils/simple-test.ts` is protected from agent edits
- `src/config.ts` is NOT protected — agents need it for feature work
- TypeScript compilation validation (`tsc --noEmit`) runs on every code file edit
- ESLint validation runs after successful compilation

**Shared Memory (`src/memory/shared-cache.ts`)**
- 3-bucket LRU cache (decisions, context, patterns) for sharing context between agents
- Has `exportState()` / `importState()` for persistence to `data/state/shared-cache.json`
- 34 passing test cases in `src/memory/__tests__/shared-cache.test.ts`

### Agent Configuration

Agents are defined in `AGENT_CONFIGS` (`src/config.ts`):
Agent models can be configured as Claude models, OpenAI models, or Google Gemini models.
The system automatically routes to the appropriate API client.

### Data Flow

1. Orchestrator loads context from `orchestrator-context.json` and shared cache
2. Phase determines mode: discussion (consensus) or implementation (sequential)
3. Each agent receives: system prompt (with notebook contents) + user prompt (with recent history)
4. Agent returns JSON with file operations, reasoning, and next target agent
5. Orchestrator validates and executes file operations, then passes to next agent
6. At cycle end, context and shared cache are saved to disk

### Phase System

**Discussion Phase:**
- Agents debate and reach consensus on what to build next
- Consensus requires 4/5 agents signaling "agree"
- Code file edits are BLOCKED — only notebook edits allowed
- Agents must update notebooks before signaling consensus

**Implementation Phase:**
- Agents implement the agreed-upon feature
- Sequential workflow: Morgan → Sam → Jordan → Alex → Pierre
- Agents can delegate to specific team members or self-pass
- All file operations allowed (with PathValidator enforcement)

### Logging and Output

**Directory Structure:**
- `data/logs/cycles/`: Timestamped cycle logs
- `data/logs/agents/`: Timestamped per-agent logs
- `data/state/orchestrator-context.json`: Persistent orchestrator state
- `data/state/shared-cache.json`: Persistent shared memory cache
- `data/summaries/costs_summary.csv`: Detailed cost tracking
- `notes/*.md`: Per-agent notebooks (persistent across runs)

### Agent Notebooks

Each agent has a notebook at `notes/{name}-notes.md`:
- Auto-loaded into system prompt at each turn (no fileRead needed)
- Must be updated before consensus signals and phase transitions
- Serve as persistent memory across runs since API calls are stateless
- Agents can also read each other's notebooks via fileRead

## Important Implementation Details

### Stateless API Calls (Known Limitation)
Each agent API call sends a single user message with no conversation history. Agents do not remember their previous turns within a run. Context comes from:
- Summarized orchestrator history (text in prompt)
- Auto-loaded notebook contents
- Recent history (last 10 entries from ProjectFile.history)
- Orchestrator context (discussion summary, key decisions)

**Planned improvement:** Phase-level conversation threads to give agents memory within discussion/implementation phases.

### Cost Calculation
Pricing embedded in `agent.ts` (2025 rates):
- Claude 3.5 Haiku: $1/$5 per million tokens
- Claude 3.5 Sonnet: $3/$15 per million tokens
- Claude Opus 4.5: $5/$25 per million tokens
- GPT-4o-mini: $0.15/$0.60 per million tokens
- Gemini models: Free tier (rate-limited) or paid tier

### Current Limitations & Design Notes
- Agent API calls are stateless — no conversation memory between turns (notebooks compensate)
- Processing limits configurable per agent
- The `dist/` folder is NOT used at runtime — ts-node compiles from source
- Verbosity is intentional for evaluation — optimization deferred
- Error handling and validation are minimal by design (focus on interaction patterns first)

### Known Issues
- **Stale dist/ folder**: If `npx tsc` is ever run, it creates `dist/` with compiled JS that can become stale. The system uses `ts-node` and never reads from `dist/`. If in doubt, delete the `dist/` folder.
- **Failed file artifacts**: `.failed.ts` files accumulate from compilation failures. The `cleanupFailedFiles()` method handles these, or delete manually.

## Making Changes

### Adding a New Agent
1. Add agent config to `AGENT_CONFIGS` in `src/config.ts`
2. Specify model (Claude, OpenAI, or Gemini), role, personality, and taskFocus
3. Orchestrator will automatically initialize it

### Modifying Agent Prompts
Core prompt structure is in `agent.ts` (the `processFile` method). The prompt includes:
- Agent identity and personality (static, cached via prompt caching)
- Auto-loaded notebook contents
- Current file content and recent history
- Available target agents
- Phase rules and required JSON response format

### Adjusting Cycle Count
Use `-c N` flag: `npm start -- -c 5`
Or modify `maxCycles` in `index.ts`.

### Changing Processing Limits
Modify `canProcess()` return condition in `agent-base.ts`.

## Development Philosophy

- Interaction patterns take priority over optimization
- "Let's test it first" approach — validate before optimizing
- Conversational verbosity is temporary but necessary for evaluation
- Token efficiency addressed after solidifying interaction patterns
- Older logs preserved via timestamping for historical reference
