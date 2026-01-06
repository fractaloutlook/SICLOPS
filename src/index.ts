

import { Orchestrator } from './orchestrator';
import path from 'path';

async function main() {
    const orchestrator = new Orchestrator({
        maxCycles: 1,
        logDirectory: path.join(__dirname, '../data/logs'),
        costSummaryPath: path.join(__dirname, '../data/summaries/costs_summary.csv'),
        simulationMode: false, // Running with real API calls
        conversationMode: true // Team discussion mode
    });

    try {
        await orchestrator.runCycles();

        // Print cost summary
        const summary = orchestrator.getCostSummary();
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('💰 RUN COST SUMMARY');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`This run:   $${summary.thisRun.toFixed(4)}`);
        console.log(`All time:   $${summary.allTime.toFixed(4)}`);
        console.log(`Remaining:  ~${summary.estimatedRunsLeft} runs (budget $${summary.budget.toFixed(2)})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log('All cycles completed successfully');
    } catch (error) {
        console.error('Error running cycles:', error);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
