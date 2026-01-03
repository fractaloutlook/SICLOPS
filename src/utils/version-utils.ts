export function generateVersion(major: number = 0, minor: number = 1, counter: number = 0): string {
    const now = new Date();
    const datestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .slice(2, 8); // MMDDYY
    const timestamp = now.toISOString()
        .replace(/[-:.]/g, '')
        .slice(8, 14); // HHMMSS
    
    return `v${major}.${minor}.${datestamp}.${timestamp}${counter > 0 ? '.' + counter : ''}`;
}

export function parseVersion(version: string): {
    major: number;
    minor: number;
    datestamp: string;
    timestamp: string;
    counter?: number;
} {
    const regex = /v(\d+)\.(\d+)\.(\d{6})\.(\d{6})(?:\.(\d+))?/;
    const match = version.match(regex);
    
    if (!match) {
        throw new Error(`Invalid version format: ${version}`);
    }
    
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        datestamp: match[3],
        timestamp: match[4],
        counter: match[5] ? parseInt(match[5]) : undefined
    };
}
