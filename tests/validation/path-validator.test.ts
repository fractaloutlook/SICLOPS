import { PathValidator, PathValidationError } from '../../src/validation/path-validator';
import * as fs from 'fs';
import * as path from 'path';

// Mock the fs module to control file system interactions
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(() => ({ isFile: jest.fn(), isDirectory: jest.fn() }))
}));

describe('PathValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure a default clean state for mocks
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isFile: () => false, isDirectory: () => false }));
  });

  describe('validatePath', () => {
    // Test case 1: Valid path within allowed root directory and extension
    it('should return true for a valid path with allowed root and extension', () => {
      const filePath = 'src/my-module.ts';
      expect(PathValidator.validatePath(filePath)).toBe(true);
    });

    // Test case 2: Invalid root directory
    it('should throw PathValidationError for a path outside allowed root directories', () => {
      const filePath = 'unallowed/file.ts';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/Path must be in allowed directories/);
    });

    // Test case 3: Path traversal attempt (using ..)
    it('should throw PathValidationError for path traversal attempts', () => {
      const filePath = 'src/../config.ts';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/Path traversal attempt detected/);
    });

    // Test case 4: Sensitive system file modification attempt
    it('should throw PathValidationError for attempts to modify sensitive system files', () => {
      const filePath = 'src/config.ts';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/Attempt to modify sensitive system file/);
    });

    // Test case 5: Disallowed file extension
    it('should throw PathValidationError for disallowed file extensions', () => {
      const filePath = 'src/image.jpg';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/File extension ".jpg" for path "src\/image.jpg" is not allowed/);
    });

    // Test case 6: Path with no extension but valid
    it('should return true for paths with no extension if in allowed root', () => {
      const filePath = 'notes/my-note';
      expect(PathValidator.validatePath(filePath)).toBe(true);
    });

    // Test case 7: Block sensitive patterns (.env)
    it('should throw PathValidationError for paths containing sensitive patterns like .env', () => {
      const filePath = 'data/.env';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/Access to sensitive file or directory/);
    });

    // Test case 8: Block sensitive patterns (node_modules)
    it('should throw PathValidationError for paths containing sensitive patterns like node_modules', () => {
      const filePath = 'src/node_modules/bad-package/index.js';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/Access to sensitive file or directory/);
    });

    // Test case 9: Empty path
    it('should throw PathValidationError for an empty path', () => {
      const filePath = '';
      expect(() => PathValidator.validatePath(filePath)).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath(filePath)).toThrow(/File path cannot be empty/);
    });
  });

  describe('isExistingFile', () => {
    it('should return true if the path is valid and exists as a file', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, isDirectory: () => false });
      expect(PathValidator.isExistingFile('src/valid.ts')).toBe(true);
      expect(fs.statSync).toHaveBeenCalledWith('src/valid.ts');
    });

    it('should return false if the path is valid but does not exist as a file', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => false, isDirectory: () => false });
      expect(PathValidator.isExistingFile('src/non-existent.ts')).toBe(false);
    });

    it('should return false if the path is invalid (fails validation)', () => {
      expect(PathValidator.isExistingFile('unallowed/file.ts')).toBe(false);
      expect(fs.statSync).not.toHaveBeenCalled(); // Should not call statSync if validation fails
    });
  });

  describe('isExistingDirectory', () => {
    it('should return true if the path is valid and exists as a directory', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => false, isDirectory: () => true });
      expect(PathValidator.isExistingDirectory('src/')).toBe(true);
      expect(fs.statSync).toHaveBeenCalledWith('src/');
    });

    it('should return false if the path is valid but does not exist as a directory', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => false, isDirectory: () => false });
      expect(PathValidator.isExistingDirectory('src/non-existent-dir/')).toBe(false);
    });

    it('should return false if the path is invalid (fails validation)', () => {
      expect(PathValidator.isExistingDirectory('unallowed/dir/')).toBe(false);
      expect(fs.statSync).not.toHaveBeenCalled(); // Should not call statSync if validation fails
    });
  });

  // Test the PathValidator.validatePath static method directly
  describe('PathValidator.validatePath method', () => {
    it('should return true for a valid path', () => {
      const result = PathValidator.validatePath('src/test.ts');
      expect(result).toBe(true);
    });

    it('should throw PathValidationError for an invalid path', () => {
      expect(() => PathValidator.validatePath('unallowed/test.ts')).toThrow(PathValidationError);
      expect(() => PathValidator.validatePath('unallowed/test.ts')).toThrow(/Path must be in allowed directories/);
    });
  });
});
