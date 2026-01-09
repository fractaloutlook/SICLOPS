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
        role: "UX Visionary",
        model: "claude-sonnet-4-5-20250929",
        personality: "User experience specialist (he/him). Reviews implementations from an agent usability perspective.",
        version: latestVersion,
        taskFocus: "Review features for agent usability. Ensure APIs are intuitive. Spot confusing interfaces early."
    },
    "Sam": {
        name: "Sam",
        role: "System Architect",
        model: "claude-sonnet-4-5-20250929",
        personality: "Systems architect (they/them). Reviews code structure and identifies architectural issues.",
        version: latestVersion,
        taskFocus: "Review system architecture. Identify potential scaling or integration issues. Suggest structural improvements."
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
        role: "Guardian",
        model: "claude-sonnet-4-5-20250929",
        personality: "Safety reviewer (she/her). Checks for security issues and unsafe operations.",
        version: latestVersion,
        taskFocus: "Review code for safety issues. Check for dangerous operations, data leaks, or security problems."
    },
    "Pierre": {
        name: "Pierre",
        role: "Entrepreneur",
        model: "claude-sonnet-4-5-20250929",
        personality: "Scope reviewer (he/him). Ensures features stay focused and deliver clear value.",
        version: latestVersion,
        taskFocus: "Review feature scope. Ensure changes are necessary and well-defined. Spot scope creep early."
    }
};

// Fixed workflow order for sequential processing (when requireConsensus is false)
export const AGENT_WORKFLOW_ORDER = [
    'Morgan',   // 1. Implementation Specialist - writes the code
    'Sam',      // 2. System Architect - reviews architecture
    'Jordan',   // 3. Guardian - safety check
    'Alex',     // 4. UX Visionary - user experience review
    'Pierre'    // 5. Entrepreneur - final scope/value check
];

export const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY
};
