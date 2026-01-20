import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    rules: {
      // Add project-specific rules here
      // For example:
      // 'no-unused-vars': 'warn',
      // '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
