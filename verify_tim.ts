
import { HumanAgent } from './src/human-agent';
import { AgentConfig, ProjectFile } from './src/types';

const mockConfig: AgentConfig = {
    name: "Tim",
    role: "Human Consultant",
    model: "human",
    personality: "Test",
    version: "1.0.0",
    taskFocus: "Testing"
};

async function test() {
    console.log("🚀 Starting Tim Test...");
    const tim = new HumanAgent(mockConfig, './data/logs');

    const mockFile: ProjectFile = {
        content: "Test content",
        currentStage: "development",
        history: []
    };

    const result = await tim.processFile(
        mockFile,
        ['Morgan', 'Sam'],
        "Previous history"
    );

    console.log("✅ Tim Result:", JSON.stringify(result, null, 2));
}

test();
