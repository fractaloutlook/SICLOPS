

import { Orchestrator } from './orchestrator';
import path from 'path';

async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let humanComment: string | undefined;
    let maxCycles = 1; // Default to 1 cycle

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '-com' || args[i] === '--comment') && args[i + 1]) {
            humanComment = args[i + 1];
            i++; // Skip next arg since we used it
        } else if ((args[i] === '-c' || args[i] === '--cycles') && args[i + 1]) {
            maxCycles = parseInt(args[i + 1], 10);
            if (isNaN(maxCycles) || maxCycles < 1) {
                console.error('❌ Invalid cycle count. Must be a positive integer.');
                process.exit(1);
            }
            i++; // Skip next arg since we used it
        }
    }

    if (maxCycles > 1) {
        console.log(`\n🔄 Multi-cycle mode: Running ${maxCycles} cycles\n`);
    }

    const orchestrator = new Orchestrator({
        maxCycles,
        logDirectory: path.join(__dirname, '../data/logs'),
        costSummaryPath: path.join(__dirname, '../data/summaries/costs_summary.csv'),
        simulationMode: false, // Running with real API calls
        conversationMode: true, // Team discussion mode
        requireConsensus: false, // Disabled - consensus causes turn limit deadlocks
        humanComment // Pass human comment from command line
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
