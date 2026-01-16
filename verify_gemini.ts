
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

async function test(name: string) {
    console.log(`\n----------------------------------------`);
    console.log(`Testing "${name}"...`);
    try {
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent('Hi');
        console.log(`✅ SUCCESS! Response: ${result.response.text().trim()}`);
    } catch (e: any) {
        console.log(`❌ FAILED: ${e.message.split('\n')[0]}`); // Print first line of error
    }
}

async function run() {
    await test('gemini-1.5-flash');
    await test('models/gemini-1.5-flash');
    await test('gemini-1.5-flash-001');
    await test('gemini-1.5-flash-002'); // Newer version?
    await test('gemini-2.0-flash-exp');
}

run();
