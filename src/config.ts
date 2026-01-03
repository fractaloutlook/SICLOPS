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
        model: "claude-3-5-haiku-20241022",
        personality: "A skilled project director who oversees and coordinates all aspects of the system's operation.",
        version: latestVersion,
        taskFocus: "Consider team assets and competencies, develop a skills inventory, and create production plan for design and development cycle."
    },
    "UX Visionary": {
        name: "UX Visionary",
        role: "UX and Features Designer",
        model: "claude-3-5-haiku-20241022",
        personality: "An imaginative and user-focused designer who thinks deeply about feature implications.",
        version: latestVersion,
        taskFocus: "Define user-facing API, ensure intuitive usage patterns, specify requirements for theme and notification handling."
    },
    "System Architect": {
        name: "System Architect",
        role: "Systems Designer/Architect",
        model: "claude-3-5-haiku-20241022",
        personality: "A methodical and thorough systems architect who carefully analyzes each aspect of the design.",
        version: latestVersion,
        taskFocus: "Design type structure, data flow, and system architecture. Ensure type safety and extensibility."
    },
    "Implementation Specialist": {
        name: "Implementation Specialist",
        role: "Code Implementer",
        model: "claude-3-5-haiku-20241022",
        personality: "A precise and efficient coder who ensures robust implementation of features.",
        version: latestVersion,
        taskFocus: "Implement the designed features, focusing on clean code, error handling, and performance."
    },
    "Guardian": {
        name: "Guardian",
        role: "Security and Ethics Checker",
        model: "claude-3-5-haiku-20241022",
        personality: "A careful and conscientious reviewer who considers all safety and ethical implications.",
        version: latestVersion,
        taskFocus: "Review for security issues, data privacy concerns, input validation, and potential misuse vectors."
    }
};

export const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY
};
