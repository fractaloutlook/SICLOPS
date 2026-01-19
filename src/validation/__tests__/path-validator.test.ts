import { PathValidator, validatePath, validateFileSize, validateOperationCount, PathValidationError } from '../path-validator';

describe('Path Validator', () => {
  describe('validatePath()', () => {
    describe('Valid paths', () => {
      test('should accept paths in src/', () => {
        const result = validatePath('src/validation/path-validator.ts');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('src/validation/path-validator.ts');
        expect(result.error).toBeUndefined();
      });

      test('should accept paths in tests/', () => {
        const result = validatePath('tests/unit/validation.test.ts');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('tests/unit/validation.test.ts');
      });

      test('should accept paths in docs/', () => {
        const result = validatePath('docs/SYSTEM_CAPABILITIES.md');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('docs/SYSTEM_CAPABILITIES.md');
      });

      test('should accept paths in notes/', () => {
        const result = validatePath('notes/sam-notes.md');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('notes/sam-notes.md');
      });
    });

    describe('Path traversal prevention', () => {
      test('should throw on ../ traversal attempt', () => {
        expect(() => PathValidator.validatePath('../../../etc/passwd')).toThrow(PathValidationError);
        expect(() => PathValidator.validatePath('../../../etc/passwd')).toThrow('Path traversal attempt detected');
      });

      test('should reject subtle traversal with valid prefix', () => {
        const result = validatePath('src/../../../etc/passwd');
        expect(result.isValid).toBe(false);
        // Updated expected error message from current implementation
        expect(result.error).toContain('Path traversal attempt detected');
      });

      test('should throw on mixed slashes traversal', () => {
        expect(() => PathValidator.validatePath('src\\..\\..\\etc\\passwd')).toThrow(PathValidationError);
      });
    });

    describe('Directory whitelist enforcement', () => {
      test('should reject absolute paths', () => {
        const result = validatePath('/etc/passwd');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Path must be in allowed directories');
      });

      test('should reject paths outside whitelist', () => {
        const result = validatePath('config/secrets.yml');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Path must be in allowed directories');
      });

      test('should reject home directory paths', () => {
        const result = validatePath('~/sensitive-data.txt');
        expect(result.isValid).toBe(false);
      });

      test('should reject current directory if not in whitelist', () => {
        const result = validatePath('./README.md');
        expect(result.isValid).toBe(false);
      });
    });

    describe('Sensitive file patterns', () => {
      test('should reject .env files', () => {
        const result = validatePath('src/.env');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('disallowed');
      });

      test('should reject node_modules paths', () => {
        const result = validatePath('src/node_modules/package/index.js');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('node_modules');
      });

      test('should reject .git paths', () => {
        const result = validatePath('src/.git/config');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('.git');
      });

      test('should reject package.json', () => {
        const result = validatePath('src/package.json');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('disallowed');
      });

      test('should reject tsconfig.json', () => {
        const result = validatePath('src/tsconfig.json');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('disallowed');
      });
    });

    describe('Path normalization', () => {
      test('should normalize forward slashes', () => {
        const result = validatePath('src//validation//path-validator.ts');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('src/validation/path-validator.ts');
      });

      test('should handle ./ current directory references', () => {
        const result = validatePath('src/./validation/./path-validator.ts');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('src/validation/path-validator.ts');
      });

      test('should convert backslashes to forward slashes', () => {
        const result = validatePath('src\\validation\\path-validator.ts');
        expect(result.isValid).toBe(true);
        expect(result.normalizedPath).toBe('src/validation/path-validator.ts');
      });
    });
  });

  describe('validateFileSize()', () => {
    test('should accept files under limit (99KB)', () => {
      const content = 'x'.repeat(99 * 1024); // 99KB
      expect(validateFileSize(content, 100)).toBe(true);
    });

    test('should accept files at exact limit (100KB)', () => {
      const content = 'x'.repeat(100 * 1024); // 100KB
      expect(validateFileSize(content, 100)).toBe(true);
    });

    test('should reject files over limit (101KB)', () => {
      const content = 'x'.repeat(101 * 1024); // 101KB
      expect(validateFileSize(content, 100)).toBe(false);
    });

    test('should use default 100KB limit', () => {
      const content = 'x'.repeat(150 * 1024); // 150KB
      expect(validateFileSize(content)).toBe(false);
    });

    test('should accept empty files', () => {
      expect(validateFileSize('')).toBe(true);
    });

    test('should handle multi-byte UTF-8 characters correctly', () => {
      const content = '🔒'.repeat(30000); // emoji = 4 bytes each
      const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
      const result = validateFileSize(content, 100);
      expect(result).toBe(sizeKB <= 100);
    });
  });

  describe('validateOperationCount()', () => {
    test('should accept counts under limit (4 ops)', () => {
      expect(validateOperationCount(4, 5)).toBe(true);
    });

    test('should reject counts at limit (5 ops)', () => {
      expect(validateOperationCount(5, 5)).toBe(false);
    });

    test('should reject counts over limit (6 ops)', () => {
      expect(validateOperationCount(6, 5)).toBe(false);
    });

    test('should use default 5 operation limit', () => {
      expect(validateOperationCount(6)).toBe(false);
      expect(validateOperationCount(4)).toBe(true);
    });

    test('should accept zero operations', () => {
      expect(validateOperationCount(0, 5)).toBe(true);
    });
  });

  describe('PathValidationError', () => {
    test('should contain error message', () => {
      const error = new PathValidationError('Test error', '/bad/path');
      expect(error.message).toBe('Test error');
    });

    test('should contain original path', () => {
      const error = new PathValidationError('Test error', '/bad/path');
      expect(error.path).toBe('/bad/path');
    });

    test('should have correct name', () => {
      const error = new PathValidationError('Test error', '/bad/path');
      expect(error.name).toBe('PathValidationError');
    });

    test('should be instanceof Error', () => {
      const error = new PathValidationError('Test error', '/bad/path');
      expect(error instanceof Error).toBe(true);
    });
  });
});
