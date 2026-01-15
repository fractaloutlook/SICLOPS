/**
 * Path Validator Module
 * 
 * Security-focused path validation for file operations in SICLOPS.
 * 
 * **Purpose:**
 * Prevent path traversal attacks, enforce directory whitelisting, and validate
 * file paths before any file system operations.
 * 
 * **MVP Scope:**
 * - Path traversal prevention (block ../ sequences)
 * - Directory whitelisting (src/, tests/, docs/, notes/)
 * - Sensitive path blocking (.env, node_modules, .git)
 * - Basic path normalization
 * 
 * **Security Model:**
 * - Deny by default: paths must be in allowed directories
 * - Normalized paths: resolve ../ before validation
 * - Case-sensitive matching (filesystem security)
 * 
 * **Usage Example:**
 * ```typescript
 * import { validatePath, PathValidationError } from './validation/path-validator';
 * 
 * try {
 *   const result = validatePath('src/memory/shared-cache.ts');
 *   if (result.isValid) {
 *     // Safe to proceed with file operation
 *     await fs.readFile(result.normalizedPath);
 *   }
 * } catch (error) {
 *   if (error instanceof PathValidationError) {
 *     console.error(`Path validation failed: ${error.message}`);
 *   }
 * }
 * ```
 * 
 * **Integration Points:**
 * - Called by orchestrator.ts in handleFileRead/handleFileEdit/handleFileWrite
 * - Returns normalized path for safe file system operations
 * - Throws PathValidationError for security violations
 * 
 * @module validation/path-validator
 * @since 2026-01-15
 */

import * as path from 'path';

/**
 * Custom error class for path validation failures.
 * 
 * Thrown when a path fails security validation (traversal attempt,
 * not in whitelist, or matches sensitive pattern).
 */
export class PathValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Result of path validation.
 */
export interface PathValidationResult {
  /** Whether the path passed all validation checks */
  isValid: boolean;
  /** Normalized absolute path (if valid) */
  normalizedPath: string;
  /** Human-readable validation error (if invalid) */
  error?: string;
}

/**
 * Allowed directory prefixes for file operations.
 * 
 * Only paths starting with these prefixes are permitted.
 * All paths are normalized to remove ../ before checking.
 */
const ALLOWED_DIRECTORIES = [
  'src/',
  'tests/',
  'docs/',
  'notes/'
];

/**
 * Sensitive path patterns that should never be written to.
 * 
 * These patterns protect system files, dependencies, and secrets.
 */
const SENSITIVE_PATTERNS = [
  '.env',
  'node_modules',
  '.git',
  'package.json',
  'tsconfig.json'
];

/**
 * Validates a file path for security before file operations.
 * 
 * **Validation Steps:**
 * 1. Normalize path (resolve ../ and ./ sequences)
 * 2. Check for path traversal attempts
 * 3. Verify path is in allowed directory whitelist
 * 4. Ensure path doesn't match sensitive patterns
 * 
 * **Security Notes:**
 * - Path traversal: Blocks attempts to access parent directories
 * - Whitelist enforcement: Only src/, tests/, docs/, notes/ allowed
 * - Sensitive file protection: Blocks writes to .env, node_modules, etc.
 * 
 * @param filePath - The file path to validate (relative or absolute)
 * @returns PathValidationResult with validation status and normalized path
 * @throws PathValidationError for critical security violations
 * 
 * @example
 * ```typescript
 * // Valid path
 * const result = validatePath('src/memory/cache.ts');
 * // result.isValid === true
 * // result.normalizedPath === 'src/memory/cache.ts'
 * 
 * // Path traversal attempt
 * try {
 *   validatePath('../../../etc/passwd');
 * } catch (error) {
 *   // Throws PathValidationError
 * }
 * 
 * // Sensitive file
 * const result2 = validatePath('.env');
 * // result2.isValid === false
 * // result2.error === 'Access denied: .env is a sensitive file'
 * ```
 */
export function validatePath(filePath: string): PathValidationResult {
  // Step 1: Normalize the path (resolve . and .. sequences)
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  
  // Step 2: Check for path traversal attempts (../ after normalization)
  if (normalized.includes('..')) {
    throw new PathValidationError(
      `Path traversal attempt detected: ${filePath}`,
      filePath
    );
  }
  
  // Step 3: Check if path is in allowed directories
  const isInAllowedDir = ALLOWED_DIRECTORIES.some(dir => 
    normalized.startsWith(dir)
  );
  
  if (!isInAllowedDir) {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: `Path must be in allowed directories: ${ALLOWED_DIRECTORIES.join(', ')}`
    };
  }
  
  // Step 4: Check for sensitive file patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (normalized.includes(pattern)) {
      return {
        isValid: false,
        normalizedPath: normalized,
        error: `Access denied: ${pattern} is a sensitive file/directory`
      };
    }
  }
  
  // All checks passed
  return {
    isValid: true,
    normalizedPath: normalized
  };
}

/**
 * Validates file size before write operations.
 * 
 * Prevents resource exhaustion attacks by limiting file sizes.
 * 
 * @param content - The file content to validate
 * @param maxSizeKB - Maximum allowed file size in kilobytes (default: 100KB)
 * @returns true if size is acceptable, false otherwise
 * 
 * @example
 * ```typescript
 * const content = 'x'.repeat(200000); // 200KB
 * const isValid = validateFileSize(content, 100); // false
 * ```
 */
export function validateFileSize(content: string, maxSizeKB: number = 100): boolean {
  const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
  return sizeKB <= maxSizeKB;
}

/**
 * Validates number of file operations per turn.
 * 
 * Prevents resource exhaustion by limiting operations per agent turn.
 * 
 * @param operationCount - Current number of operations this turn
 * @param maxOperations - Maximum allowed operations (default: 5)
 * @returns true if under limit, false otherwise
 * 
 * @example
 * ```typescript
 * let opCount = 0;
 * for (const file of filesToWrite) {
 *   if (!validateOperationCount(opCount, 5)) {
 *     throw new Error('Too many file operations this turn');
 *   }
 *   await writeFile(file);
 *   opCount++;
 * }
 * ```
 */
export function validateOperationCount(operationCount: number, maxOperations: number = 5): boolean {
  return operationCount < maxOperations;
}