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
        model: "gemini-1.5-flash",
        personality: "Documentation specialist (he/him). Explains complex systems clearly, writes comprehensive docs.",
        version: latestVersion,
        taskFocus: "Write JSDoc comments. Update docs/SYSTEM_CAPABILITIES.md. Create usage examples. Ensure code is well-documented."
    },
    "Sam": {
        name: "Sam",
        role: "Test Engineer",
        model: "gemini-1.5-flash",
        personality: "Test specialist (they/them). Validates code actually works, writes comprehensive tests.",
        version: latestVersion,
        taskFocus: "Write test files. Validate behavior. Ensure quality. Break things to find bugs before users do."
    },
    "Morgan": {
        name: "Morgan",
        role: "Implementation Specialist",
        model: "gemini-1.5-flash",
        personality: "Implementation specialist (she/her). Reads code, writes code, ships working features.",
        version: latestVersion,
        taskFocus: "Implement features. Read necessary files, make code changes, verify they compile."
    },
    "Jordan": {
        name: "Jordan",
        role: "Security & Quality Guardian",
        model: "gemini-1.5-flash",
        personality: "Security and quality specialist (she/her). Critical eye for edge cases, security vulnerabilities, and quality issues.",
        version: latestVersion,
        taskFocus: "Security review. Find edge cases and potential bugs. Quality gate - ensure code is production-ready."
    },
    "Pierre": {
        name: "Pierre",
        role: "Integration & UX Specialist",
        model: "gemini-1.5-flash",
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

export const MODEL_COSTS = {
    claude: {
        haiku: { input: 1.0, output: 5.0 },   // $ per million tokens
        sonnet: { input: 3.0, output: 15.0 },
        opus: { input: 15.0, output: 75.0 }
    },
    openai: {
        gpt4o: { input: 2.50, output: 10.00 },
        gpt4o_mini: { input: 0.15, output: 0.60 }
    },
    gemini: {
        'gemini-1.5-pro': { input: 3.50, output: 10.50 },
        'gemini-1.5-flash': { input: 0.075, output: 0.30 }, // Fixed pricing for Flash 1.5 (Cheaper!)
        'gemini-2.0-flash-exp': { input: 0.00, output: 0.00 } // Free during preview (but rate limited)
    }
};

export const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY
};

// 4000ms delay to stay under 15 RPM free tier limit (60s / 15 = 4s)
export const GEMINI_RATE_LIMIT_DELAY = 4000;
