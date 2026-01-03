# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SIC (Self-Improving Collective)** is an experimental multi-agent system where specialized AI agents (UX Visionary, System Architect, Implementation Specialist, and Guardian) collaborate on code development tasks. The system orchestrates agent interactions, tracks costs, and generates detailed logs of the development process.

This is a research/experimental project focused on testing agent interaction patterns. The current implementation is intentionally verbose and conversational to evaluate collaboration dynamics before optimizing for efficiency.

## Development Commands

### Running the Application
```bash
npm start
```
Runs the orchestrator which executes development cycles with the configured agents.

### TypeScript Compilation
```bash
npx tsc
```
Compiles TypeScript files to the `dist/` directory. Note: The project typically runs via `ts-node` without explicit compilation.

### Environment Setup
Create a `.env` file with:
```
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

## Architecture

### Core Components

**Orchestrator (`src/orchestrator.ts`)**
- Central coordinator that manages agent lifecycle and interactions
- Runs development cycles where agents sequentially process and modify code
- Tracks costs per cycle and generates summaries (JSON, CSV, and narrative)
- Supports simulation mode (`simulationMode: true`) to test without API calls

**Agent System (`src/agent.ts`, `src/agent-base.ts`)**
- Each agent has a specific role, personality, and task focus (defined in `src/config.ts`)
- Agents process `ProjectFile` objects containing code and history
- Each agent can process up to 2 times per session (see `canProcess()` in `agent-base.ts:40`)
- Agents return structured `ProcessResult` with changes, reasoning, and target agent

**Type System (`src/types.ts`)**
- `ProjectFile`: Contains current code content, stage, and full history
- `Changes`: Separates prose descriptions from actual code changes
  - `description`: Human-readable explanation
  - `code`: Actual TypeScript implementation
  - `location`: File/class/method being modified
- `ProcessResult`: Agent response structure including changes, target, reasoning, and cost/token metrics

### Agent Configuration

Agents are defined in `AGENT_CONFIGS` (`src/config.ts:10-51`):
- **Director**: Project coordinator (currently not in processing loop)
- **UX Visionary**: Feature design and user-facing API
- **System Architect**: Type structure and architecture design
- **Implementation Specialist**: Code implementation
- **Guardian**: Security and ethics review

Agent models can be configured as either Claude models (`claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`) or OpenAI models (`gpt-4o-mini`). The system automatically routes to the appropriate API client.

### Data Flow

1. Orchestrator initializes a `ProjectFile` with initial code
2. First agent (typically UX Visionary) receives the file
3. Agent calls API (Claude or OpenAI) with structured prompt
4. Agent returns `ProcessResult` with changes and next target agent
5. Changes are applied to `ProjectFile.content` and added to history
6. Process repeats with target agent until no available agents remain

### Logging and Output

**Directory Structure:**
- `data/logs/cycles/`: Timestamped cycle logs
- `data/logs/agents/`: Timestamped per-agent logs
- `data/logs/narrative_summary.md`: Human-readable development narrative
- `data/logs/final_summary.json`: Agent statistics summary
- `data/summaries/costs_summary.csv`: Detailed cost tracking

**Version System:**
Versions follow format: `v0.1.MMDDYY.HHMMSS` (see `src/utils/version-utils.ts`)

## Important Implementation Details

### Code vs. Description Separation
The system explicitly separates what agents *describe* (prose) from what they *implement* (code):
- `Changes.description`: What the agent says they did
- `Changes.code`: The actual TypeScript code
- Prompt in `agent.ts:106-112` enforces that agents MUST provide actual code, not just descriptions

### Simulation Mode
When `simulationMode: true` in orchestrator config:
- Uses predefined responses (`getSimulatedAgentResponse()` in `orchestrator.ts:370-666`)
- No API calls made (zero cost)
- Useful for testing orchestration logic

### Cost Calculation
Pricing embedded in `agent.ts:196-208` (2025 rates):
- Claude 3.5 Haiku: $1/$5 per million tokens ($0.000001 input, $0.000005 output)
- Claude 3.5 Sonnet: $3/$15 per million tokens ($0.000003 input, $0.000015 output)
- Claude Opus 4.5: $5/$25 per million tokens ($0.000005 input, $0.000025 output)
- GPT-4o-mini: $0.15/$0.60 per million tokens ($0.00000015 input, $0.0000006 output)

### Current Limitations & Design Notes
- Agent memory resets between runs (no persistence)
- Processing limited to 2 cycles per agent per session
- The UserPreferences class example in code is purely for testing agent interactions
- Verbosity is intentional for evaluation - optimization deferred
- Error handling and validation are minimal by design (focus on interaction patterns first)

## Making Changes

### Adding a New Agent
1. Add agent config to `AGENT_CONFIGS` in `src/config.ts`
2. Specify model (Claude or OpenAI), role, personality, and taskFocus
3. Orchestrator will automatically initialize it

### Modifying Agent Prompts
Core prompt structure is in `agent.ts:90-112`. The prompt includes:
- Agent identity and personality
- Current file content
- Full history of changes
- Available target agents
- Required JSON response format

### Adjusting Cycle Count
Modify `maxCycles` in `index.ts:8` (currently set to 1).

### Changing Processing Limits
Modify `canProcess()` return condition in `agent-base.ts:40` (currently `< 2`).

## Development Philosophy

From `project-state-012125.md`:
- Interaction patterns take priority over optimization
- "Let's test it first" approach - validate before optimizing
- Conversational verbosity is temporary but necessary for evaluation
- Token efficiency addressed after solidifying interaction patterns
- Older logs preserved via timestamping for historical reference
