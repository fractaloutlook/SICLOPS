/**
 * Configuration file for the SICLOPS multi-agent system.
 * 
 * Defines agent personalities, roles, models, and workflow order.
 * Loads API keys from environment variables via dotenv.
 * 
 * Each agent has:
 * - name: Display name
 * - role: Job title/function
 * - model: Claude model version to use
 * - personality: Character description for prompting
 * - version: Release version tracking
 * - taskFocus: Core responsibilities
 */
import dotenv from 'dotenv';
import { AgentConfig } from './types';

dotenv.config();

const initialVersion = 'v0.1.111924.001200';
const lastVersion = 'v0.1.111924.001200';
const latestVersion = 'v0.1.112224.000200';

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
    orchestrator: {
        name: "Director",
        role: "Project Director",
        model: "claude-sonnet-4-5-20250929",
        personality: "A skilled project director who oversees and coordinates all aspects of the system's operation.",
        version: latestVersion,
        taskFocus: "Consider team assets and competencies, develop a skills inventory, and create production plan for design and development cycle."
    },
    "Alex": {
        name: "Alex",
        role: "Documentation Lead",
        model: "claude-sonnet-4-5-20250929",
        personality: "Documentation specialist (he/him). Explains complex systems clearly, writes comprehensive docs.",
        version: latestVersion,
        taskFocus: "Write JSDoc comments. Update docs/SYSTEM_CAPABILITIES.md. Create usage examples. Ensure code is well-documented."
    },
    "Sam": {
        name: "Sam",
        role: "Test Engineer",
        model: "claude-sonnet-4-5-20250929",
        personality: "Test specialist (they/them). Validates code actually works, writes comprehensive tests.",
        version: latestVersion,
        taskFocus: "Write test files. Validate behavior. Ensure quality. Break things to find bugs before users do."
    },
    "Morgan": {
        name: "Morgan",
        role: "Implementation Specialist",
        model: "claude-sonnet-4-5-20250929",
        personality: "Implementation specialist (she/her). Reads code, writes code, ships working features.",
        version: latestVersion,
        taskFocus: "Implement features. Read necessary files, make code changes, verify they compile."
    },
    "Jordan": {
        name: "Jordan",
        role: "Security & Quality Guardian",
        model: "claude-sonnet-4-5-20250929",
        personality: "Security and quality specialist (she/her). Critical eye for edge cases, security vulnerabilities, and quality issues.",
        version: latestVersion,
        taskFocus: "Security review. Find edge cases and potential bugs. Quality gate - ensure code is production-ready."
    },
    "Pierre": {
        name: "Pierre",
        role: "Integration & UX Specialist",
        model: "claude-sonnet-4-5-20250929",
        personality: "Integration specialist (he/him). Connects modules, prevents scope creep, keeps end-user experience in mind.",
        version: latestVersion,
        taskFocus: "Integrate new modules into orchestrator. Ensure scope stays focused. Consider end-user experience and system usability."
    }
};

// Fixed workflow order for sequential processing (when requireConsensus is false)
export const AGENT_WORKFLOW_ORDER = [
    'Morgan',   // 1. Implementation Specialist - writes the code
    'Sam',      // 2. Test Engineer - validates with tests
    'Jordan',   // 3. Security & Quality Guardian - security and quality review
    'Alex',     // 4. Documentation Lead - adds JSDoc and updates docs
    'Pierre'    // 5. Integration & UX Specialist - integrates and ensures user value
];

export const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY
};
