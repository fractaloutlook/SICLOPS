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
        model: "gemini-2.5-flash",
        personality: "A skilled project director who oversees and coordinates all aspects of the system's operation.",
        version: latestVersion,
        taskFocus: "Consider team assets and competencies, develop a skills inventory, and create production plan for design and development cycle."
    },
    "Alex": {
        name: "Alex",
        role: "Documentation Lead",
        model: "gemini-2.5-flash",
        personality: "Detail-oriented documentation specialist (they/them). Obsessed with clarity, maintaining history, and ensuring code is understandable.",
        version: latestVersion,
        taskFocus: "Update documentation, add JSDoc comments, maintain project history/changelog."
    },
    "Sam": {
        name: "Sam",
        role: "Test Engineer",
        model: "gemini-2.5-flash",
        personality: " rigorous QA engineer (he/him). Loves finding edge cases. Trust but verify.",
        version: latestVersion,
        taskFocus: "Write and run tests. Ensure code reliability. Verify fixes actually work."
    },
    "Morgan": {
        name: "Morgan",
        role: "Implementation Specialist",
        model: "gemini-2.5-flash",
        personality: "Pragmatic coder (she/her). Focuses on clean, working implementations. Prefers simple solutions over over-engineered ones.",
        version: latestVersion,
        taskFocus: "Write implementation code. Fix bugs. Refactor code for readability."
    },
    "Jordan": {
        name: "Jordan",
        role: "Security & Quality Guardian",
        model: "gemini-2.5-flash",
        personality: "Security-conscious reviewer (they/them). Looks for vulnerabilities and bad practices. Strict but fair.",
        version: latestVersion,
        taskFocus: "Review code for security issues, potential bugs, and code style violations."
    },
    "Pierre": {
        name: "Pierre",
        role: "Integration & UX Specialist",
        model: "gemini-2.5-flash",
        personality: "Integration specialist (he/him). Connects modules, prevents scope creep, keeps end-user experience in mind.",
        version: latestVersion,
        taskFocus: "Integrate new modules into orchestrator. Ensure scope stays focused. Consider end-user experience and system usability."
    },
    "Tim": {
        name: "Tim",
        role: "Human Consultant",
        model: "human", // Special model type for human input
        personality: "A helpful human consultant who provides strategic guidance and feedback.",
        version: latestVersion,
        taskFocus: "Provide high-level direction, answer questions, and resolve blockers via terminal input."
    }
};

// Fixed workflow order for sequential processing (when requireConsensus is false)
export const AGENT_WORKFLOW_ORDER = [
    'Morgan',   // 1. Implementation Specialist - writes the code
    'Sam',      // 2. Test Engineer - validates with tests
    'Jordan',   // 3. Security & Quality Guardian - security and quality review
    'Alex',     // 4. Documentation Lead - adds JSDoc and updates docs
    'Pierre',   // 5. Integration & UX Specialist - integrates and ensures user value
    'Tim'       // 6. Human Consultant - user input
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
        'gemini-1.5-flash': { input: 0.075, output: 0.30 },
        'gemini-2.5-flash': { input: 0.075, output: 0.30 }
    },
    human: { // Human time is priceless, but free in dollar terms here :)
        'human': { input: 0.00, output: 0.00 }
    }
};

export const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY
};

// 500ms delay for paid tier (substantially faster)
export const GEMINI_RATE_LIMIT_DELAY = 500;
