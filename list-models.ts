
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

async function listModels() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ GOOGLE_API_KEY not found in .env');
        process.exit(1);
    }

    console.log('🔍 Listing available Gemini models via API...');
    console.log(`   (Using key: ${apiKey.substring(0, 8)}...)`);

    try {
        // Direct fetch to the models endpoint
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        console.log('\n✅ Available Models:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const models = (data as any).models || [];

        let foundGemini = false;

        models.forEach((m: any) => {
            if (m.name.includes('gemini')) {
                foundGemini = true;
                const name = m.name.replace('models/', '');
                console.log(`\x1b[36m${name}\x1b[0m`); // Cyan color
                console.log(`   ${m.description ? m.description.substring(0, 100) + '...' : 'No description'}`);
                console.log(`   Input limit: ${m.inputTokenLimit}`);
                console.log(`   Output limit: ${m.outputTokenLimit}`);
                console.log('   ------------------------------------');
            }
        });

        if (!foundGemini) {
            console.log('⚠️  No Gemini models found. This might be an API key scope issue.');
        }

    } catch (error) {
        console.error('❌ Error listing models:', error);
    }
}

listModels();
