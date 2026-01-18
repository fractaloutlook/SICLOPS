import * as path from 'path';
import * as fs from 'fs';

export class PathValidationError extends Error {
  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Interface for a path validator (Agent-proposed for Code Validation Pipeline).
 */
export interface IPathValidator {
  validatePath(filePath: string): boolean;
  isExistingFile(filePath: string): boolean;
  isExistingDirectory(dirPath: string): boolean;
}

/**
 * Static PathValidator class (System-required for Orchestrator stability).
 */
export class PathValidator {
  private static ALLOWED_ROOT_DIRECTORIES = ['src', 'notes', 'docs', 'tests', 'data'];
  private static ALLOWED_EXTENSIONS = ['.ts', '.md', '.json', '.js'];

  // Critical system files are protected from accidental modification, 
  // but agents need to be able to edit orchestrator.ts during implementation cycles.
  private static SENSITIVE_SYSTEM_FILES = [
    'src/config.ts'
  ];

  /**
   * Validates a given file path against a set of rules for file operations.
   */
  public static validatePath(filePath: string): boolean {
    if (!filePath) {
      throw new PathValidationError('Path validation failed: File path cannot be empty.', filePath);
    }

    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
    const pathParts = normalizedPath.split('/');
    const rootDir = pathParts[0];

    // 1. Check if the path is within allowed root directories
    if (!this.ALLOWED_ROOT_DIRECTORIES.includes(rootDir)) {
      if (filePath.startsWith('..') || rootDir === '..') {
        throw new PathValidationError(`Path validation failed: Path traversal attempt detected in path "${filePath}".`, filePath);
      }
      throw new PathValidationError(`Path must be in allowed directories. Path "${filePath}" with root directory "${rootDir}" is not within an allowed root directory. Allowed: ${this.ALLOWED_ROOT_DIRECTORIES.join(', ')}.`, filePath);
    }

    // 2. Prevent directory traversal attacks
    if (normalizedPath.includes('..')) {
      throw new PathValidationError(`Path validation failed: Path traversal attempt detected in path "${filePath}".`, filePath);
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

  public static isExistingFile(filePath: string): boolean {
    try {
      this.validatePath(filePath);
      const stats = fs.statSync(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

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

/**
 * A path validator implementation that follows the IPathValidator interface.
 */
export class ProjectPathValidator implements IPathValidator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public validatePath(filePath: string): boolean {
    // Fallback to static validation for core rules
    PathValidator.validatePath(filePath);

    const absolutePath = path.resolve(filePath);
    if (!absolutePath.startsWith(this.projectRoot)) {
      throw new PathValidationError(`Path '${filePath}' is outside the project root.`, filePath);
    }
    return true;
  }

  public isExistingFile(filePath: string): boolean {
    return PathValidator.isExistingFile(filePath);
  }

  public isExistingDirectory(dirPath: string): boolean {
    return PathValidator.isExistingDirectory(dirPath);
  }
}

// Keep the function export that Jordan/Morgan might expect
export function validatePath(filePath: string): { isValid: boolean; error?: string; normalizedPath: string } {
  try {
    PathValidator.validatePath(filePath);
    return { isValid: true, normalizedPath: path.normalize(filePath).replace(/\\/g, '/') };
  } catch (error: any) {
    return { isValid: false, error: error.message, normalizedPath: filePath };
  }
}
