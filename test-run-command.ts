
import { Orchestrator } from './src/orchestrator';
import { CommandRequest } from './src/types';

async function testRunCommand() {
    const orchestrator = new (Orchestrator as any)({
        maxCycles: 1,
        logDirectory: './data/logs',
        simulationMode: false
    });

    console.log('Testing handleRunCommand...');

    const request: CommandRequest = {
        action: 'run_command',
        command: 'echo "SICLOPS-TEST-SUCCESS"',
        reason: 'Verifying command execution capability'
    };

    try {
        // Accessing private method for testing
        const result = await (orchestrator as any).handleRunCommand(request, 'TestAgent');
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result.success && result.output.includes('SICLOPS-TEST-SUCCESS')) {
            console.log('✅ runCommand smoke test PASSED');
        } else {
            console.error('❌ runCommand smoke test FAILED');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error during smoke test:', error);
        process.exit(1);
    }
}

testRunCommand().catch(err => {
    console.error(err);
    process.exit(1);
});
