/**
 * src/validation/path-validator.ts
 * Implements basic path validation logic for file operations within the SICLOPS framework.
 * This helps ensure that agents do not accidentally or maliciously modify critical system files.
 */

export class PathValidator {
    // A list of critical system files that should not be modified by agents.
    // This list can be expanded or externalized later.
    private criticalFiles: string[] = [
        'src/orchestrator.ts',
        'src/config.ts',
        'package.json',
        'tsconfig.json',
        'src/main.ts',
        'src/index.ts'
    ];

    constructor() {
        // Constructor for PathValidator. Currently no complex initialization needed.
    }

    /**
     * Validates if a given file path is allowed for modification (fileEdit).
     * @param filePath The path of the file to validate.
     * @returns True if the file path is valid for modification.
     * @throws Error if the file path refers to a critical system file, preventing modification.
     */
    public validatePathForModification(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/'); // Normalize path to use forward slashes

        if (this.criticalFiles.includes(normalizedPath)) {
            throw new Error(`Attempted to modify a critical system file: ${filePath}. This operation is forbidden.`);
        }

        // Add more sophisticated validation logic here in the future,
        // e.g., checking for restricted directories, file types, or permissions.

        return true;
    }

    /**
     * Validates if a given file path is allowed for reading (fileRead).
     * Reading is generally less restrictive than modification.
     * @param filePath The path of the file to validate.
     * @returns True if the file path is valid for reading.
     */
    public validatePathForRead(filePath: string): boolean {
        // Currently, all files are allowed to be read. Future versions might
        // implement checks for sensitive data or restricted access files.
        return true;
    }

    /**
     * Validates if a given file path is allowed for creation (fileWrite).
     * @param filePath The path of the file to validate.
     * @returns True if the file path is valid for creation.
     */
    public validatePathForCreation(filePath: string): boolean {
        // Future: Add checks to prevent creating files in critical directories
        // or with restricted names/extensions.
        return true;
    }
}
