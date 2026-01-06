import fs from 'fs/promises';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

export class FileUtils {
    static async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch {
            await fs.mkdir(dirPath, { recursive: true });
        }
    }

    static async appendToLog(logPath: string, entry: any): Promise<void> {
        await this.ensureDirectoryExists(path.dirname(logPath));
        const logLine = `${JSON.stringify(entry)}\n`;
        await fs.appendFile(logPath, logLine, 'utf-8');
    }

    static async initializeLogFile(logPath: string): Promise<void> {
        await this.ensureDirectoryExists(path.dirname(logPath));
        await fs.writeFile(logPath, '', 'utf-8');
    }

    static async appendToCsv(csvPath: string, records: any[]): Promise<void> {
        await this.ensureDirectoryExists(path.dirname(csvPath));
        
        const csvWriter = createObjectCsvWriter({
            path: csvPath,
            header: [
                { id: 'timestamp', title: 'Timestamp' },
                { id: 'cycleId', title: 'Cycle' },
                { id: 'agent', title: 'Agent' },
                { id: 'model', title: 'Model' },
                { id: 'operation', title: 'Operation' },
                { id: 'inputTokens', title: 'Input_Tokens' },
                { id: 'outputTokens', title: 'Output_Tokens' },
                { id: 'cost', title: 'Cost_USD' },
                { id: 'cycleTotalUSD', title: 'Cycle_Total_USD' }
            ],
            append: true
        });

        await csvWriter.writeRecords(records);
    }

    static async readLogFile(path: string): Promise<any[]> {
        try {
            const content = await fs.readFile(path, 'utf-8');
            return content
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line));
        } catch (error) {
            console.error(`Error reading log file ${path}:`, error);
            return [];
        }
    }

    static async writeFile(path: string, content: string): Promise<void> {
        await this.ensureDirectoryExists(path.substring(0, path.lastIndexOf('/')));
        await fs.writeFile(path, content, 'utf-8');
    }
    
    public static async readDir(dir: string): Promise<string[]> {
        try {
            return await fs.readdir(dir);
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
            return [];
        }
    }

    // Alias for ensureDirectoryExists
    static async ensureDir(dirPath: string): Promise<void> {
        return this.ensureDirectoryExists(dirPath);
    }

    // Read file contents as string
    static async readFile(filePath: string): Promise<string> {
        return await fs.readFile(filePath, 'utf-8');
    }

}
