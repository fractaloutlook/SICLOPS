
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.error('❌ GOOGLE_API_KEY not found');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
    console.log('🔍 Step 1: Listing models via REST API (v1beta)...');
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
            console.error(`❌ Failed to list models: ${response.status} ${response.statusText}`);
            return;
        }
        const data = await response.json();
        const models = (data as any).models || [];
        console.log(`✅ Found ${models.length} models.`);

        const geminiModels = models
            .filter((m: any) => m.name.includes('gemini') && m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));

        console.log('Gemini Candidates (generateContent supported):', geminiModels);

        console.log('\n🔍 Step 2: Testing generation with SDK...');

        // Add some hardcoded ones just in case
        const candidates = [...new Set([...geminiModels, 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'])];

        for (const name of candidates) {
            process.stdout.write(`Testing "${name}"... `);
            try {
                const model = genAI.getGenerativeModel({ model: name });
                const result = await model.generateContent('Hi');
                console.log(`✅ SUCCESS!`);

                // Write to file
                const fs = require('fs');
                fs.appendFileSync('working_models.txt', `${name}\n`);
                return; // Stop after first success? No, let's find all working ones but we really just need one.
            } catch (e: any) {
                if (e.message.includes('429')) {
                    console.log(`⚠️  Rate Limited (429) - but model EXISTS!`);
                    const fs = require('fs');
                    fs.appendFileSync('working_models.txt', `${name} (Rate Limit)\n`);
                } else {
                    console.log(`❌ Failed: ${e.message.split('\n')[0]}`);
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (e) {
        console.error('Fatal error:', e);
    }
}

run();
