import * as path from 'path';
import * as fs from 'fs';

/**
 * Interface for a path validator.
 */
export interface PathValidator {
    /**
     * Validates if the given file path is safe for operations (e.g., within project bounds).
     * @param filePath The path to validate.
     * @returns True if the path is safe, false otherwise.
     * @throws Error if the path is unsafe or invalid.
     */
    validatePath(filePath: string): boolean;

    /**
     * Validates if the given path points to an existing file.
     * @param filePath The path to validate.
     * @returns True if it's an existing file, false otherwise.
     */
    isExistingFile(filePath: string): boolean;

    /**
     * Validates if the given path points to an existing directory.
     * @param dirPath The path to validate.
     * @returns True if it's an existing directory, false otherwise.
     */
    isExistingDirectory(dirPath: string): boolean;
}

/**
 * A path validator that ensures operations are within the project's root directory.
 */
export class ProjectPathValidator implements PathValidator {
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        // console.log(`ProjectPathValidator initialized with root: ${this.projectRoot}`); // Keep for potential debugging, but comment out for now.
    }

    /**
     * Validates if the given file path is within the project's root directory.
     * It also normalizes the path and checks for directory traversal attempts.
     * @param filePath The path to validate.
     * @returns True if the path is safe, false otherwise.
     * @throws Error if the path is outside the project root.
     */
    public validatePath(filePath: string): boolean {
        const absolutePath = path.resolve(filePath);

        // Ensure the path is within the project root
        if (!absolutePath.startsWith(this.projectRoot)) {
            throw new Error(`Path '${filePath}' resolves to '${absolutePath}' which is outside the project root '${this.projectRoot}'.`);
        }



        return true;
    }

    /**
     * Checks if a given path exists and is a file.
     * @param filePath The path to check.
     * @returns True if it's an existing file, false otherwise.
     */
    public isExistingFile(filePath: string): boolean {
        try {
            this.validatePath(filePath); // Ensure path is safe before checking existence
            const stats = fs.statSync(filePath);
            return stats.isFile();
        } catch (error) {
            // Path is invalid or outside project root, or file does not exist
            return false;
        }
    }

    /**
     * Checks if a given path exists and is a directory.
     * @param dirPath The path to check.
     * @returns True if it's an existing directory, false otherwise.
     */
    public isExistingDirectory(dirPath: string): boolean {
        try {
            this.validatePath(dirPath); // Ensure path is safe before checking existence
            const stats = fs.statSync(dirPath);
            return stats.isDirectory();
        } catch (error) {
            // Path is invalid or outside project root, or directory does not exist
            return false;
        }
    }
}
