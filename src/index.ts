

import { Orchestrator } from './orchestrator';
import path from 'path';

async function main() {
    const orchestrator = new Orchestrator({
        maxCycles: 1,
        logDirectory: path.join(__dirname, '../data/logs'),
        costSummaryPath: path.join(__dirname, '../data/summaries/costs_summary.csv'),
        simulationMode: false // Running with real API calls
    });

    try {
        await orchestrator.runCycles();
        console.log('All cycles completed successfully');
    } catch (error) {
        console.error('Error running cycles:', error);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
