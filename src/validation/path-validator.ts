import * as path from 'path';
import * as fs from 'fs';

/**
 * Custom error class for path validation failures.
 */
export class PathValidationError extends Error {
  /**
   * Creates an instance of PathValidationError.
   * @param message - The error message.
   * @param path - Optional: The path that caused the validation error.
   */
  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Static PathValidator class (System-required for Orchestrator stability).
 */
export class PathValidator {
  /**
   * Defines the top-level directories where file operations are permitted.
   */
  private static ALLOWED_ROOT_DIRECTORIES = ['src', 'notes', 'docs', 'tests', 'data'];
  /**
   * Defines the file extensions that are allowed for file operations.
   */
  private static ALLOWED_EXTENSIONS = ['.ts', '.md', '.json', '.js'];

  // Critical system files are protected from accidental modification, 
  /**
   * Defines a list of critical system files that are protected from accidental modification.
   * Note: Agents need to be able to edit `orchestrator.ts` during implementation cycles,
   * but this array helps protect other critical files like `src/config.ts`.
   */
  private static SENSITIVE_SYSTEM_FILES = [
    'src/config.ts',
    'src/utils/simple-test.ts' // Protect the test runner from accidental 'fixes'
  ];

  /**
   * Validates a given file path against a set of security and structural rules.
   * This ensures that file operations are confined to expected areas and prevent malicious access.
   * @param filePath - The absolute or relative path to validate.
   * @returns `true` if the path is valid.
   * @throws {PathValidationError} if the path fails any validation rule.
   */
  public static validatePath(filePath: string): boolean {
    if (!filePath) {
      throw new PathValidationError('Path validation failed: File path cannot be empty.', filePath);
    }

    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');

    // 1. Prevent directory traversal attacks
    if (normalizedPath.includes('..')) {
      throw new PathValidationError(`Path validation failed: Path traversal attempt detected in path "${filePath}".`, filePath);
    }

    const pathParts = normalizedPath.split('/');
    const rootDir = pathParts.length > 1 ? pathParts[0] : ''; // Empty string for root-level files

    // 2. Check if the path is within allowed root directories
    // EXCEPTION: Allow specific root-level config files (package.json, eslint.config.js, tsconfig.json)
    const allowedRootFiles = ['package.json', 'eslint.config.js', 'tsconfig.json'];
    const isRootConfig = allowedRootFiles.includes(normalizedPath);

    if (!this.ALLOWED_ROOT_DIRECTORIES.includes(rootDir) && !isRootConfig) {
      throw new PathValidationError(`Path must be in allowed directories. Path "${filePath}" with root directory "${rootDir}" is not within an allowed root directory. Allowed: ${this.ALLOWED_ROOT_DIRECTORIES.join(', ')}.`, filePath);
    }

    // 3. Prevent modification of extremely sensitive files (config, etc.)
    if (this.SENSITIVE_SYSTEM_FILES.includes(normalizedPath)) {
      throw new PathValidationError(`Path validation failed: Attempt to modify sensitive system file "${filePath}" is disallowed.`, filePath);
    }

    // 4. Check for allowed file extensions
    const baseName = path.basename(normalizedPath);
    if (baseName.includes('.') && !baseName.startsWith('.')) {
      const fileExtension = path.extname(normalizedPath);
      if (!this.ALLOWED_EXTENSIONS.includes(fileExtension)) {
        throw new PathValidationError(`Path validation failed: File extension "${fileExtension}" for path "${filePath}" is not allowed. Allowed: ${this.ALLOWED_EXTENSIONS.join(', ')}.`, filePath);
      }
    }

    // 5. Block sensitive patterns
    if (filePath.includes('.env') || filePath.includes('node_modules') || filePath.includes('.git')) {
      throw new PathValidationError(`Access to sensitive file or directory "${filePath}" is disallowed.`, filePath);
    }

    return true;
  }

  /**
   * Checks if a given path corresponds to an existing file and passes validation rules.
   * @param filePath - The path to check.
   * @returns `true` if the path is a valid and existing file, `false` otherwise.
   */
  public static isExistingFile(filePath: string): boolean {
    try {
      this.validatePath(filePath);
      const stats = fs.statSync(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Checks if a given path corresponds to an existing directory and passes validation rules.
   * @param dirPath - The path to check.
   * @returns `true` if the path is a valid and existing directory, `false` otherwise.
   */
  public static isExistingDirectory(dirPath: string): boolean {
    try {
      this.validatePath(dirPath);
      const stats = fs.statSync(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}

// Keep the function export that Jordan/Morgan might expect
/**
 * Helper function to validate a file path and return a structured result.
 * This function wraps `PathValidator.validatePath` to provide a non-throwing interface.
 * @param filePath - The path to validate.
 * @returns An object indicating `isValid`, an optional `error` message, and the `normalizedPath`.
 */
export function validatePath(filePath: string): { isValid: boolean; error?: string; normalizedPath: string } {
  try {
    PathValidator.validatePath(filePath);
    return { isValid: true, normalizedPath: path.normalize(filePath).replace(/\\/g, '/') };
  } catch (error: any) {
    return { isValid: false, error: error.message, normalizedPath: path.normalize(filePath).replace(/\\/g, '/') };
  }
}

/**
 * Validates the size of a file's content against a limit (in KB).
 */
export function validateFileSize(content: string, limitKB: number = 100): boolean {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const sizeKB = sizeBytes / 1024;
  return sizeKB <= limitKB;
}

/**
 * Validates the number of operations in a cycle against a limit.
 */
export function validateOperationCount(count: number, limit: number = 5): boolean {
  return count < limit;
}
